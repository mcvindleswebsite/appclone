import { resolveTimings } from "@/lib/bet/kalshi-api";

export const dynamic = "force-dynamic";

const MAX_TICKERS = 60;
const TICKER = /^[A-Z0-9][A-Z0-9.-]{2,79}$/;

/**
 * Game start and estimated finish for pending vault tickers, from Kalshi's public market
 * and milestone data (no AI). Powers the Bet Vault's completion badges and countdowns.
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
    return Response.json({ timing: await resolveTimings(tickers) });
  } catch {
    return Response.json({ error: "Kalshi didn't respond — try again" }, { status: 502 });
  }
}
