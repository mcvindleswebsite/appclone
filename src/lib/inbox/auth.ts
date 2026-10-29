import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

import { redis } from "@/lib/bet/store";
import { adminKey } from "@/lib/lyrics/access";

/**
 * The private mcvindle.com login, shared by the inbox and /me: the address and the password
 * both have to match, and a good login gets a 12-hour session cookie (only sent to /api). The
 * password is INBOX_PASSWORD, or the /lyrics admin password when that's unset. Sessions live
 * in Upstash.
 */

export const INBOX_EMAIL = (process.env.INBOX_EMAIL || "vincent@mcvindle.com").toLowerCase();
const COOKIE = "vindle_inbox";
const SESSION_SECONDS = 12 * 60 * 60;
/** Wrong logins per IP before logins lock for LOCK_SECONDS. */
const MAX_FAILS = 5;
const LOCK_SECONDS = 15 * 60;

const inboxPassword = () => process.env.INBOX_PASSWORD || adminKey();

const same = (given: string, expected: string) => {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

const clientIp = (request: Request) => request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
const sessionKey = (token: string) => `vindle_inbox_session:${createHash("sha256").update(token).digest("hex")}`;

const tokenOf = (request: Request) => {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`));
  return match ? match.slice(COOKIE.length + 1) : "";
};

const cookie = (token: string, maxAge: number) =>
  `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=${maxAge}`;

/** Checks the address and password; on success the response sets the session cookie. */
export const login = async (request: Request, email: unknown, password: unknown): Promise<Response> => {
  const expected = inboxPassword();
  if (!expected) return Response.json({ error: "Not configured" }, { status: 503 });
  const failKey = `vindle_inbox_fail:${clientIp(request)}`;
  const fails = await redis(["GET", failKey]);
  if (!fails) return Response.json({ error: "Store not configured" }, { status: 503 });
  if (Number(fails.result ?? 0) >= MAX_FAILS) return Response.json({ error: "Too many tries — wait 15 minutes" }, { status: 429 });

  const ok =
    typeof email === "string" &&
    typeof password === "string" &&
    same(email.trim().toLowerCase(), INBOX_EMAIL) &&
    same(password, expected);
  if (!ok) {
    await redis(["INCR", failKey]);
    await redis(["EXPIRE", failKey, LOCK_SECONDS]);
    return Response.json({ error: "Wrong password" }, { status: 401 });
  }
  const token = randomBytes(32).toString("base64url");
  await redis(["SET", sessionKey(token), "1", "EX", SESSION_SECONDS]);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie(token, SESSION_SECONDS) } });
};

export const logout = async (request: Request) => {
  const token = tokenOf(request);
  if (token) await redis(["DEL", sessionKey(token)]).catch(() => null);
  return Response.json({ ok: true }, { headers: { "Set-Cookie": cookie("", 0) } });
};

export const hasSession = async (request: Request) => {
  const token = tokenOf(request);
  if (!token) return false;
  const reply = await redis(["GET", sessionKey(token)]).catch(() => null);
  return reply?.result === "1";
};

/** Null when the caller is logged in, else the 401 to send back. */
export const requireSession = async (request: Request): Promise<Response | null> =>
  (await hasSession(request)) ? null : Response.json({ error: "Logged out" }, { status: 401 });
