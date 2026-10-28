import { checkAccess } from "@/lib/bet/access";
import { decimalToAmerican, kalshiDecimal, kalshiFee } from "@/lib/bet/engine";
import { soccerCandidates, type SoccerCandidate } from "@/lib/bet/kalshi-api";
import { BET_MODEL } from "@/lib/bet/model";
import { researchLeg } from "@/lib/bet/research";
import { isScanLeague, isTimeWindow, SCAN_LEAGUES, windowRange, type ScanScope } from "@/lib/bet/scan-scope";
import { redis } from "@/lib/bet/store";
import type { RecommendedLeg, SoccerRecommendation } from "@/types/bet";

export const dynamic = "force-dynamic";
// Every fixture in scope is researched, in parallel waves; the Hobby plan's ceiling.
export const maxDuration = 300;

const PARLAY_LEGS = 5;
/** Research calls in flight at once: wide enough to cover a month of fixtures, narrow enough for API rate limits. */
const CONCURRENCY = 16;
/** No new research starts after this, so in-flight calls can finish inside maxDuration. */
const START_DEADLINE_MS = 180_000;
/** Any research still running at this point is dropped and the scan returns what it has. */
const HARD_DEADLINE_MS = 275_000;
/** A recommended match leg must be at least a coin flip in the model's view. */
const MIN_PROBABILITY = 0.5;
/** Title races rarely have a coin-flip favorite, so a futures leg only needs a real chance. */
const MIN_FUTURES_PROBABILITY = 0.25;
const CACHE_KEY = "vindle_soccer_recs";
const CACHE_SECONDS = 30 * 60;

type Researched = { c: SoccerCandidate; a: Awaited<ReturnType<typeof researchLeg>> };

/**
 * Researches every candidate, CONCURRENCY at a time, most-traded first (deep markets price
 * best, so they're the ones worth guaranteeing if a huge window runs out of time).
 */
const researchAll = async (candidates: SoccerCandidate[]) => {
  const started = Date.now();
  const queue = [...candidates].sort((a, b) => b.volume - a.volume);
  const done: Researched[] = [];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      if (Date.now() - started > START_DEADLINE_MS) continue;
      done.push({ c, a: await researchLeg(c.leg) });
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cutoff = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, HARD_DEADLINE_MS);
  });
  await Promise.race([Promise.all(Array.from({ length: CONCURRENCY }, worker)), cutoff]);
  clearTimeout(timer);
  // Calls still running at the cutoff count as unresearched; the snapshot ignores their late results.
  const researched = [...done];
  return { researched, skipped: candidates.length - researched.length };
};

const scan = async (scope: ScanScope): Promise<SoccerRecommendation> => {
  const candidates = await soccerCandidates(scope);
  const { researched, skipped } = await researchAll(candidates);

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
    scanned: {
      fixtures: candidates.length,
      researched: researched.filter((r) => r.a.researched).length,
      qualified: qualified.length,
      skipped,
    },
    generatedAt: new Date().toISOString(),
    note:
      [
        legs.length < PARLAY_LEGS
          ? `Only ${legs.length} leg${legs.length === 1 ? "" : "s"} cleared the bar (+EV, ≥${Math.round(minProbability * 100)}% to win, no bum picks) — the scanner doesn't pad a ticket with -EV legs.`
          : null,
        skipped
          ? `${skipped} of ${candidates.length} fixtures ran out of research time (the least-traded ones) — narrow the leagues or timeframe to cover them all.`
          : null,
      ]
        .filter(Boolean)
        .join(" ") || null,
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
 * research call for every fixture in scope; `?fresh=1` forces a new scan.
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
