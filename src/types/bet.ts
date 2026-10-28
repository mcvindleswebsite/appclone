import type { ScanScope } from "@/lib/bet/scan-scope";

export type Side = "YES" | "NO";
export type RiskLevel = 1 | 2 | 3 | 4 | 5;
export type Outcome = "PENDING" | "WIN" | "LOSS";
export type LegRating = "STRONG VALUE" | "NEUTRAL" | "BUM PICK";
/** How a leg settled. VOID legs (cancelled games) drop out of the parlay. */
export type LegResult = "WIN" | "LOSS" | "PENDING" | "VOID";

export const MAX_LEGS = 12;

/** One selection on a slip. A straight bet is a slip with one leg. */
export interface BetLeg {
  sport: string;
  matchup: string;
  /** Market title or stat line, e.g. "Kevin Durant: 25+ points". */
  market: string;
  /** Who or what the leg is on, e.g. "Kevin Durant" or "Dallas". */
  pick: string;
  /** Cost in cents of the side being bet (1-99), when known. */
  price: number | null;
  /** Sportsbook American odds for this leg, when known. */
  americanOdds: number | null;
  /** Kalshi market ticker, for settlement lookups. */
  ticker?: string;
  /** Which side of the Kalshi market the leg takes. */
  side?: "yes" | "no";
  /** Settlement, once looked up from Kalshi. */
  result?: LegResult;
  /** ISO start of the leg's game, from Kalshi's milestones. */
  startsAt?: string;
  /** ISO estimate of when the leg can settle (game or period end). */
  endsAt?: string;
  /**
   * Closing line: the fair (mid) price in cents of this leg's side when its game started.
   * Null once checked and unavailable; undefined until checked.
   */
  closePrice?: number | null;
  /** De-vigged sportsbook win probability for this leg's side; null when no line was found. */
  bookProb?: number | null;
  /** Where `bookProb` came from, e.g. "Pinnacle" or "4-book consensus". */
  bookSource?: string;
}

export interface BetSlip {
  legs: BetLeg[];
  /** Kalshi combo YES price in cents, for multi-leg slips. */
  comboPrice: number | null;
  /** Sportsbook parlay American odds, for multi-leg slips. */
  comboOdds: number | null;
  /** Kalshi combo market ticker, when imported from one. */
  comboTicker?: string;
}

export interface InjuryFactor {
  note: string;
  /** Effect on the leg. */
  effect: "helps" | "hurts" | "neutral";
}

/** AI research for one leg. */
export interface LegAnalysis {
  rating: LegRating;
  probability: number;
  /** 1-10 confidence in the probability. */
  hitConfidence: number;
  /** One sentence; for a BUM PICK, the specific reason it's bad. */
  reason: string;
  last10: { hits: number; games: number; detail: string };
  /** Opposing defense rank vs this stat; 1 = toughest matchup. */
  matchup: { rank: number; outOf: number; label: string };
  injuries: InjuryFactor[];
  /** How the team does against opponents of today's tier and playstyle. */
  opponentTier: {
    note: string;
    /** Favorite with a proven record of underperforming against this kind of lower-tier side. */
    trapGame: boolean;
    /** Underdog that systematically raises its level against top-tier opposition. */
    playUpSpot: boolean;
  };
  /** False when the research couldn't find enough current, verifiable data to rate the leg. */
  dataSufficient?: boolean;
  /** The concrete stats the rating rests on, each with where it came from. */
  reasoningStats?: ReasoningStat[];
  /** How the bettor's own Bet Vault record bears on this leg; empty when it doesn't. */
  historyFlag?: string;
  /** False when research for this leg failed; the other fields are placeholders. */
  researched: boolean;
}

export interface ReasoningStat {
  /** e.g. "Head-to-head, last 5", "Kalshi implied probability". */
  metric: string;
  /** e.g. "W3 D1 L1", "62%". */
  value: string;
  /** Publication or data source and date, or "Kalshi" for market data. */
  source: string;
}

/** A structured summary of the Bet Vault, computed in code and sent with each research call. */
export interface VaultProfile {
  picks: number;
  settled: number;
  wins: number;
  losses: number;
  winRate: number | null;
  /** Units won per unit staked over settled picks with odds. */
  roi: number | null;
  /** Leagues the bettor backs most, by legs logged. */
  leagues: { league: string; legs: number; hit: number; settled: number }[];
  /** Ticket-level results by market type (single legs by market, parlays by size). */
  byMarketType: { type: string; tickets: number; wins: number; losses: number; roi: number | null }[];
  /** Leg hit rates by market type, across every settled leg. */
  legsByType: { type: string; hit: number; settled: number }[];
  /** Plain-language patterns from past results, e.g. busted parlays. Computed, not AI. */
  patterns: string[];
}

export interface Correlation {
  /** Zero-based leg indexes involved. */
  legs: number[];
  type: "negative" | "positive";
  note: string;
}

/** What the evaluate route returns for a slip. */
export interface SlipAnalysis {
  legs: LegAnalysis[];
  /** Probability the whole slip hits, correlation included. */
  trueWinProbability: number;
  /** 1-5 variance of the slip. */
  riskScore: RiskLevel;
  /** Two sentences. */
  reasoning: string;
  correlations: Correlation[];
  pathsToVictory: string[];
  risks: string[];
  /** EV of the full slip at its price, % of stake. Computed server-side; null without a price. */
  evPercent: number | null;
  model: string;
}

