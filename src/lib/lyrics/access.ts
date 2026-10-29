import { timingSafeEqual } from "node:crypto";

import { redis } from "@/lib/bet/store";

/**
 * Two logins for /lyrics. The admin (LYRICS_ADMIN_KEY, or the /bet key when that's all that's
 * set) has everything. The editor writes parody lines and nothing else; the admin sets the
 * editor's password from the studio, and it's kept in Redis, never in the code.
 */
export type LyricsRole = "admin" | "editor";

export const EDITOR_KEY = "vindle_lyrics_editor_key";
/** Wrong passcodes per IP before logins lock for LOCK_SECONDS (the editor password can be short). */
const MAX_FAILS = 10;
const LOCK_SECONDS = 15 * 60;

export const adminKey = () => process.env.LYRICS_ADMIN_KEY || process.env.BET_ACCESS_KEY || "";

const same = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const clientIp = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

/** The caller's role from x-lyrics-key; "locked" after too many wrong tries; null for visitors and wrong keys. */
export const lyricsRole = async (request: Request): Promise<LyricsRole | "locked" | null> => {
  const given = request.headers.get("x-lyrics-key") ?? "";
  if (!given) return null;
  const admin = adminKey();
  if (admin && same(given, admin)) return "admin";

  const failKey = `vindle_lyrics_fail:${clientIp(request)}`;
  const [fails, editor] = await Promise.all([
    redis(["GET", failKey]).catch(() => null),
    redis(["GET", EDITOR_KEY]).catch(() => null),
  ]);
  if (Number(fails?.result ?? 0) >= MAX_FAILS) return "locked";
  if (typeof editor?.result === "string" && editor.result && same(given, editor.result)) return "editor";
  await redis(["INCR", failKey])
    .then(() => redis(["EXPIRE", failKey, LOCK_SECONDS]))
    .catch(() => null);
  return null;
};

/**
 * Gates a route to the given roles (admin only by default). Returns an error response, or
 * null when the request may proceed.
 */
export const checkLyricsAccess = async (request: Request, allowed: LyricsRole[] = ["admin"]): Promise<Response | null> => {
  if (!adminKey()) return Response.json({ error: "Not configured" }, { status: 503 });
  const role = await lyricsRole(request);
  if (role === "locked") return Response.json({ error: "Too many wrong tries. Wait 15 minutes." }, { status: 429 });
  if (!role) return Response.json({ error: "Invalid passcode" }, { status: 401 });
  if (!allowed.includes(role)) return Response.json({ error: "Not allowed" }, { status: 403 });
  return null;
};
