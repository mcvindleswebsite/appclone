import { timingSafeEqual } from "node:crypto";

/**
 * The AI evaluator spends API credits and the vault holds personal history, so both
 * routes require the BET_ACCESS_KEY passphrase. Unset means the routes are disabled.
 */
export const checkAccess = (request: Request): Response | null => {
  const expected = process.env.BET_ACCESS_KEY;
  if (!expected) return Response.json({ error: "Not configured" }, { status: 503 });
  const given = Buffer.from(request.headers.get("x-bet-key") ?? "");
  const want = Buffer.from(expected);
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return Response.json({ error: "Invalid access key" }, { status: 401 });
  }
  return null;
};

/** Vercel Cron calls authenticate with `Authorization: Bearer $CRON_SECRET`. */
export const isCron = (request: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return given.length === want.length && timingSafeEqual(given, want);
};
