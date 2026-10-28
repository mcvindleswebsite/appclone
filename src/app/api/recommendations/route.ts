import { checkAccess } from "@/lib/bet/access";
import { fullKelly } from "@/lib/bet/bankroll";
import { decimalToAmerican, kalshiDecimal, kalshiFee } from "@/lib/bet/engine";
import { spotOf, standings, type TableSpot } from "@/lib/bet/football-api";
import { describeVaultProfile } from "@/lib/bet/history";
import { soccerCandidates, type SoccerCandidate } from "@/lib/bet/kalshi-api";
import { BET_MODEL } from "@/lib/bet/model";
import {
  failReason,
  isMismatch,
  marketWinProbability,
  MISMATCH,
  mismatchFailReason,
  OPINION,
  opinionFailReason,
  MIN_VOLUME,
  minSharpEdge,
  SAFE_MIN_PROBABILITY,
  safeFailReason,
  type TableMatchup,
} from "@/lib/bet/picks";
import { loadProfile } from "@/lib/bet/profile";
import { researchLeg } from "@/lib/bet/research";
import { isScanLeague, isTimeWindow, kickoffOf, SCAN_LEAGUES, windowRange, type ScanLeague, type ScanScope } from "@/lib/bet/scan-scope";
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
 * AI research per scan is capped: every fixture is priced and filtered for free, but only this
 * many of the best candidates get a (paid) research call. Each call is up to 2 web searches
 * (~$0.02) plus Haiku tokens.
 */
const RESEARCH_BUDGET = 15;
const CONCURRENCY = 8;
/** Anything still researching at this point is dropped and the scan returns what it has. */
const SCREEN_HARD_MS = 100_000;
const CACHE_KEY = "vindle_soccer_recs";
const CACHE_SECONDS = 30 * 60;

type Candidate = SoccerCandidate & { sharp?: SharpLine; table?: TableMatchup };
type PickMode = NonNullable<SoccerRecommendation["mode"]>;
type Researched = { c: Candidate; a: LegAnalysis };

const winChance = (c: Candidate) => marketWinProbability({ price: c.leg.price, volume: c.volume, sharp: c.sharp });

/**
 * How each Top Picks mode chooses. `eligible` runs before any AI cost; `order` decides who gets
 * the research budget; `fails` is the bar after research; `probability` is what the pick rests on.
 *
 * - mismatch: a good-not-elite team against a bottom-third one, from the real league table.
 * - safe: the likeliest winners (60%+ by the market's best price).
 * - ai: the AI's own estimate beats the Kalshi price (the books' price is shown, not used).
 * - sharp: Kalshi cheaper than the sharp books; the AI only vetoes.
 */
const STRATEGIES: Record<
  PickMode,
  {
    minVolume: number;
    eligible: (c: Candidate) => boolean;
    order: (a: Candidate, b: Candidate) => number;
    fails: (r: Researched) => string | null;
    probability: (r: Researched) => number;
  }
