import { bookLines, sportKeyFor, type BookLegQuery } from "@/lib/bet/odds-api";

export const dynamic = "force-dynamic";

const MAX_LEGS = 25;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * De-vigged sharp sportsbook probabilities for Kalshi game-winner legs (The Odds API).
 * Answers `configured: false` when ODDS_API_KEY isn't set, so the page can say so.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { legs?: unknown } | null;
  const legs: BookLegQuery[] = (Array.isArray(body?.legs) ? body.legs : [])
    .slice(0, MAX_LEGS)
    .map((l) => {
      const leg = (l ?? {}) as Record<string, unknown>;
      return {
        ticker: str(leg.ticker, 80).toUpperCase(),
        matchup: str(leg.matchup, 120),
        pick: str(leg.pick, 80),
        side: leg.side === "no" ? ("no" as const) : ("yes" as const),
        startsAt: str(leg.startsAt, 40) || undefined,
      };
    })
    .filter((l) => l.ticker && l.matchup && l.pick && sportKeyFor(l.ticker));

  if (legs.length === 0) return Response.json({ configured: !!process.env.ODDS_API_KEY, lines: {} });
  return Response.json(await bookLines(legs));
}
