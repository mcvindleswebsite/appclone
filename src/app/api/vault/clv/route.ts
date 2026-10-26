import { resolveClosingLines } from "@/lib/bet/kalshi-api";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_TICKERS = 40;
const TICKER = /^[A-Z0-9][A-Z0-9.-]{2,79}$/;

/**
 * Closing lines for the Bet Vault's CLV tracking: each market's fair price when its game
 * started, from Kalshi's public candlestick history (no AI).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { tickers?: unknown } | null;
  const tickers = Array.isArray(body?.tickers)
    ? [...new Set(body.tickers.filter((t): t is string => typeof t === "string").map((t) => t.toUpperCase()))]
        .filter((t) => TICKER.test(t))
        .slice(0, MAX_TICKERS)
    : [];
  if (tickers.length === 0) return Response.json({ error: "No tickers" }, { status: 400 });

  try {
    return Response.json({ lines: await resolveClosingLines(tickers) });
  } catch {
    return Response.json({ error: "Kalshi didn't respond — try again" }, { status: 502 });
  }
}
