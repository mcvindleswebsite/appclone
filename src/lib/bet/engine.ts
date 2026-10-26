import type { AiSynthesis, BetSlip, ContextFactors, RiskLevel, Side } from "@/types/bet";

export const DEFAULT_FACTORS: ContextFactors = {
  pickForm: 5,
  oppForm: 5,
  sosEdge: 0,
  pickInjuries: 0,
  oppInjuries: 0,
  restDiff: 0,
};

type Confidence = AiSynthesis["confidence"];

interface RiskProfile {
  label: string;
  /** Minimum edge (probability points after fees) on the side we'd buy. */
  minEdge: number;
  /** Minimum win probability on the side we'd buy. */
  minProb: number;
  minConfidence: Confidence;
  /** Minimum independent reasons the pick can win. */
  minPaths: number;
  /** Fraction of full Kelly to stake. */
  kelly: number;
}

export const RISK_PROFILES: Record<RiskLevel, RiskProfile> = {
  1: { label: "Max Safety", minEdge: 0.04, minProb: 0.65, minConfidence: "medium", minPaths: 1, kelly: 0.1 },
  2: { label: "Conservative", minEdge: 0.03, minProb: 0.55, minConfidence: "medium", minPaths: 1, kelly: 0.15 },
  3: { label: "Balanced", minEdge: 0.025, minProb: 0.45, minConfidence: "low", minPaths: 1, kelly: 0.25 },
  4: { label: "Aggressive", minEdge: 0.02, minProb: 0.35, minConfidence: "low", minPaths: 2, kelly: 0.33 },
  5: { label: "High Variance / Degen", minEdge: 0.015, minProb: 0.28, minConfidence: "low", minPaths: 2, kelly: 0.5 },
};

/** Below this, a pick is a longshot at every risk level. */
const LONGSHOT_FLOOR = 0.28;
const MAX_STAKE = 0.05;
const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Kalshi's taker fee per $1 contract: 7% of P × (1 − P). */
export const kalshiFee = (price: number) => 0.07 * price * (1 - price);

export const americanToProb = (odds: number) => (odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100));

export const probToAmerican = (p: number) => {
  const q = clamp(p, 0.01, 0.99);
  return q >= 0.5 ? Math.round((-100 * q) / (1 - q)) : Math.round((100 * (1 - q)) / q);
};

/** Counts legs from "A, B and C" / "A + B" style parlay titles. */
export const parlayLegs = (title: string) => {
  if (!/parlay|combo|\bsgp\b|\s[+&]\s/i.test(title)) return 1;
  const legs = title.replace(/^.*?(?:parlay|combo|sgp)\s*:?/i, "").split(/\s*(?:,|\+|&|\band\b)\s*/i);
  return Math.max(2, legs.filter((part) => part.trim().length > 2).length);
};

/**
 * Market-anchored probability nudged by context. The market already prices most of
 * this in, so the adjustments are deliberately small (all in log-odds space).
 */
export const contextProbability = (slip: BetSlip, factors: ContextFactors) => {
  const kalshi = clamp(slip.yesPrice / 100, 0.01, 0.99);
  // Book odds include ~4.5% vig on a two-way market; strip it before blending.
  const book = slip.americanOdds ? clamp(americanToProb(slip.americanOdds) / 1.045, 0.01, 0.99) : null;
  const base = book === null ? kalshi : (kalshi + book) / 2;

  const adjustment =
    (factors.pickForm - factors.oppForm) * 0.05 +
    factors.sosEdge * 0.035 +
    (factors.oppInjuries - factors.pickInjuries) * 0.14 +
    clamp(factors.restDiff, -3, 3) * 0.04;

  return clamp(sigmoid(logit(base) + adjustment), 0.01, 0.99);
};

/** Reasons the pick can win, derived from the factors when there's no AI read. */
export const contextPaths = (factors: ContextFactors) => {
  const paths: string[] = [];
  if (factors.pickForm - factors.oppForm >= 2) paths.push(`Better recent form (${factors.pickForm}-${10 - factors.pickForm} vs ${factors.oppForm}-${10 - factors.oppForm})`);
  if (factors.sosEdge >= 2) paths.push("Opponent's record is inflated by a softer schedule");
  if (factors.oppInjuries > factors.pickInjuries) paths.push("Opponent is more depleted by injuries");
  if (factors.restDiff >= 1) paths.push(`Rest advantage (+${factors.restDiff} day${factors.restDiff > 1 ? "s" : ""})`);
  return paths;
};

const flipFactors = (f: ContextFactors): ContextFactors => ({
  pickForm: f.oppForm,
  oppForm: f.pickForm,
  sosEdge: -f.sosEdge,
  pickInjuries: f.oppInjuries,
  oppInjuries: f.pickInjuries,
  restDiff: -f.restDiff,
});

