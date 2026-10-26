export type Side = "YES" | "NO";
export type RiskLevel = 1 | 2 | 3 | 4 | 5;
export type Outcome = "PENDING" | "WIN" | "LOSS";
export type InjuryImpact = 0 | 1 | 2 | 3;

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

/** Contextual inputs. Positive values favor the pick. */
export interface ContextFactors {
  /** Pick's wins in its last 10 games. */
  pickForm: number;
  /** Opponent's wins in its last 10 games. */
  oppForm: number;
  /** -5 (pick faced far tougher schedule) to +5 (opponent did). */
  sosEdge: number;
  pickInjuries: InjuryImpact;
  oppInjuries: InjuryImpact;
  /** Pick's rest days minus opponent's. */
  restDiff: number;
}

/** What the AI synthesis returns, merged into the evaluation. */
export interface AiSynthesis {
  probability: number;
  confidence: "low" | "medium" | "high";
  summary: string;
  pathsToVictory: string[];
  risks: string[];
  factors: ContextFactors;
  model: string;
}

export interface BetRecord {
  id: string;
  createdAt: number;
  updatedAt: number;
  slip: BetSlip;
  factors: ContextFactors;
  risk: RiskLevel;
  side: Side | null;
  verdict: string;
  probability: number;
  edge: number;
  summary: string;
  ai: boolean;
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
