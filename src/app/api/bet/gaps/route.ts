import { checkAccess } from "@/lib/bet/access";
import { soccerCandidates } from "@/lib/bet/kalshi-api";
import { isScanLeague, kickoffOf, SCAN_LEAGUES } from "@/lib/bet/scan-scope";
import { sharpLines } from "@/lib/bet/sharp";
import type { PriceGap } from "@/types/bet";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Kalshi must sit this far below the sharp price, after fees, to raise an alert. */
const ALERT_EDGE = 0.02;
/** How far ahead to watch: the window where pre-match prices actually move. */
const LOOKAHEAD_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Price-gap alerts (no AI): upcoming matches where Kalshi's ask is below the sharp books'
 * de-vigged price by ALERT_EDGE or more after Kalshi's fee — usually Kalshi lagging a move
 * at the books. Body: `{ leagues?: ScanLeague[] }`.
 */
export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  const body = ((await request.json().catch(() => null)) ?? {}) as { leagues?: unknown };
  const leagues = Array.isArray(body.leagues) ? body.leagues.filter(isScanLeague) : [];
  const now = Date.now();
  try {
    const candidates = await soccerCandidates({
      window: "week",
      from: now,
      to: now + LOOKAHEAD_MS,
      leagues: leagues.length ? leagues : [...SCAN_LEAGUES],
    });
    const { configured, lines } = await sharpLines(candidates);
    const gaps: PriceGap[] = candidates.flatMap((c) => {
      const sharp = c.leg.ticker ? lines.get(c.leg.ticker) : undefined;
      if (!sharp || sharp.edge < ALERT_EDGE || c.leg.price === null) return [];
      return [{ leg: c.leg, league: c.league, kickoffTime: new Date(kickoffOf(c.settlesAt)).toISOString(), ask: c.leg.price, sharp }];
    });
    return Response.json({ configured, gaps: gaps.sort((a, b) => b.sharp.edge - a.sharp.edge).slice(0, 12), at: new Date().toISOString() });
  } catch {
    return Response.json({ error: "Couldn't check prices — Kalshi or the odds feed didn't respond" }, { status: 502 });
  }
}
