import { kalshiFee } from "@/lib/bet/engine";
import type { ScanCandidate } from "@/lib/bet/kalshi-api";
import { bookLines } from "@/lib/bet/odds-api";
import { kickoffOf } from "@/lib/bet/scan-scope";
import type { SharpLine } from "@/types/bet";

/**
 * Sharp-book prices for scanner candidates (no AI): each match favorite's de-vigged fair
 * probability, and how far Kalshi's ask sits below it after Kalshi's taker fee. Futures have
 * no book line. `configured` is false without ODDS_API_KEY.
 */
export const sharpLines = async (candidates: ScanCandidate[]): Promise<{ configured: boolean; lines: Map<string, SharpLine> }> => {
  const matches = candidates.filter((c) => !c.futures && c.leg.ticker && c.leg.price !== null);
  const { configured, lines } = await bookLines(
    matches.map((c) => ({
      ticker: c.leg.ticker!,
      matchup: c.leg.matchup,
      pick: c.leg.pick,
      side: "yes",
      startsAt: new Date(kickoffOf(c.settlesAt, c.league)).toISOString(),
    }))
  );
  const out = new Map<string, SharpLine>();
  for (const c of matches) {
    const line = lines[c.leg.ticker!];
    if (!line) continue;
    const ask = c.leg.price! / 100;
    out.set(c.leg.ticker!, { fair: line.fair, source: line.source, edge: line.fair - ask - kalshiFee(ask) });
  }
  return { configured, lines: out };
};