> = {
  opinion: {
    minVolume: OPINION.minVolume,
    eligible: (c) => winChance(c) >= OPINION.minMarket,
    // Research the clearest favorites first, so the budget goes where the AI is likeliest to agree.
    order: (a, b) => winChance(b) - winChance(a),
    fails: ({ c, a }) => opinionFailReason({ price: c.leg.price, volume: c.volume, futures: c.futures }, a),
    probability: ({ a }) => a.probability,
  },
  mismatch: {
    minVolume: MISMATCH.minVolume,
    eligible: (c) => !c.futures && !!c.table && isMismatch(c.table) && winChance(c) >= MISMATCH.minProbability,
    // Biggest table gap first, then the likelier winner.
    order: (a, b) => b.table!.opponent.rank - b.table!.pick.rank - (a.table!.opponent.rank - a.table!.pick.rank) || winChance(b) - winChance(a),
    fails: ({ c, a }) => mismatchFailReason({ price: c.leg.price, volume: c.volume, sharp: c.sharp }, a),
    probability: ({ c }) => winChance(c),
  },
  safe: {
    minVolume: MIN_VOLUME,
    eligible: (c) => winChance(c) >= SAFE_MIN_PROBABILITY,
    order: (a, b) => winChance(b) - winChance(a),
    fails: ({ c, a }) => safeFailReason({ price: c.leg.price, volume: c.volume, sharp: c.sharp, futures: c.futures }, a),
    probability: ({ c }) => winChance(c),
  },
  ai: {
    minVolume: MIN_VOLUME,
    eligible: () => true,
    // The most-traded matches are the best-covered games.
    order: (a, b) => b.volume - a.volume,
    fails: ({ c, a }) => failReason({ price: c.leg.price, volume: c.volume, futures: c.futures }, a),
    probability: ({ a }) => a.probability,
  },
  sharp: {
    minVolume: MIN_VOLUME,
    eligible: (c) => !c.sharp || c.sharp.edge >= minSharpEdge(c.volume),
    order: (a, b) => (b.sharp?.edge ?? -1) - (a.sharp?.edge ?? -1),
    fails: ({ c, a }) => failReason({ price: c.leg.price, volume: c.volume, sharp: c.sharp, futures: c.futures }, a),
    probability: ({ c, a }) => c.sharp?.fair ?? a.probability,
  },
};

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

const teamsOf = (matchup: string) => matchup.split(/\s+(?:vs\.?|v\.?|@|at)\s+/i).map((t) => t.trim());

/** League-table spots for each candidate's pick and opponent (API-Football standings, cached). */
const withTables = async (candidates: Candidate[]) => {
  const leagues = [...new Set(candidates.map((c) => c.league))] as ScanLeague[];
  const tables = new Map<string, Map<string, TableSpot> | null>(
    await Promise.all(leagues.map(async (l) => [l, await standings(l).catch(() => null)] as const))
  );
  const out = candidates.map((c): Candidate => {
    const table = tables.get(c.league);
    const teams = teamsOf(c.leg.matchup);
    if (!table || teams.length !== 2) return c;
    const pickName = c.leg.pick;
    const opponentName = teams.find((t) => t !== pickName) ?? "";
    const pick = spotOf(table, pickName);
    const opponent = spotOf(table, opponentName);
    // A pick and opponent from different conferences (MLS) aren't on one table.
    if (!pick || !opponent || pick === opponent || pick.of !== opponent.of) return c;
    return { ...c, table: { pick: { rank: pick.rank, form: pick.form }, opponent: { rank: opponent.rank, form: opponent.form }, of: pick.of } };
  });
  const missing = leagues.filter((l) => !tables.get(l));
  return { candidates: out, missing };
};

