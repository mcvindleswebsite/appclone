import type { AiSynthesis, BetSlip, RiskLevel, Side } from "@/types/bet";

type Confidence = "low" | "medium" | "high";

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

/** What the market says: the Kalshi price, blended with de-vigged book odds when given. */
export const marketProbability = (slip: BetSlip) => {
  const kalshi = clamp(slip.yesPrice / 100, 0.01, 0.99);
  // Book odds include ~4.5% vig on a two-way market; strip it before blending.
  const book = slip.americanOdds ? clamp(americanToProb(slip.americanOdds) / 1.045, 0.01, 0.99) : null;
  return book === null ? kalshi : (kalshi + book) / 2;
};

/** Maps the AI's 1-10 hit confidence onto the risk profiles' confidence tiers. */
export const confidenceTier = (hitConfidence: number): Confidence =>
  hitConfidence >= 7 ? "high" : hitConfidence >= 4 ? "medium" : "low";

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
  marketProbability: number;
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
const failures = (
  s: SideEval,
  risk: RiskLevel,
  confidence: Confidence,
  paths: number,
  legs: number,
  variance: RiskLevel | null
) => {
  const profile = RISK_PROFILES[risk];
  const out: string[] = [];
  if (s.edge <= 0) out.push(`-EV: ${(s.edge * 100).toFixed(1)} pts after fees`);
  else if (s.edge < profile.minEdge) out.push(`Edge ${(s.edge * 100).toFixed(1)} pts is under the ${(profile.minEdge * 100).toFixed(1)} pt minimum`);
  if (s.probability < LONGSHOT_FLOOR) out.push(`Longshot (${Math.round(s.probability * 100)}% to hit) — never recommended`);
  else if (s.probability < profile.minProb) out.push(`${Math.round(s.probability * 100)}% to hit is under the ${Math.round(profile.minProb * 100)}% floor`);
  if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[profile.minConfidence]) out.push(`Read confidence is ${confidence}; this level needs ${profile.minConfidence}`);
  if (paths < profile.minPaths) out.push(`Needs ${profile.minPaths} clear path${profile.minPaths > 1 ? "s" : ""} to victory, found ${paths}`);
  if (variance !== null && variance > risk + 1) out.push(`Variance rated ${variance}/5 — too swingy for risk level ${risk}`);
  if (legs >= 3) out.push(`${legs}-leg parlay — compounding vig, not recommended`);
  else if (legs === 2 && s.edge < 0.05) out.push("2-leg parlay needs a 5 pt edge");
  return out;
};

export const evaluate = (slip: BetSlip, risk: RiskLevel, ai: AiSynthesis | null): Evaluation => {
  const market = marketProbability(slip);
  // The AI's researched read is the primary estimate, shrunk 30% toward the market.
  const probability = ai ? clamp(ai.probability * 0.7 + market * 0.3, 0.01, 0.99) : market;
  const confidence = ai ? confidenceTier(ai.hitConfidence) : "low";
  const variance = ai?.riskRating ?? null;
  const legs = parlayLegs(slip.marketTitle);

  const yesPrice = clamp(slip.yesPrice, 1, 99) / 100;
  const sides: Record<Side, SideEval> = {
    YES: evalSide("YES", yesPrice, probability),
    NO: evalSide("NO", 1 - yesPrice, 1 - probability),
  };
  // Without research there are no evidence-backed paths, so nothing qualifies.
  const pathsFor: Record<Side, string[]> = {
    YES: ai?.pathsToVictory ?? [],
    NO: ai?.risks ?? [],
  };
  const fails = (s: SideEval) => failures(s, risk, confidence, pathsFor[s.side].length, legs, variance);

  const ranked = [sides.YES, sides.NO].sort((a, b) => b.edge - a.edge);
  const pick = ranked.find((s) => fails(s).length === 0);

  if (!pick) {
    const best = ranked[0];
    return {
      probability,
      marketProbability: market,
      confidence,
      paths: pathsFor.YES,
      sides,
      verdict: "PASS",
      side: null,
      stakePct: 0,
      reasons: [`Best side: ${best.side} @ ${Math.round(best.price * 100)}¢`, ...fails(best)],
      legs,
    };
  }

  const kelly = pick.edge / (1 - pick.price);
  return {
    probability,
    marketProbability: market,
    confidence,
    paths: pathsFor[pick.side],
    sides,
    verdict: pick.side === "YES" ? "BUY YES" : "BUY NO",
    side: pick.side,
    stakePct: clamp(kelly * RISK_PROFILES[risk].kelly, 0, MAX_STAKE),
    reasons: [
      `+${(pick.edge * 100).toFixed(1)} pts edge after fees (fair ${pick.fairCents}¢ vs ${Math.round(pick.price * 100)}¢)`,
      `${Math.round(pick.probability * 100)}% to hit · ${(pick.roi * 100).toFixed(1)}% expected return`,
      ...pathsFor[pick.side].slice(0, 3),
    ],
    legs,
  };
};
