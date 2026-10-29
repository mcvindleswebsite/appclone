import { fullKelly } from "@/lib/bet/bankroll";
import { decimalToAmerican, kalshiDecimal, kalshiFee } from "@/lib/bet/engine";
import { spotOf, standings, type TableSpot } from "@/lib/bet/football-api";
import { espnStandings } from "@/lib/bet/espn";
import { describeVaultProfile } from "@/lib/bet/history";
import { scanCandidates, type ScanCandidate } from "@/lib/bet/kalshi-api";
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
import { researchLeg } from "@/lib/bet/research";
import { kickoffOf, sportOfLeague, type ScanLeague, type ScanScope } from "@/lib/bet/scan-scope";
import { sharpLines } from "@/lib/bet/sharp";
import type { LegAnalysis, RecommendedLeg, SharpLine, SoccerRecommendation, VaultProfile } from "@/types/bet";

/**
 * The Top Picks scan, shared by the Scanner's route (/api/recommendations) and the daily
 * paper bankroll run.
 */

const MAX_PICKS = 5;
/** No league fills more than this many picks, so one busy midweek can't take over the list. */
const MAX_PER_LEAGUE = 2;
/** AI Picks returns a wider pool, so the parlay builder can find legs for a target payout. */
const OPINION_POOL = { picks: 10, perLeague: 3 };
/**
 * AI research per scan is capped: every fixture is priced and filtered for free, but only this
 * many of the best candidates get a (paid) research call. Each call is up to 2 web searches
 * (~$0.02) plus Haiku tokens.
 */
const RESEARCH_BUDGET = 15;
const CONCURRENCY = 8;
/** Anything still researching at this point is dropped and the scan returns what it has. */
const SCREEN_HARD_MS = 100_000;

type Candidate = ScanCandidate & { sharp?: SharpLine; table?: TableMatchup };

/** Where a league's table comes from: API-Football for soccer, ESPN for basketball. */
const tableSource = (league: string) => (sportOfLeague(league) === "basketball" ? "ESPN" : "API-Football");
export type PickMode = NonNullable<SoccerRecommendation["mode"]>;
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
    // Research the parlay sweet spot first (around 60%, ~1.6x a leg): legs that actually move a
    // payout. Near-locks pay too little to matter in a parlay and come last.
    order: (a, b) => Math.abs(winChance(a) - OPINION.sweetSpot) - Math.abs(winChance(b) - OPINION.sweetSpot),
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

