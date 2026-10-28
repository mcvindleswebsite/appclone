import { checkAccess } from "@/lib/bet/access";
import { decimalToAmerican, kalshiDecimal, kalshiFee } from "@/lib/bet/engine";
import { soccerCandidates, type SoccerCandidate } from "@/lib/bet/kalshi-api";
import { BET_MODEL } from "@/lib/bet/model";
import { researchLeg } from "@/lib/bet/research";
import { isScanLeague, isTimeWindow, SCAN_LEAGUES, windowRange, type ScanScope } from "@/lib/bet/scan-scope";
import { redis } from "@/lib/bet/store";
import type { RecommendedLeg, SoccerRecommendation } from "@/types/bet";

export const dynamic = "force-dynamic";
// A dozen legs researched in parallel; about as long as one.
export const maxDuration = 120;

const PARLAY_LEGS = 5;
/** Legs sent to AI research per scan: enough to find 5 that clear the bar, few enough to stay cheap. */
const RESEARCH_BUDGET = 12;
const MAX_PER_LEAGUE = 3;
/** A recommended match leg must be at least a coin flip in the model's view. */
const MIN_PROBABILITY = 0.5;
/** Title races rarely have a coin-flip favorite, so a futures leg only needs a real chance. */
const MIN_FUTURES_PROBABILITY = 0.25;
const CACHE_KEY = "vindle_soccer_recs";
const CACHE_SECONDS = 30 * 60;

/**
 * Picks which fixtures get researched: the most-traded favorites (deep markets price
 * best), spread across leagues so one league can't fill the ticket.
 */
const shortlist = (candidates: SoccerCandidate[]) => {
  const perLeague = new Map<string, number>();
  return [...candidates]
    .sort((a, b) => b.volume - a.volume)
    .filter((c) => {
      const n = perLeague.get(c.league) ?? 0;
      if (n >= MAX_PER_LEAGUE) return false;
      perLeague.set(c.league, n + 1);
      return true;
    })
    .slice(0, RESEARCH_BUDGET);
};

const scan = async (scope: ScanScope): Promise<SoccerRecommendation> => {
  const candidates = await soccerCandidates(scope);
  const picked = shortlist(candidates);
  const researched = await Promise.all(picked.map(async (c) => ({ c, a: await researchLeg(c.leg) })));

  const scored: RecommendedLeg[] = researched.flatMap(({ c, a }) => {
    const price = c.leg.price;
    if (!a.researched || price === null) return [];
    const p = a.probability;
    const ev = p * kalshiDecimal(price) - 1;
    return [
      {
        leg: c.leg,
        league: c.league,
        settlesAt: c.settlesAt,
        ...(c.futures ? { futures: true } : {}),
        modelProbability: p,
        marketProbability: price / 100,
        ev,
        confidence: a.hitConfidence,
        rating: a.rating,
        reason: a.reason,
        opponentTier: a.opponentTier,
      },
    ];
  });

  // Only legs the model rates as real value: +EV after Kalshi's fee, a coin flip or better,
  // and never a bum pick or trap game. Ranked by edge after fees, then win probability.
  const minProbability = scope.window === "futures" ? MIN_FUTURES_PROBABILITY : MIN_PROBABILITY;
  const qualified = scored
    .filter((l) => l.ev > 0 && l.modelProbability >= minProbability && l.rating !== "BUM PICK" && !l.opponentTier.trapGame)
    .sort((a, b) => {
      const edge = (l: RecommendedLeg) => l.modelProbability - l.marketProbability - kalshiFee(l.marketProbability);
      return edge(b) - edge(a) || b.modelProbability - a.modelProbability;
    });
  const legs = qualified.slice(0, PARLAY_LEGS);

  let parlay: SoccerRecommendation["parlay"] = null;
  if (legs.length >= 2) {
    const probability = legs.reduce((acc, l) => acc * l.modelProbability, 1);
    const decimal = legs.reduce((acc, l) => acc * kalshiDecimal(l.leg.price!), 1);
    parlay = { probability, decimal, american: decimalToAmerican(decimal), ev: probability * decimal - 1 };
  }

  return {
    legs,
    parlay,
    scanned: { fixtures: candidates.length, researched: researched.filter((r) => r.a.researched).length, qualified: qualified.length },
    generatedAt: new Date().toISOString(),
    note:
      legs.length < PARLAY_LEGS
        ? `Only ${legs.length} leg${legs.length === 1 ? "" : "s"} cleared the bar (+EV, ≥${Math.round(minProbability * 100)}% to win, no bum picks) — the scanner doesn't pad a ticket with -EV legs.`
        : null,
    model: BET_MODEL,
    scope,
  };
};

/** The scope from the request body; anything missing falls back to every league, this week. */
const readScope = async (request: Request): Promise<ScanScope> => {
  const body = (await request.json().catch(() => ({}))) as Partial<Record<keyof ScanScope, unknown>>;
  const window = isTimeWindow(body.window) ? body.window : "week";
  const fallback = windowRange(window, Date.now());
  const from = typeof body.from === "number" && Number.isFinite(body.from) ? body.from : fallback.from;
  const to = typeof body.to === "number" && Number.isFinite(body.to) ? body.to : fallback.to;
  const leagues = Array.isArray(body.leagues) ? body.leagues.filter(isScanLeague) : [];
  return { window, from, to: Math.max(from, to), leagues: leagues.length ? leagues : [...SCAN_LEAGUES] };
};

/** One cache entry per league set and hour-rounded window, so different scopes don't collide. */
const cacheKey = (scope: ScanScope) => {
  const hour = 60 * 60 * 1000;
  const range = scope.window === "futures" ? "" : `:${Math.floor(scope.from / hour)}`;
  return `${CACHE_KEY}:${scope.window}${range}:${[...scope.leagues].sort().join(",")}`;
};

/**
 * Scans soccer markets on Kalshi in the requested leagues and time window (body: ScanScope)
 * and returns the best +EV legs as a 5-leg ticket.
 * Results are cached for 30 minutes (when Upstash is connected) because each scan runs a
 * dozen AI research calls; `?fresh=1` forces a new scan.
 */
export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI not configured" }, { status: 503 });

  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const scope = await readScope(request);
  const key = cacheKey(scope);
  if (!fresh) {
    const cached = await redis(["GET", key]).catch(() => null);
    if (typeof cached?.result === "string") {
      return Response.json({ ...(JSON.parse(cached.result) as SoccerRecommendation), cached: true });
    }
  }

  try {
    const result = await scan(scope);
    if (result.legs.length) {
      await redis(["SET", key, JSON.stringify(result), "EX", CACHE_SECONDS]).catch(() => null);
    }
    return Response.json(result);
  } catch {
    return Response.json({ error: "Scan failed — Kalshi or the AI didn't respond" }, { status: 502 });
  }
}
