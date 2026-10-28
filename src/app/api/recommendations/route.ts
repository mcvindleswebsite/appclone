import { checkAccess } from "@/lib/bet/access";
import { fullKelly } from "@/lib/bet/bankroll";
import { decimalToAmerican, kalshiDecimal, kalshiFee } from "@/lib/bet/engine";
import { describeVaultProfile } from "@/lib/bet/history";
import { soccerCandidates, type SoccerCandidate } from "@/lib/bet/kalshi-api";
import { BET_MODEL } from "@/lib/bet/model";
import { failReason, MIN_VOLUME, minSharpEdge } from "@/lib/bet/picks";
import { loadProfile } from "@/lib/bet/profile";
import { researchLeg } from "@/lib/bet/research";
import { isScanLeague, isTimeWindow, kickoffOf, SCAN_LEAGUES, windowRange, type ScanScope } from "@/lib/bet/scan-scope";
import { sharpLines } from "@/lib/bet/sharp";
import { redis } from "@/lib/bet/store";
import { trackPicks } from "@/lib/bet/track";
import type { LegAnalysis, RecommendedLeg, SharpLine, SoccerRecommendation, VaultProfile } from "@/types/bet";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_PICKS = 5;
/** No league fills more than this many picks, so one busy midweek can't take over the list. */
const MAX_PER_LEAGUE = 2;
/**
 * AI research per scan is capped: every fixture is priced against the sharp books for free,
 * but only this many of the best candidates get a (paid) research call. Each call is up to
 * 2 web searches (~$0.02) plus Haiku tokens.
 */
const RESEARCH_BUDGET = 15;
const CONCURRENCY = 8;
/** Anything still researching at this point is dropped and the scan returns what it has. */
const SCREEN_HARD_MS = 100_000;
const CACHE_KEY = "vindle_soccer_recs";
const CACHE_SECONDS = 30 * 60;

type Candidate = SoccerCandidate & { sharp?: SharpLine };
/**
 * "ai": picks rest on the AI's own estimate beating the Kalshi price (the books' price is
 * shown, not used). "sharp": picks need Kalshi cheaper than the sharp books; the AI only vetoes.
 */
type PickMode = SoccerRecommendation["mode"] & string;
type Researched = { c: Candidate; a: LegAnalysis };

const timeout = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** Researches the shortlist on the fast model; each leg is its own fresh, stateless call. */
const screen = async (shortlist: Candidate[], history: string) => {
  const queue = [...shortlist];
  const done: Researched[] = [];
  const worker = async () => {
    for (let c = queue.shift(); c; c = queue.shift()) done.push({ c, a: await researchLeg(c.leg, history) });
  };
  await Promise.race([Promise.all(Array.from({ length: CONCURRENCY }, worker)), timeout(SCREEN_HARD_MS)]);
  // Calls still running at the cutoff count as unresearched; the snapshot ignores their late results.
  return [...done];
};