export interface SideEval {
  side: Side;
  price: number;
  probability: number;
  fee: number;
  /** Probability points of edge after fees. */
  edge: number;
  /** Expected return per dollar staked. */
  roi: number;
  fairCents: number;
}

export interface Evaluation {
  probability: number;
  heuristicProbability: number;
  confidence: Confidence;
  paths: string[];
  sides: Record<Side, SideEval>;
  verdict: "BUY YES" | "BUY NO" | "PASS";
  side: Side | null;
  stakePct: number;
  reasons: string[];
  legs: number;
}

const evalSide = (side: Side, price: number, probability: number): SideEval => {
  const fee = kalshiFee(price);
  const edge = probability - price - fee;
  return { side, price, probability, fee, edge, roi: edge / (price + fee), fairCents: Math.round(probability * 100) };
};

/** Why a side fails the active risk profile; empty when it qualifies. */
const failures = (s: SideEval, profile: RiskProfile, confidence: Confidence, paths: number, legs: number) => {
  const out: string[] = [];
  if (s.edge <= 0) out.push(`-EV: ${(s.edge * 100).toFixed(1)} pts after fees`);
  else if (s.edge < profile.minEdge) out.push(`Edge ${(s.edge * 100).toFixed(1)} pts is under the ${(profile.minEdge * 100).toFixed(1)} pt minimum`);
  if (s.probability < LONGSHOT_FLOOR) out.push(`Longshot (${Math.round(s.probability * 100)}% to hit) — never recommended`);
  else if (s.probability < profile.minProb) out.push(`${Math.round(s.probability * 100)}% to hit is under the ${Math.round(profile.minProb * 100)}% floor`);
  if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[profile.minConfidence]) out.push(`Read confidence is ${confidence}; this level needs ${profile.minConfidence}`);
  if (paths < profile.minPaths) out.push(`Needs ${profile.minPaths} clear path${profile.minPaths > 1 ? "s" : ""} to victory, found ${paths}`);
  if (legs >= 3) out.push(`${legs}-leg parlay — compounding vig, not recommended`);
  else if (legs === 2 && s.edge < 0.05) out.push("2-leg parlay needs a 5 pt edge");
  return out;
};

export const evaluate = (
  slip: BetSlip,
  factors: ContextFactors,
  risk: RiskLevel,
  ai: AiSynthesis | null
): Evaluation => {
  const heuristicProbability = contextProbability(slip, factors);
  // The AI's read is the primary estimate; the factor model keeps it anchored.
  const probability = ai ? clamp(ai.probability * 0.7 + heuristicProbability * 0.3, 0.01, 0.99) : heuristicProbability;
  const factorsTouched = JSON.stringify(factors) !== JSON.stringify(DEFAULT_FACTORS);
  const confidence: Confidence = ai?.confidence ?? (factorsTouched ? "medium" : "low");
  const legs = parlayLegs(slip.marketTitle);

  const yesPrice = clamp(slip.yesPrice, 1, 99) / 100;
  const sides: Record<Side, SideEval> = {
    YES: evalSide("YES", yesPrice, probability),
    NO: evalSide("NO", 1 - yesPrice, 1 - probability),
  };
  const pathsFor: Record<Side, string[]> = {
    YES: ai ? ai.pathsToVictory : contextPaths(factors),
    NO: ai ? ai.risks : contextPaths(flipFactors(factors)),
  };

  const profile = RISK_PROFILES[risk];
  const ranked = [sides.YES, sides.NO].sort((a, b) => b.edge - a.edge);
  const pick = ranked.find((s) => failures(s, profile, confidence, pathsFor[s.side].length, legs).length === 0);

  if (!pick) {
    const best = ranked[0];
    return {
      probability,
      heuristicProbability,
      confidence,
      paths: pathsFor.YES,
      sides,
      verdict: "PASS",
      side: null,
      stakePct: 0,
      reasons: [`Best side: ${best.side} @ ${Math.round(best.price * 100)}¢`, ...failures(best, profile, confidence, pathsFor[best.side].length, legs)],
      legs,
    };
  }

  const kelly = pick.edge / (1 - pick.price);
  return {
    probability,
    heuristicProbability,
    confidence,
    paths: pathsFor[pick.side],
    sides,
    verdict: pick.side === "YES" ? "BUY YES" : "BUY NO",
    side: pick.side,
    stakePct: clamp(kelly * profile.kelly, 0, MAX_STAKE),
    reasons: [
      `+${(pick.edge * 100).toFixed(1)} pts edge after fees (fair ${pick.fairCents}¢ vs ${Math.round(pick.price * 100)}¢)`,
      `${Math.round(pick.probability * 100)}% to hit · ${(pick.roi * 100).toFixed(1)}% expected return`,
      ...pathsFor[pick.side].slice(0, 3),
    ],
    legs,
  };
};
