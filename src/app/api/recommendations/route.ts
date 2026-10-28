import { checkAccess } from "@/lib/bet/access";
import { decimalToAmerican, kalshiDecimal, kalshiFee } from "@/lib/bet/engine";
import { describeVaultProfile, sanitizeVaultProfile, vaultProfile } from "@/lib/bet/history";
import { soccerCandidates, type SoccerCandidate } from "@/lib/bet/kalshi-api";
import { BET_MODEL } from "@/lib/bet/model";
import { researchLeg } from "@/lib/bet/research";
import { isScanLeague, isTimeWindow, kickoffOf, SCAN_LEAGUES, windowRange, type ScanScope } from "@/lib/bet/scan-scope";
import { readVault, redis } from "@/lib/bet/store";
import type { RecommendedLeg, SoccerRecommendation, VaultProfile } from "@/types/bet";

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
/** A recommended leg needs at least solid, partial evidence behind it (1-10 scale). */
const MIN_CONFIDENCE = 4;
const CACHE_KEY = "vindle_soccer_recs";
const CACHE_SECONDS = 30 * 60;

type Researched = { c: SoccerCandidate; a: Awaited<ReturnType<typeof researchLeg>> };

/**
 * Researches every candidate, CONCURRENCY at a time, most-traded first (deep markets price
 * best, so they're the ones worth guaranteeing if a huge window runs out of time). Every
 * leg is its own fresh, stateless call carrying the same Bet Vault profile.
 */