const percent = (n: number) => `${Math.round(n * 100)}%`;
const pts = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)} pts`;

/**
 * The fixed pick record: fixture facts from Kalshi, probability from the sharp books when
 * they price the match (else the AI), line value computed here, analysis from the model.
 */
const toPick = ({ c, a }: Researched, mode: PickMode): RecommendedLeg => {
  const price = c.leg.price!;
  const decimal = kalshiDecimal(price);
  // AI mode always rests on the AI's estimate; the books' price is shown, never used.
  const basis = mode === "sharp" && c.sharp ? "sharp" : "ai";
  const p = basis === "sharp" ? c.sharp!.fair : a.probability;
  const edge = basis === "sharp" ? c.sharp!.edge : p - price / 100 - kalshiFee(price / 100);
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
      { metric: "Edge after Kalshi fee", value: pts(edge), source: basis === "sharp" ? "Vindle (vs sharp books)" : "Vindle (vs AI estimate)" },
      { metric: "Kalshi volume", value: `$${Math.round(c.volume).toLocaleString("en-US")}`, source: "Kalshi" },
      ...(a.reasoningStats ?? []),
    ],
    confidenceRating: a.hitConfidence,
    historyFlag: a.historyFlag ?? "",
    basis,
    ...(c.sharp ? { sharp: c.sharp } : {}),
    aiProbability: a.probability,
    deep: false,
    footballData: false,
    kelly: fullKelly(p, decimal),
    volume: c.volume,
    modelProbability: p,
    marketProbability: price / 100,
    ev: p * decimal - 1,
    confidence: a.hitConfidence,
    rating: a.rating,
    reason: a.reason,
    opponentTier: a.opponentTier,
  };
};

const edgeOf = (l: RecommendedLeg) => l.modelProbability - l.marketProbability - kalshiFee(l.marketProbability);
const rank = (a: RecommendedLeg, b: RecommendedLeg) =>
  // Sharp-anchored edges are measured against the market's best price; they rank first.
  Number(b.basis === "sharp") - Number(a.basis === "sharp") || edgeOf(b) - edgeOf(a) || b.confidenceRating - a.confidenceRating;

/** Best picks first, at most MAX_PER_LEAGUE from any one league. */
const spread = (picks: RecommendedLeg[]) => {
  const perLeague = new Map<string, number>();
  return picks.filter((p) => {
    const n = perLeague.get(p.league) ?? 0;
    if (n >= MAX_PER_LEAGUE) return false;
    perLeague.set(p.league, n + 1);
    return true;
  });
};

const scan = async (scope: ScanScope, profile: VaultProfile | null, mode: PickMode): Promise<SoccerRecommendation> => {
  const history = describeVaultProfile(profile);

  // 1. Every active fixture in scope, priced against the sharp books (free, no AI).
  const raw = await soccerCandidates(scope);
  const sharp = await sharpLines(raw);
  const candidates: Candidate[] = raw.map((c) => {
    const line = c.leg.ticker ? sharp.lines.get(c.leg.ticker) : undefined;
    return line ? { ...c, sharp: line } : c;
  });

  // 2. Drop what can't be a pick before paying for research: thin markets, and (price-edge
  //    mode only) matches the books price where Kalshi isn't cheaper by enough.
  const thin = candidates.filter((c) => !c.futures && c.volume < MIN_VOLUME).length;
  const liquid = candidates.filter((c) => c.futures || c.volume >= MIN_VOLUME);
  const priced = mode === "ai" ? liquid : liquid.filter((c) => !c.sharp || c.sharp.edge >= minSharpEdge(c.volume));
  const noPriceEdge = liquid.length - priced.length;

  // 3. Research the best RESEARCH_BUDGET, no more than a few per league so one league can't
  //    use up the budget. AI mode takes the most-traded matches (the best-covered games);
  //    price-edge mode the biggest price gaps first.
  const perLeague = new Map<string, number>();
  const shortlist = [...priced]
    .sort((a, b) => (mode === "sharp" ? (b.sharp?.edge ?? -1) - (a.sharp?.edge ?? -1) : 0) || b.volume - a.volume)
    .filter((c) => {
      const n = perLeague.get(c.league) ?? 0;
      if (n >= 4) return false;
      perLeague.set(c.league, n + 1);
      return true;
    })
    .slice(0, RESEARCH_BUDGET);
  const unresearched = priced.length - shortlist.length;
  const screened = await screen(shortlist, history);

  const qualified = screened
    .filter(
      (r) =>
        failReason(
          { price: r.c.leg.price, volume: r.c.volume, sharp: mode === "sharp" ? r.c.sharp : undefined, futures: r.c.futures },
          r.a
        ) === null
    )
    .map((r) => toPick(r, mode))
    .sort(rank);
  const legs = spread(qualified).slice(0, MAX_PICKS);

  let parlay: SoccerRecommendation["parlay"] = null;
  if (legs.length >= 2) {
    const probability = legs.reduce((acc, l) => acc * l.modelProbability, 1);
    const decimal = legs.reduce((acc, l) => acc * kalshiDecimal(l.leg.price!), 1);
    parlay = { probability, decimal, american: decimalToAmerican(decimal), ev: probability * decimal - 1 };
  }

  const insufficient = screened.filter((r) => r.a.researched && !r.a.dataSufficient && (mode === "ai" || !r.c.sharp)).length;
  return {
    legs,
    parlay,
    scanned: {
      fixtures: candidates.length,
      researched: screened.filter((r) => r.a.researched).length,
      qualified: qualified.length,
      skipped: shortlist.length - screened.length,
      insufficient,
      sharpLines: sharp.lines.size,
      noPriceEdge,
      deep: 0,
    },
    sources: { sharp: sharp.configured, football: !!process.env.FOOTBALL_API_KEY },
    history: { applied: !!profile && profile.settled > 0, settled: profile?.settled ?? 0 },
    generatedAt: new Date().toISOString(),
    note:
      [
        legs.length === 0 ? "Nothing cleared the bar this scan — no pick beats a forced one." : null,
        noPriceEdge ? `${noPriceEdge} match${noPriceEdge === 1 ? "" : "es"} skipped: Kalshi wasn't cheaper than the sharp books.` : null,
        thin ? `${thin} market${thin === 1 ? "" : "s"} under $${MIN_VOLUME.toLocaleString("en-US")} traded skipped as too thin.` : null,
        unresearched ? `${unresearched} weaker candidate${unresearched === 1 ? "" : "s"} not researched (budget ${RESEARCH_BUDGET} a scan).` : null,
        insufficient ? `${insufficient} had too little verifiable data to rate.` : null,
        sharp.configured || mode === "ai" ? null : "Sharp-book pricing is OFF (ODDS_API_KEY not set): every pick rests on the AI alone.",
      ]
        .filter(Boolean)
        .join(" ") || null,
    model: BET_MODEL,
    scope,
    mode,
  };
};