const percent = (n: number) => `${Math.round(n * 100)}%`;
const pts = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)} pts`;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;

/**
 * The fixed pick record: fixture facts from Kalshi, probability per the mode's strategy, line
 * value computed here, analysis from the model.
 */
const toPick = (r: Researched, mode: PickMode): RecommendedLeg => {
  const { c, a } = r;
  const price = c.leg.price!;
  const decimal = kalshiDecimal(price);
  // AI Picks are tracked with the other AI-judged picks.
  const basis = mode === "opinion" || (mode === "sharp" && !c.sharp) ? "ai" : mode;
  const p = STRATEGIES[mode].probability(r);
  const edge = basis === "sharp" ? c.sharp!.edge : p - price / 100 - kalshiFee(price / 100);
  const opponent = teamsOf(c.leg.matchup).find((t) => t !== c.leg.pick) ?? "opponent";
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
      ...(c.table
        ? [
            {
              metric: "League table",
              value: `${c.leg.pick} ${ordinal(c.table.pick.rank)} vs ${opponent} ${ordinal(c.table.opponent.rank)} of ${c.table.of}`,
              source: "API-Football",
            },
          ]
        : []),
      { metric: "Kalshi implied probability", value: percent(price / 100), source: "Kalshi" },
      ...(c.sharp ? [{ metric: "Sharp fair probability", value: percent(c.sharp.fair), source: c.sharp.source }] : []),
      { metric: "Edge after Kalshi fee", value: pts(edge), source: basis === "ai" ? "Vindle (vs AI estimate)" : "Vindle (vs sharp books)" },
      { metric: "Kalshi volume", value: `$${Math.round(c.volume).toLocaleString("en-US")}`, source: "Kalshi" },
      ...(a.reasoningStats ?? []),
    ],
    confidenceRating: a.hitConfidence,
    historyFlag: a.historyFlag ?? "",
    basis,
    ...(c.sharp ? { sharp: c.sharp } : {}),
    ...(c.table ? { table: c.table } : {}),
    ...(c.volume < MIN_VOLUME ? { thin: true } : {}),
    aiProbability: a.probability,
    deep: false,
    footballData: !!c.table,
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

/** Final ordering, per mode: the same order the research budget was spent in. */
const rank = (mode: PickMode) => (a: RecommendedLeg, b: RecommendedLeg) => {
  if (mode === "mismatch" && a.table && b.table) {
    return b.table.opponent.rank - b.table.pick.rank - (a.table.opponent.rank - a.table.pick.rank) || b.modelProbability - a.modelProbability;
  }
  if (mode === "safe") return b.modelProbability - a.modelProbability || b.confidenceRating - a.confidenceRating;
  // AI Picks: the AI's surest calls first — its win probability weighted by its confidence.
  if (mode === "opinion") return b.modelProbability * b.confidenceRating - a.modelProbability * a.confidenceRating;
  // Sharp-anchored edges are measured against the market's best price; they rank first.
  return Number(b.basis === "sharp") - Number(a.basis === "sharp") || edgeOf(b) - edgeOf(a) || b.confidenceRating - a.confidenceRating;
};

/** Best picks first: at most MAX_PER_LEAGUE from one league, and one pick per team. */
const spread = (picks: RecommendedLeg[]) => {
  const perLeague = new Map<string, number>();
  const teams = new Set<string>();
  return picks.filter((p) => {
    const n = perLeague.get(p.league) ?? 0;
    const team = p.pick.toLowerCase();
    if (n >= MAX_PER_LEAGUE || teams.has(team)) return false;
    perLeague.set(p.league, n + 1);
    teams.add(team);
    return true;
  });
};

const scan = async (scope: ScanScope, profile: VaultProfile | null, mode: PickMode): Promise<SoccerRecommendation> => {
  const history = describeVaultProfile(profile);
  const strategy = STRATEGIES[mode];

  // 1. Every active fixture in scope, priced against the sharp books (free, no AI), and for
  //    Mismatches placed on the real league table.
  const raw = await soccerCandidates(scope);
  const sharp = await sharpLines(raw);
  const priced: Candidate[] = raw.map((c) => {
    const line = c.leg.ticker ? sharp.lines.get(c.leg.ticker) : undefined;
    return line ? { ...c, sharp: line } : c;
  });
  const tabled = mode === "mismatch" ? await withTables(priced) : { candidates: priced, missing: [] as ScanLeague[] };
  const candidates = tabled.candidates;

  // 2. Drop what can't be a pick before paying for research.
  const thin = candidates.filter((c) => !c.futures && c.volume < strategy.minVolume).length;
  const liquid = candidates.filter((c) => c.futures || c.volume >= strategy.minVolume);
  const eligible = liquid.filter(strategy.eligible);
  const noPriceEdge = mode === "sharp" ? liquid.length - eligible.length : 0;

  // 3. Research the best RESEARCH_BUDGET in the mode's order, no more than a few per league.
  const perLeague = new Map<string, number>();
  const shortlist = [...eligible]
    .sort((a, b) => strategy.order(a, b) || b.volume - a.volume)
    .filter((c) => {
      const n = perLeague.get(c.league) ?? 0;
      if (n >= 4) return false;
      perLeague.set(c.league, n + 1);
      return true;
    })
    .slice(0, RESEARCH_BUDGET);
  const unresearched = eligible.length - shortlist.length;
  const screened = await screen(shortlist, history);

  const qualified = screened
    .filter((r) => strategy.fails(r) === null)
    .map((r) => toPick(r, mode))
    .sort(rank(mode));
  const legs = spread(qualified).slice(0, MAX_PICKS);

  let parlay: SoccerRecommendation["parlay"] = null;
  if (legs.length >= 2) {
    const probability = legs.reduce((acc, l) => acc * l.modelProbability, 1);
    const decimal = legs.reduce((acc, l) => acc * kalshiDecimal(l.leg.price!), 1);
    parlay = { probability, decimal, american: decimalToAmerican(decimal), ev: probability * decimal - 1 };
  }

  const insufficient = screened.filter((r) => r.a.researched && !r.a.dataSufficient && (mode === "ai" || !r.c.sharp)).length;
  // Every research call failing at once is the API, not the matches: usually spent credits.
  const aiFailed = screened.length > 0 && screened.every((r) => !r.a.researched);
  const tradable = candidates.filter((c) => c.volume >= MIN_VOLUME).length;
  const valueNote =
    (mode === "safe" || mode === "mismatch" || mode === "opinion") && legs.length
      ? `${{ safe: "Safest Wins", mismatch: "Mismatches", opinion: "AI Picks" }[mode]} picks on who wins, not the price: these average ${pts(
          legs.reduce((s, l) => s + l.ev, 0) / legs.length
        ).replace(" pts", "%")} EV each at Kalshi's prices, and a ${legs.length}-leg parlay of them hits about ${percent(
          legs.reduce((acc, l) => acc * l.modelProbability, 1)
        )} of the time.`
      : null;
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
        aiFailed
          ? `AI research failed for all ${screened.length} matches — the Anthropic API refused the calls. Check your credits at console.anthropic.com, then Rescan.`
          : null,
        candidates.length < 10
          ? `Kalshi only lists ${candidates.length} soccer match${candidates.length === 1 ? "" : "es"} in this window (${tradable} with real trading) — try This Week for more.`
          : null,
        legs.length === 0 && !aiFailed
          ? mode === "mismatch"
            ? `No mismatches this scan: no non-top-3 favorite facing a bottom-third side by ${Math.round(MISMATCH.minGapShare * 100)}%+ of the table.`
            : mode === "opinion"
              ? `The AI didn't rate any researched favorite ${Math.round(OPINION.minProbability * 100)}%+ to win with ${OPINION.minConfidence}/10+ confidence.`
              : "Nothing cleared the bar this scan."
          : null,
        valueNote,
        mode === "mismatch" && tabled.missing.length
          ? `No league table from API-Football for ${tabled.missing.join(", ")}${
              process.env.FOOTBALL_API_KEY ? " (the plan may not cover this season)" : " (FOOTBALL_API_KEY not set)"
            } — those matches can't be checked.`
          : null,
        noPriceEdge ? `${noPriceEdge} match${noPriceEdge === 1 ? "" : "es"} skipped: Kalshi wasn't cheaper than the sharp books.` : null,
        thin ? `${thin} market${thin === 1 ? "" : "s"} under $${strategy.minVolume.toLocaleString("en-US")} traded skipped as too thin.` : null,
        unresearched ? `${unresearched} more candidate${unresearched === 1 ? "" : "s"} not researched (budget ${RESEARCH_BUDGET} a scan).` : null,
        insufficient ? `${insufficient} had too little verifiable data to rate.` : null,
        sharp.configured || mode !== "sharp" ? null : "Sharp-book pricing is OFF (ODDS_API_KEY not set): every pick rests on the AI alone.",
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
  const mode: PickMode = (["sharp", "safe", "ai", "mismatch"] as const).find((m) => m === body.mode) ?? "opinion";
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