const researchAll = async (candidates: SoccerCandidate[], history: string) => {
  const started = Date.now();
  const queue = [...candidates].sort((a, b) => b.volume - a.volume);
  const done: Researched[] = [];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      if (Date.now() - started > START_DEADLINE_MS) continue;
      done.push({ c, a: await researchLeg(c.leg, history) });
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

const percent = (n: number) => `${Math.round(n * 100)}%`;

/** The fixed pick record: fixture facts from Kalshi, analysis from the model, line value from code. */
const toPick = ({ c, a }: Researched, price: number): RecommendedLeg => {
  const decimal = kalshiDecimal(price);
  const p = a.probability;
  const edge = p - price / 100 - kalshiFee(price / 100);
  return {
    leg: c.leg,
    league: c.league,
    settlesAt: c.settlesAt,
    ...(c.futures ? { futures: true } : {}),
    matchName: c.leg.matchup || c.leg.market,
    kickoffTime: new Date(c.futures ? Date.parse(c.settlesAt) : kickoffOf(c.settlesAt)).toISOString(),
    pick: c.leg.pick,
    odds: { kalshiCents: price, american: decimalToAmerican(decimal) },
    reasoningStats: [
      { metric: "Kalshi implied probability", value: percent(price / 100), source: "Kalshi" },
      { metric: "Model edge after fee", value: `${edge >= 0 ? "+" : ""}${(edge * 100).toFixed(1)} pts`, source: "Vindle (computed)" },
      ...(a.reasoningStats ?? []),
    ],
    confidenceRating: a.hitConfidence,
    historyFlag: a.historyFlag ?? "",
    modelProbability: p,
    marketProbability: price / 100,
    ev: p * decimal - 1,
    confidence: a.hitConfidence,
    rating: a.rating,
    reason: a.reason,
    opponentTier: a.opponentTier,
  };
};

const scan = async (scope: ScanScope, profile: VaultProfile | null): Promise<SoccerRecommendation> => {
  const candidates = await soccerCandidates(scope);
  const { researched, skipped } = await researchAll(candidates, describeVaultProfile(profile));

  // Legs the research couldn't ground are never recommended: no guessing on thin data.
  const grounded = researched.filter((r) => r.a.researched && r.a.dataSufficient);
  const insufficient = researched.filter((r) => r.a.researched && !r.a.dataSufficient).length;
  const scored = grounded.flatMap((r) => (r.c.leg.price === null ? [] : [toPick(r, r.c.leg.price)]));

  // Only legs the model rates as real value: +EV after Kalshi's fee, a coin flip or better,
  // backed by real confidence, and never a bum pick or trap game. Ranked by edge after fees,
  // then confidence, then win probability.
  const minProbability = scope.window === "futures" ? MIN_FUTURES_PROBABILITY : MIN_PROBABILITY;
  const qualified = scored
    .filter(
      (l) =>
        l.ev > 0 &&
        l.modelProbability >= minProbability &&
        l.confidenceRating >= MIN_CONFIDENCE &&
        l.rating !== "BUM PICK" &&
        !l.opponentTier.trapGame
    )
    .sort((a, b) => {
      const edge = (l: RecommendedLeg) => l.modelProbability - l.marketProbability - kalshiFee(l.marketProbability);
      return edge(b) - edge(a) || b.confidenceRating - a.confidenceRating || b.modelProbability - a.modelProbability;
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
      insufficient,
    },
    history: { applied: !!profile && profile.settled > 0, settled: profile?.settled ?? 0 },
    generatedAt: new Date().toISOString(),
    note:
      [
        legs.length < PARLAY_LEGS
          ? `Only ${legs.length} leg${legs.length === 1 ? "" : "s"} cleared the bar (+EV, ≥${Math.round(minProbability * 100)}% to win, confidence ${MIN_CONFIDENCE}+/10, no bum picks) — the scanner doesn't pad a ticket with -EV legs.`
          : null,
        insufficient
          ? `${insufficient} fixture${insufficient === 1 ? "" : "s"} skipped for insufficient data — not enough verifiable stats to rate them.`
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

type Body = Partial<Record<keyof ScanScope | "history", unknown>>;

/** The scope from the request body; anything missing falls back to every league, this week. */
const readScope = (body: Body): ScanScope => {
  const window = isTimeWindow(body.window) ? body.window : "week";
  const fallback = windowRange(window, Date.now());
  const from = typeof body.from === "number" && Number.isFinite(body.from) ? body.from : fallback.from;
  const to = typeof body.to === "number" && Number.isFinite(body.to) ? body.to : fallback.to;
  const leagues = Array.isArray(body.leagues) ? body.leagues.filter(isScanLeague) : [];
  return { window, from, to: Math.max(from, to), leagues: leagues.length ? leagues : [...SCAN_LEAGUES] };
};

/** The Bet Vault profile from the Upstash vault when it's connected, else the one the browser sent. */
const loadProfile = async (sent: unknown): Promise<VaultProfile | null> => {
  try {
    const records = await readVault();
    if (records) return vaultProfile(records);
  } catch {
    // Fall through to the client copy.
  }
  return sanitizeVaultProfile(sent);
};

/** Short, stable hash, so a changed Bet Vault record means a fresh scan rather than a stale cache hit. */
const hash = (text: string) => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** One cache entry per league set, hour-rounded window, and Bet Vault profile. */
const cacheKey = (scope: ScanScope, history: string) => {
  const hour = 60 * 60 * 1000;
  const range = scope.window === "futures" ? "" : `:${Math.floor(scope.from / hour)}`;
  return `${CACHE_KEY}:${scope.window}${range}:${[...scope.leagues].sort().join(",")}:${hash(history)}`;
};

/**
 * Scans soccer markets on Kalshi in the requested leagues and time window and returns the
 * best +EV legs as a 5-leg ticket, each in a fixed pick structure. Body: ScanScope plus
 * `history`, a VaultProfile of the bettor's Bet Vault (used when Upstash isn't connected).
 * Results are cached for 30 minutes (when Upstash is connected) because each scan runs a
 * research call for every fixture in scope; `?fresh=1` forces a new scan.
 */
export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI not configured" }, { status: 503 });

  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const body = ((await request.json().catch(() => null)) ?? {}) as Body;
  const scope = readScope(body);
  const profile = await loadProfile(body.history);
  const key = cacheKey(scope, describeVaultProfile(profile));
  if (!fresh) {
    const cached = await redis(["GET", key]).catch(() => null);
    if (typeof cached?.result === "string") {
      return Response.json({ ...(JSON.parse(cached.result) as SoccerRecommendation), cached: true });
    }
  }

  try {
    const result = await scan(scope, profile);
    if (result.legs.length) {
      await redis(["SET", key, JSON.stringify(result), "EX", CACHE_SECONDS]).catch(() => null);
    }
    return Response.json(result);
  } catch {
    return Response.json({ error: "Scan failed — Kalshi or the AI didn't respond" }, { status: 502 });
  }
}
