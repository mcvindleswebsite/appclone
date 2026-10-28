import { timingSafeEqual } from "node:crypto";

/** The /lyrics admin passcode: LYRICS_ADMIN_KEY, or the /bet key when that's all that's set. */
const adminKey = () => process.env.LYRICS_ADMIN_KEY || process.env.BET_ACCESS_KEY || "";

export const isLyricsAdmin = (request: Request) => {
  const expected = adminKey();
  if (!expected) return false;
  const given = Buffer.from(request.headers.get("x-lyrics-key") ?? "");
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want);
};

/**
 * Editing, search, and the AI assist are admin-only. Unset key means they're disabled.
 * Returns an error response, or null when the request may proceed.
 */
export const checkLyricsAccess = (request: Request): Response | null => {
  if (!adminKey()) return Response.json({ error: "Not configured" }, { status: 503 });
  if (!isLyricsAdmin(request)) return Response.json({ error: "Invalid passcode" }, { status: 401 });
  return null;
};