type Body = Partial<Record<keyof ScanScope | "history" | "mode", unknown>>;

/** The scope from the request body; anything missing falls back to every league, this week. */
const readScope = (body: Body): ScanScope => {
  const window = isTimeWindow(body.window) ? body.window : "week";
  const fallback = windowRange(window, Date.now());
  const from = typeof body.from === "number" && Number.isFinite(body.from) ? body.from : fallback.from;
  const to = typeof body.to === "number" && Number.isFinite(body.to) ? body.to : fallback.to;
  const leagues = Array.isArray(body.leagues) ? body.leagues.filter(isScanLeague) : [];
  return { window, from, to: Math.max(from, to), leagues: leagues.length ? leagues : [...SCAN_LEAGUES] };
};

/** Short, stable hash, so a changed Bet Vault record means a fresh scan rather than a stale cache hit. */
const hash = (text: string) => {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
};

/** One cache entry per mode, league set, hour-rounded window, and Bet Vault profile. */
const cacheKey = (scope: ScanScope, history: string, mode: PickMode) => {
  const hour = 60 * 60 * 1000;
  const range = scope.window === "futures" ? "" : `:${Math.floor(scope.from / hour)}`;
  return `${CACHE_KEY}:v4:${mode}:${scope.window}${range}:${[...scope.leagues].sort().join(",")}:${hash(history)}`;
};

/**
 * Scans soccer markets on Kalshi in the requested leagues and time window and returns the
 * best +EV picks, each in a fixed pick structure. Body: ScanScope plus `history`, a
 * VaultProfile of the bettor's Bet Vault (used when Upstash isn't connected). Every pick is
 * also logged to the scanner's track record. Results are cached for 30 minutes (when
 * Upstash is connected); `?fresh=1` forces a new scan. The deep check is on demand, per pick
 * (/api/recommendations/deep).
 */
export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI not configured" }, { status: 503 });

  const fresh = new URL(request.url).searchParams.get("fresh") === "1";
  const body = ((await request.json().catch(() => null)) ?? {}) as Body;
  const scope = readScope(body);
  const mode: PickMode = body.mode === "sharp" ? "sharp" : "ai";
  const profile = await loadProfile(body.history);
  const key = cacheKey(scope, describeVaultProfile(profile), mode);
  if (!fresh) {
    const cached = await redis(["GET", key]).catch(() => null);
    if (typeof cached?.result === "string") {
      return Response.json({ ...(JSON.parse(cached.result) as SoccerRecommendation), cached: true });
    }
  }

  try {
    const result = await scan(scope, profile, mode);
    // Cached even when empty: an empty scan costs as much as a full one.
    await Promise.all([
      redis(["SET", key, JSON.stringify(result), "EX", CACHE_SECONDS]).catch(() => null),
      result.legs.length ? trackPicks(result.legs) : null,
    ]);
    return Response.json(result);
  } catch {
    return Response.json({ error: "Scan failed — Kalshi or the AI didn't respond" }, { status: 502 });
  }
}
