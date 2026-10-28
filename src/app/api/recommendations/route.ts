import { checkAccess } from "@/lib/bet/access";
import { fullKelly } from "@/lib/bet/bankroll";
import { decimalToAmerican, kalshiDecimal, kalshiFee } from "@/lib/bet/engine";
import { footballConfigured, footballFacts } from "@/lib/bet/football-api";
import { describeVaultProfile, sanitizeVaultProfile, vaultProfile } from "@/lib/bet/history";
import { soccerCandidates, type SoccerCandidate } from "@/lib/bet/kalshi-api";
import { BET_MODEL, DEEP_MODEL } from "@/lib/bet/model";
import { researchLeg } from "@/lib/bet/research";
import { isScanLeague, isTimeWindow, kickoffOf, SCAN_LEAGUES, windowRange, type ScanScope } from "@/lib/bet/scan-scope";
import { sharpLines } from "@/lib/bet/sharp";
import { readVault, redis } from "@/lib/bet/store";
import { trackPicks } from "@/lib/bet/track";
import type { LegAnalysis, RecommendedLeg, SharpLine, SoccerRecommendation, VaultProfile } from "@/types/bet";

export const dynamic = "force-dynamic";
// Every fixture in scope is screened, then finalists get a deep pass; the Hobby plan's ceiling.
export const maxDuration = 300;

const PARLAY_LEGS = 5;
/** Screen calls in flight at once: wide enough to cover a month of fixtures, narrow enough for API rate limits. */
const CONCURRENCY = 16;
/** Screen: no new research after this, and anything unfinished is dropped at the hard stop. */
const SCREEN_START_MS = 120_000;
const SCREEN_HARD_MS = 170_000;
/** Deep stage: every finalist runs at once; whatever hasn't finished by this keeps its screen result. */
const DEEP_HARD_MS = 285_000;
/** Finalists re-researched on the deep model. */
const DEEP_COUNT = 8;
/** A recommended match leg must be at least a coin flip. */
const MIN_PROBABILITY = 0.5;
/** Title races rarely have a coin-flip favorite, so a futures leg only needs a real chance. */
const MIN_FUTURES_PROBABILITY = 0.25;
/** An AI-only leg needs at least solid, partial evidence behind it (1-10 scale). */
const MIN_CONFIDENCE = 4;
/** A sharp-anchored leg needs Kalshi at least this far below the sharp price, after fees. */
const MIN_SHARP_EDGE = 0.01;
/** The AI vetoes a sharp-anchored leg when its own estimate sits this far below the books. */
const AI_VETO_GAP = 0.08;
const CACHE_KEY = "vindle_soccer_recs";
const CACHE_SECONDS = 30 * 60;

type Candidate = SoccerCandidate & { sharp?: SharpLine };
type Researched = { c: Candidate; a: LegAnalysis; deep: boolean; footballData: boolean };

const timeout = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/**
 * Screens candidates on the fast model, CONCURRENCY at a time, best price edge first (then
 * most-traded), so the fixtures most likely to make the ticket are never the ones that run
 * out of time. Every leg is its own fresh, stateless call carrying the same vault profile.
 */
const screen = async (candidates: Candidate[], history: string, started: number) => {
  const queue = [...candidates].sort((a, b) => (b.sharp?.edge ?? -1) - (a.sharp?.edge ?? -1) || b.volume - a.volume);
  const done: Researched[] = [];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      if (Date.now() - started > SCREEN_START_MS) continue;
      done.push({ c, a: await researchLeg(c.leg, history), deep: false, footballData: false });
    }
  };
  await Promise.race([Promise.all(Array.from({ length: CONCURRENCY }, worker)), timeout(SCREEN_HARD_MS - (Date.now() - started))]);
  // Calls still running at the cutoff count as unresearched; the snapshot ignores their late results.
  return [...done];
};

/** Re-researches finalists on the deep model with API-Football data; unfinished ones keep their screen result. */
const deepen = async (finalists: Researched[], history: string, started: number) => {
  const out = new Map<string, Researched>();
  await Promise.race([
    Promise.all(
      finalists.map(async (r) => {
        const facts = r.c.futures
          ? null
          : await footballFacts(r.c.league as (typeof SCAN_LEAGUES)[number], r.c.leg.matchup, new Date(kickoffOf(r.c.settlesAt)).toISOString());
        const a = await researchLeg(r.c.leg, history, { deep: true, facts: facts?.text });
        // A failed deep call keeps the screen's analysis rather than throwing it away.
        if (!a.researched) return;
        out.set(r.c.leg.ticker ?? r.c.eventTicker, {
          c: r.c,
          a: facts ? { ...a, reasoningStats: mergeStats(facts.stats, a.reasoningStats ?? []) } : a,
          deep: true,
          footballData: !!facts,
        });
      })
    ),
    timeout(DEEP_HARD_MS - (Date.now() - started)),
  ]);
  return finalists.map((r) => out.get(r.c.leg.ticker ?? r.c.eventTicker) ?? r);
};