export interface BetRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  slip: BetSlip;
  risk: RiskLevel;
  side: Side | null;
  verdict: string;
  probability: number;
  edge: number;
  summary: string;
  ai: boolean;
  /** AI variance rating, when researched. */
  aiRisk?: RiskLevel;
  /** The model's probability before calibration, which future calibration fits are built on. */
  rawProbability?: number;
  /** Decimal odds of the whole ticket as placed (market price, else model fair odds), for ROI. */
  decimalOdds?: number;
  /** Dollars staked on the whole ticket (one stake per parlay, not per leg). */
  wager?: number;
  /** wager × decimalOdds; null when the ticket has no odds to size it. */
  potentialPayout?: number | null;
  /** Payout − wager on a WIN, −wager on a LOSS, null while pending or unsized. */
  netProfit?: number | null;
  /** Added from a past Kalshi link rather than evaluated here. */
  imported?: boolean;
  outcome: Outcome;
}

export interface HistoryInsights {
  total: number;
  record: { wins: number; losses: number; pending: number };
  sports: { sport: string; count: number; wins: number; losses: number }[];
  teams: { team: string; count: number; wins: number; losses: number }[];
  byRisk: { risk: RiskLevel; wins: number; losses: number }[];
}

/** Compact history the AI sees: recent picks plus headline stats. */
export interface HistoryContext {
  settled: number;
  winRate: number | null;
  /** Units won per unit staked over settled picks. */
  roi: number | null;
  /** Dollar results over settled picks that have a stake. */
  dollars?: { profit: number; staked: number };
  recent: { date: string; legs: string; verdict: string; outcome: Outcome; odds: number | null; legsHit: string | null }[];
  /** Leg-level accuracy over the same recent picks. */
  legs: {
    hit: number;
    settled: number;
    bySport: { sport: string; hit: number; settled: number }[];
    byType: { type: string; hit: number; settled: number }[];
  };
}

export interface KalshiMarketOption {
  ticker: string;
  title: string;
  /** What the YES side is on, e.g. "Philadelphia". */
  pick: string;
  /** Prices in cents; null when there's no quote. */
  yesAsk: number | null;
  yesBid: number | null;
  noAsk: number | null;
  lastPrice: number | null;
  active: boolean;
  /** "yes" / "no" once settled, else null. */
  result: "yes" | "no" | null;
}

/** A Kalshi event resolved from a link that didn't name a specific market. */
export interface KalshiImport {
  eventTicker: string;
  title: string;
  subtitle: string;
  competition: string;
  markets: KalshiMarketOption[];
}

/** One or more pasted Kalshi links resolved into slip legs. */
export interface KalshiSlipImport {
  /** Events whose side the user still has to choose (event-only links). */
  choices: KalshiImport[];
  /** Legs carry `result` when Kalshi has settled them. */
  legs: BetLeg[];
  comboPrice: number | null;
  comboTicker: string | null;
  /** Settled result of the combo market itself, when the link is a combo. */
  comboResult: "yes" | "no" | null;
}

/** Zero-token settlement of pasted Kalshi links, from /api/vault/parse-link. */
export interface VaultSettlement {
  legs: BetLeg[];
  comboTicker: string | null;
  comboPrice: number | null;
  outcome: Outcome;
  legsHit: number;
  legsSettled: number;
  /** Legs that count (VOID legs excluded). */
  legsTotal: number;
  /** Game-page links skipped because they don't say which side was bet. */
  skipped: number;
}

/** One leg the soccer scanner recommends. */
export interface RecommendedLeg {
  leg: BetLeg;
  league: string;
  settlesAt: string;
  /** A season-long title market (the Waiting Game) rather than a single match. */
  futures?: boolean;
  /* The fixed pick record. Fixture facts come from Kalshi, never from the model. */
  matchName: string;
  /** ISO kickoff (match legs) or expected settlement (futures). */
  kickoffTime: string;
  pick: string;
  odds: { kalshiCents: number; american: number };
  /** Stats the model cited plus the market's own line value, computed in code. */
  reasoningStats: ReasoningStat[];
  /** 1-10; the model's confidence in its probability. */
  confidenceRating: number;
  /** How the bettor's Bet Vault record bears on this pick; empty when it doesn't. */
  historyFlag: string;
  /** Model's probability the leg wins. */
  modelProbability: number;
  /** What the Kalshi price implies. */
  marketProbability: number;
  /** Expected return per $1 at the Kalshi price, after fees. */
  ev: number;
  /** 1-10 confidence in the model probability. */
  confidence: number;
  rating: LegRating;
  /** One-sentence tactical breakdown. */
  reason: string;
  opponentTier: LegAnalysis["opponentTier"];
}

/** /api/recommendations response: the best +EV soccer legs, combined into one ticket. */
export interface SoccerRecommendation {
  legs: RecommendedLeg[];
  parlay: {
    /** Treats legs as independent: they're all different matches. */
    probability: number;
    decimal: number;
    american: number;
    ev: number;
  } | null;
  /** `skipped`: fixtures in scope that ran out of research time (least-traded first). */
  scanned: { fixtures: number; researched: number; qualified: number; skipped?: number; insufficient?: number };
  /** Whether the bettor's Bet Vault history was applied, and how many settled picks it held. */
  history?: { applied: boolean; settled: number };
  generatedAt: string;
  /** Present when fewer than 5 legs cleared the bar; the scanner never pads with -EV legs. */
  note: string | null;
  model: string;
  /** The leagues and time window this scan covered. */
  scope?: ScanScope;
}