/** League-table spots for each candidate's pick and opponent (API-Football or ESPN standings, cached). */
const withTables = async (candidates: Candidate[]) => {
  const leagues = [...new Set(candidates.map((c) => c.league))] as ScanLeague[];
  const tables = new Map<string, Map<string, TableSpot> | null>(
    await Promise.all(
      leagues.map(async (l) => [l, await (tableSource(l) === "ESPN" ? espnStandings(l) : standings(l)).catch(() => null)] as const)
    )
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
    kickoffTime: new Date(c.futures ? Date.parse(c.settlesAt) : kickoffOf(c.settlesAt, c.league)).toISOString(),
    pick: c.leg.pick,
    odds: { kalshiCents: price, american: decimalToAmerican(decimal) },
    reasoningStats: [
      ...(c.table
        ? [
            {
              metric: "League table",
              value: `${c.leg.pick} ${ordinal(c.table.pick.rank)} vs ${opponent} ${ordinal(c.table.opponent.rank)} of ${c.table.of}`,
              source: tableSource(c.league),
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
    footballData: !!c.table && tableSource(c.league) === "API-Football",
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

/** Best picks first: at most `perLeague` from one league, and one pick per team. */
const spread = (picks: RecommendedLeg[], perLeagueCap = MAX_PER_LEAGUE) => {
  const perLeague = new Map<string, number>();
  const teams = new Set<string>();
  return picks.filter((p) => {
    const n = perLeague.get(p.league) ?? 0;
    const team = p.pick.toLowerCase();
    if (n >= perLeagueCap || teams.has(team)) return false;
    perLeague.set(p.league, n + 1);
    teams.add(team);
    return true;
  });
};

export const scan = async (scope: ScanScope, profile: VaultProfile | null, mode: PickMode): Promise<SoccerRecommendation> => {
  const history = describeVaultProfile(profile);
  const strategy = STRATEGIES[mode];

  // 1. Every active fixture in scope, priced against the sharp books (free, no AI), and for
  //    Mismatches placed on the real league table.
  const raw = await scanCandidates(scope);
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
  // A few leagues (basketball: mostly NBA and college) each get a bigger share of the budget.
  const active = new Set(eligible.map((c) => c.league)).size;
  const researchCap = Math.max(4, Math.ceil(RESEARCH_BUDGET / Math.max(1, active)));
  const pickCap = active <= 3 ? MAX_PER_LEAGUE + 1 : MAX_PER_LEAGUE;
  const perLeague = new Map<string, number>();
  const shortlist = [...eligible]
    .sort((a, b) => strategy.order(a, b) || b.volume - a.volume)
    .filter((c) => {
      const n = perLeague.get(c.league) ?? 0;
      if (n >= researchCap) return false;
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
  const legs =
    mode === "opinion"
      ? spread(qualified, active <= 3 ? OPINION_POOL.perLeague + 2 : OPINION_POOL.perLeague).slice(0, OPINION_POOL.picks)
      : spread(qualified, pickCap).slice(0, MAX_PICKS);

  let parlay: SoccerRecommendation["parlay"] = null;
  if (legs.length >= 2) {
    const probability = legs.reduce((acc, l) => acc * l.modelProbability, 1);
    const decimal = legs.reduce((acc, l) => acc * kalshiDecimal(l.leg.price!), 1);
    parlay = { probability, decimal, american: decimalToAmerican(decimal), ev: probability * decimal - 1 };
  }

  const missingSoccer = tabled.missing.filter((l) => tableSource(l) === "API-Football");
  const missingBasketball = tabled.missing.filter((l) => tableSource(l) === "ESPN");
  const insufficient = screened.filter((r) => r.a.researched && !r.a.dataSufficient && (mode === "ai" || !r.c.sharp)).length;
  // Every research call failing at once is the API, not the matches: usually spent credits.
  const aiFailed = screened.length > 0 && screened.every((r) => !r.a.researched);
  const tradable = candidates.filter((c) => c.volume >= MIN_VOLUME).length;
  const valueNote =
    (mode === "safe" || mode === "mismatch") && legs.length
      ? `${mode === "safe" ? "Safest Wins" : "Mismatches"} picks on who wins, not the price: these average ${pts(
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
          ? `Kalshi only lists ${candidates.length} game${candidates.length === 1 ? "" : "s"} in this window and these leagues (${tradable} with real trading) — try This Week for more.`
          : null,
        legs.length === 0 && !aiFailed
          ? mode === "mismatch"
            ? `No mismatches this scan: no non-top-3 favorite facing a bottom-third side by ${Math.round(MISMATCH.minGapShare * 100)}%+ of the table.`
            : mode === "opinion"
              ? `The AI didn't rate any researched favorite ${Math.round(OPINION.minProbability * 100)}%+ to win with ${OPINION.minConfidence}/10+ confidence.`
              : "Nothing cleared the bar this scan."
          : null,
        valueNote,
        mode === "mismatch" && missingSoccer.length
          ? `No league table from API-Football for ${missingSoccer.join(", ")}${
              process.env.FOOTBALL_API_KEY ? " (the plan may not cover this season)" : " (FOOTBALL_API_KEY not set)"
            } — those matches can't be checked.`
          : null,
        mode === "mismatch" && missingBasketball.length
          ? `No usable standings for ${missingBasketball.join(", ")} — College Basketball and EuroLeague have no single table, and NBA/WNBA tables wait until teams have played 5+ games.`
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