/** Verified stats first, then the model's, without repeating a metric. */
const mergeStats = (verified: LegAnalysis["reasoningStats"] = [], model: LegAnalysis["reasoningStats"] = []) => {
  const seen = new Set(verified.map((s) => s.metric.toLowerCase()));
  return [...verified, ...model.filter((s) => !seen.has(s.metric.toLowerCase()))].slice(0, 10);
};

const percent = (n: number) => `${Math.round(n * 100)}%`;
const pts = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)} pts`;

/**
 * The fixed pick record: fixture facts from Kalshi, probability from the sharp books when
 * they price the match (else the AI), line value computed here, analysis from the model.
 */
const toPick = ({ c, a, deep, footballData }: Researched): RecommendedLeg => {
  const price = c.leg.price!;
  const decimal = kalshiDecimal(price);
  const basis = c.sharp ? "sharp" : "ai";
  const p = c.sharp ? c.sharp.fair : a.probability;
  const edge = c.sharp ? c.sharp.edge : p - price / 100 - kalshiFee(price / 100);
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
      ...(c.sharp ? [{ metric: "Sharp fair probability", value: percent(c.sharp.fair), source: c.sharp.source }] : []),
      { metric: "Edge after Kalshi fee", value: pts(edge), source: c.sharp ? "Vindle (vs sharp books)" : "Vindle (vs AI estimate)" },
      ...(a.reasoningStats ?? []),
    ],
    confidenceRating: a.hitConfidence,
    historyFlag: a.historyFlag ?? "",
    basis,
    ...(c.sharp ? { sharp: c.sharp } : {}),
    aiProbability: a.probability,
    deep,
    footballData,
    kelly: fullKelly(p, decimal),
    modelProbability: p,
    marketProbability: price / 100,
    ev: p * decimal - 1,
    confidence: a.hitConfidence,
    rating: a.rating,
    reason: a.reason,
    opponentTier: a.opponentTier,
  };
};

/**
 * Whether a researched leg makes the ticket. Sharp-anchored: Kalshi must be cheaper than the
 * books by MIN_SHARP_EDGE after fees, and the AI can only veto (a bum pick, a trap game, or
 * grounded research well below the books). AI-only: +EV on the AI's grounded estimate with
 * real confidence.
 */
const qualifies = (r: Researched, minProbability: number) => {
  const { c, a } = r;
  if (c.leg.price === null || !a.researched) return false;
  const vetoed = a.rating === "BUM PICK" || a.opponentTier.trapGame;
  if (c.sharp) {
    const groundedDisagreement = !!a.dataSufficient && a.probability < c.sharp.fair - AI_VETO_GAP;
    return c.sharp.edge >= MIN_SHARP_EDGE && c.sharp.fair >= minProbability && !vetoed && !groundedDisagreement;
  }
  const ev = a.probability * kalshiDecimal(c.leg.price) - 1;
  return !!a.dataSufficient && ev > 0 && a.probability >= minProbability && a.hitConfidence >= MIN_CONFIDENCE && !vetoed;
};

const edgeOf = (l: RecommendedLeg) => l.modelProbability - l.marketProbability - kalshiFee(l.marketProbability);
const rank = (a: RecommendedLeg, b: RecommendedLeg) =>
  // Sharp-anchored edges are measured against the market's best price; they rank first.
  Number(b.basis === "sharp") - Number(a.basis === "sharp") ||
  edgeOf(b) - edgeOf(a) ||
  b.confidenceRating - a.confidenceRating;

const scan = async (scope: ScanScope, profile: VaultProfile | null): Promise<SoccerRecommendation> => {
  const started = Date.now();
  const history = describeVaultProfile(profile);
  const minProbability = scope.window === "futures" ? MIN_FUTURES_PROBABILITY : MIN_PROBABILITY;

  // 1. Every active fixture in scope, priced against the sharp books (no AI).
  const raw = await soccerCandidates(scope);
  const sharp = await sharpLines(raw);
  const candidates: Candidate[] = raw.map((c) => {
    const line = c.leg.ticker ? sharp.lines.get(c.leg.ticker) : undefined;
    return line ? { ...c, sharp: line } : c;
  });
  // Where the books price a match and Kalshi isn't cheaper, there's no edge to research.
  const worthResearching = candidates.filter((c) => !c.sharp || c.sharp.edge >= MIN_SHARP_EDGE);
  const noPriceEdge = candidates.length - worthResearching.length;

  // 2. Screen every remaining fixture on the fast model.
  const screened = await screen(worthResearching, history, started);
  const skipped = worthResearching.length - screened.length;

  // 3. Deep pass on the finalists: the deep model, more searches, API-Football data.
  const firstCut = screened.filter((r) => qualifies(r, minProbability));
  const finalists = firstCut
    .map((r) => ({ r, pick: toPick(r) }))
    .sort((x, y) => rank(x.pick, y.pick))
    .slice(0, DEEP_COUNT)
    .map((x) => x.r);
  const deepened = await deepen(finalists, history, started);

  const qualified = deepened
    .filter((r) => qualifies(r, minProbability))
    .map(toPick)
    .sort(rank);
  const legs = qualified.slice(0, PARLAY_LEGS);

  let parlay: SoccerRecommendation["parlay"] = null;
  if (legs.length >= 2) {
    const probability = legs.reduce((acc, l) => acc * l.modelProbability, 1);
    const decimal = legs.reduce((acc, l) => acc * kalshiDecimal(l.leg.price!), 1);
    parlay = { probability, decimal, american: decimalToAmerican(decimal), ev: probability * decimal - 1 };
  }

  const insufficient = screened.filter((r) => r.a.researched && !r.a.dataSufficient && !r.c.sharp).length;
  const football = footballConfigured();
  return {
    legs,
    parlay,
    scanned: {
      fixtures: candidates.length,
      researched: screened.filter((r) => r.a.researched).length,
      qualified: qualified.length,
      skipped,
      insufficient,
      sharpLines: sharp.lines.size,
      noPriceEdge,
      deep: deepened.filter((r) => r.deep).length,
    },
    sources: { sharp: sharp.configured, football },
    history: { applied: !!profile && profile.settled > 0, settled: profile?.settled ?? 0 },
    generatedAt: new Date().toISOString(),
    note:
      [
        legs.length < PARLAY_LEGS
          ? `Only ${legs.length} leg${legs.length === 1 ? "" : "s"} cleared the bar — the scanner doesn't pad a ticket with -EV legs.`
          : null,
        noPriceEdge
          ? `${noPriceEdge} fixture${noPriceEdge === 1 ? "" : "s"} skipped without research: Kalshi wasn't cheaper than the sharp books.`
          : null,
        insufficient
          ? `${insufficient} fixture${insufficient === 1 ? "" : "s"} without a book line had too little verifiable data to rate.`
          : null,
        skipped
          ? `${skipped} fixture${skipped === 1 ? "" : "s"} ran out of research time — narrow the leagues or timeframe to cover them all.`
          : null,
        sharp.configured ? null : "Sharp-book pricing is off (set ODDS_API_KEY): picks rest on the AI's estimate alone.",
      ]
        .filter(Boolean)
        .join(" ") || null,
    model: finalists.length ? `${BET_MODEL} → ${DEEP_MODEL}` : BET_MODEL,
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
  return `${CACHE_KEY}:v2:${scope.window}${range}:${[...scope.leagues].sort().join(",")}:${hash(history)}`;
};

/**
 * Scans soccer markets on Kalshi in the requested leagues and time window and returns the
 * best +EV legs, each in a fixed pick structure. Body: ScanScope plus `history`, a
 * VaultProfile of the bettor's Bet Vault (used when Upstash isn't connected). Every pick is
 * also logged to the scanner's track record. Results are cached for 30 minutes (when
 * Upstash is connected); `?fresh=1` forces a new scan.
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
      await Promise.all([
        redis(["SET", key, JSON.stringify(result), "EX", CACHE_SECONDS]).catch(() => null),
        trackPicks(result.legs),
      ]);
    }
    return Response.json(result);
  } catch {
    return Response.json({ error: "Scan failed — Kalshi or the AI didn't respond" }, { status: 502 });
  }
}
