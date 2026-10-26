export type Side = "YES" | "NO";
export type RiskLevel = 1 | 2 | 3 | 4 | 5;
export type Outcome = "PENDING" | "WIN" | "LOSS";

/** The bet slip as read from a screenshot and verified by hand. */
export interface BetSlip {
  sport: string;
  matchup: string;
  marketTitle: string;
  /** Team or outcome the YES side of the contract is on. */
  pick: string;
  /** Kalshi YES price in cents (1-99). */
  yesPrice: number;
  /** Optional sportsbook American odds for the pick, used as a market cross-check. */
  americanOdds: number | null;
}

export interface InjuryFactor {
  note: string;
  /** Effect on the YES side. */
  effect: "helps" | "hurts" | "neutral";
}

/** What the AI research returns for a slip. */
export interface AiSynthesis {
  probability: number;
  /** 1-10 confidence in the probability estimate. */
  hitConfidence: number;
  /** 1-5 variance of the bet itself (not the user's tolerance). */
  riskRating: RiskLevel;
  /** Two sentences: the case, then the main risk. */
  reasoning: string;
  last10: { hits: number; games: number; detail: string };
  /** Opposing defense rank vs this stat; 1 = toughest matchup. */
  matchup: { rank: number; outOf: number; label: string };
  injuries: InjuryFactor[];
  pathsToVictory: string[];
  risks: string[];
  /** EV of YES at the slip price after fees, % of stake. Computed server-side. */
  evPercent: number;
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
  outcome: Outcome;
}

export interface HistoryInsights {
  total: number;
  record: { wins: number; losses: number; pending: number };
  sports: { sport: string; count: number; wins: number; losses: number }[];
  teams: { team: string; count: number; wins: number; losses: number }[];
  byRisk: { risk: RiskLevel; wins: number; losses: number }[];
}

export interface KalshiMarketOption {
  ticker: string;
  title: string;
  /** What the YES side is on, e.g. "Philadelphia". */
  pick: string;
  /** Prices in cents; null when there's no quote. */
  yesAsk: number | null;
  yesBid: number | null;
  lastPrice: number | null;
  active: boolean;
}

/** A Kalshi event resolved from a pasted link. */
export interface KalshiImport {
  eventTicker: string;
  title: string;
  subtitle: string;
  competition: string;
  markets: KalshiMarketOption[];
  /** Market ticker the link pointed at, when it named one. */
  selected: string | null;
}
