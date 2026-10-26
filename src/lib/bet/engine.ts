import type { BetLeg, BetSlip, LegAnalysis, LegRating, RiskLevel, Side, SlipAnalysis } from "@/types/bet";

type Confidence = "low" | "medium" | "high";

interface RiskProfile {
  label: string;
  /** Minimum edge (probability points after fees) on a straight bet. */
  minEdge: number;
  /** Minimum win probability on a straight bet. */
  minProb: number;
  minConfidence: Confidence;
  /** Minimum independent reasons a straight bet can win. */
  minPaths: number;
  /** Fraction of full Kelly to stake. */
  kelly: number;
  /** Parlays: leg ratings allowed in a recommended slip, its max size, and min hit chance. */
  parlay: { ratings: LegRating[]; maxLegs: number; minProb: number };
}

export const RISK_PROFILES: Record<RiskLevel, RiskProfile> = {
  1: { label: "Max Safety", minEdge: 0.04, minProb: 0.65, minConfidence: "medium", minPaths: 1, kelly: 0.1, parlay: { ratings: ["STRONG VALUE"], maxLegs: 2, minProb: 0.4 } },
  2: { label: "Conservative", minEdge: 0.03, minProb: 0.55, minConfidence: "medium", minPaths: 1, kelly: 0.15, parlay: { ratings: ["STRONG VALUE"], maxLegs: 3, minProb: 0.3 } },
  3: { label: "Balanced", minEdge: 0.025, minProb: 0.45, minConfidence: "low", minPaths: 1, kelly: 0.25, parlay: { ratings: ["STRONG VALUE", "NEUTRAL"], maxLegs: 4, minProb: 0.18 } },
  4: { label: "Aggressive", minEdge: 0.02, minProb: 0.35, minConfidence: "low", minPaths: 2, kelly: 0.33, parlay: { ratings: ["STRONG VALUE", "NEUTRAL"], maxLegs: 6, minProb: 0.1 } },
  5: { label: "High Variance / Degen", minEdge: 0.015, minProb: 0.28, minConfidence: "low", minPaths: 2, kelly: 0.5, parlay: { ratings: ["STRONG VALUE", "NEUTRAL"], maxLegs: 8, minProb: 0.05 } },
};

/** Below this, a straight bet is a longshot at every risk level. */
const LONGSHOT_FLOOR = 0.28;
const MAX_STAKE = 0.05;
const CONFIDENCE_RANK: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const RATING_RANK: Record<LegRating, number> = { "STRONG VALUE": 2, NEUTRAL: 1, "BUM PICK": 0 };

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const product = (ns: number[]) => ns.reduce((a, b) => a * b, 1);

/** Kalshi's taker fee per $1 contract: 7% of P × (1 − P). */
export const kalshiFee = (price: number) => 0.07 * price * (1 - price);

export const americanToProb = (odds: number) => (odds < 0 ? -odds / (-odds + 100) : 100 / (odds + 100));
export const americanToDecimal = (odds: number) => (odds < 0 ? 1 + 100 / -odds : 1 + odds / 100);
export const decimalToAmerican = (d: number) => (d >= 2 ? Math.round((d - 1) * 100) : Math.round(-100 / (d - 1)));

export const probToAmerican = (p: number) => {
  const q = clamp(p, 0.01, 0.99);
  return q >= 0.5 ? Math.round((-100 * q) / (1 - q)) : Math.round((100 * (1 - q)) / q);
};

export const formatAmerican = (odds: number) => `${odds > 0 ? "+" : ""}${odds}`;

/** Decimal payout per $1 for a Kalshi price in cents, after the taker fee. */
export const kalshiDecimal = (cents: number) => {
  const p = clamp(cents, 1, 99) / 100;
  return 1 / (p + kalshiFee(p));
};

/** What the market says a leg hits at: Kalshi price, blended with de-vigged book odds. */
export const legMarketProbability = (leg: BetLeg) => {
  const kalshi = leg.price ? clamp(leg.price / 100, 0.01, 0.99) : null;
  // Book odds include ~4.5% vig on a two-way market; strip it before blending.
  const book = leg.americanOdds ? clamp(americanToProb(leg.americanOdds) / 1.045, 0.01, 0.99) : null;
  if (kalshi !== null && book !== null) return (kalshi + book) / 2;
  return kalshi ?? book;
};

/** Decimal odds a leg pays on its own, when it has a price or odds. */
export const legDecimal = (leg: BetLeg) =>
  leg.price ? kalshiDecimal(leg.price) : leg.americanOdds ? americanToDecimal(leg.americanOdds) : null;

export const confidenceTier = (hitConfidence: number): Confidence =>
  hitConfidence >= 7 ? "high" : hitConfidence >= 4 ? "medium" : "low";

/** Counts legs from "A, B and C" / "A + B" style parlay titles. */
export const parlayLegs = (title: string) => {
  if (!/parlay|combo|\bsgp\b|\s[+&]\s/i.test(title)) return 1;
  const legs = title.replace(/^.*?(?:parlay|combo|sgp)\s*:?/i, "").split(/\s*(?:,|\+|&|\band\b)\s*/i);
  return Math.max(2, legs.filter((part) => part.trim().length > 2).length);
};

/* ------------------------------ Straight bets ------------------------------ */

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
}

const evalSide = (side: Side, price: number, probability: number): SideEval => {
  const fee = kalshiFee(price);
  const edge = probability - price - fee;
  return { side, price, probability, fee, edge, roi: edge / (price + fee), fairCents: Math.round(probability * 100) };
};

/** Why a side fails the active risk profile; empty when it qualifies. */
const failures = (s: SideEval, risk: RiskLevel, confidence: Confidence, paths: number, legs: number, variance: RiskLevel | null) => {
  const profile = RISK_PROFILES[risk];
  const out: string[] = [];
  if (s.edge <= 0) out.push(`-EV: ${(s.edge * 100).toFixed(1)} pts after fees`);
  else if (s.edge < profile.minEdge) out.push(`Edge ${(s.edge * 100).toFixed(1)} pts is under the ${(profile.minEdge * 100).toFixed(1)} pt minimum`);
  if (s.probability < LONGSHOT_FLOOR) out.push(`Longshot (${Math.round(s.probability * 100)}% to hit) — never recommended`);
  else if (s.probability < profile.minProb) out.push(`${Math.round(s.probability * 100)}% to hit is under the ${Math.round(profile.minProb * 100)}% floor`);
  if (CONFIDENCE_RANK[confidence] < CONFIDENCE_RANK[profile.minConfidence]) out.push(`Read confidence is ${confidence}; this level needs ${profile.minConfidence}`);
  if (paths < profile.minPaths) out.push(`Needs ${profile.minPaths} clear path${profile.minPaths > 1 ? "s" : ""} to victory, found ${paths}`);
  if (variance !== null && variance > risk + 1) out.push(`Variance rated ${variance}/5 — too swingy for risk level ${risk}`);
  if (legs >= 3) out.push(`${legs}-leg parlay in one market — compounding vig, not recommended`);
  else if (legs === 2 && s.edge < 0.05) out.push("2-leg parlay needs a 5 pt edge");
  return out;
};

/** Straight bet on one Kalshi contract. YES is the leg as written; NO is the fade. */
export const evaluate = (leg: BetLeg, risk: RiskLevel, ai: SlipAnalysis | null): Evaluation => {
  const market = legMarketProbability(leg) ?? 0.5;
  // The AI's researched read is the primary estimate, shrunk 30% toward the market.
  const probability = ai ? clamp(ai.trueWinProbability * 0.7 + market * 0.3, 0.01, 0.99) : market;
  const confidence = ai ? confidenceTier(ai.legs[0]?.hitConfidence ?? 1) : "low";
  const variance = ai?.riskScore ?? null;
  const legs = parlayLegs(leg.market);

  const yesPrice = clamp(leg.price ?? Math.round(market * 100), 1, 99) / 100;
  const sides: Record<Side, SideEval> = {
    YES: evalSide("YES", yesPrice, probability),
    NO: evalSide("NO", 1 - yesPrice, 1 - probability),
  };
  // Without research there are no evidence-backed paths, so nothing qualifies.
  const pathsFor: Record<Side, string[]> = { YES: ai?.pathsToVictory ?? [], NO: ai?.risks ?? [] };
  const fails = (s: SideEval) => [
    ...(leg.price === null
      ? [`No market price — model says ${Math.round(probability * 100)}% (fair ${formatAmerican(probToAmerican(probability))}); import the Kalshi link to measure EV`]
      : []),
    ...failures(s, risk, confidence, pathsFor[s.side].length, legs, variance),
  ];

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
  };
};

/* --------------------------------- Parlays --------------------------------- */

export interface LegEval {
  index: number;
  leg: BetLeg;
  analysis: LegAnalysis | null;
  marketProbability: number | null;
  decimal: number | null;
  /** Expected return per $1 on the leg alone, when priced and researched. */
  ev: number | null;
  /** Dropped from any recommendation because it conflicts with a stronger leg. */
  conflicted: boolean;
}

export interface SlipLine {
  indexes: number[];
  probability: number;
  /** Null when some leg has no price, so payout can't be sized. */
  decimal: number | null;
  american: number | null;
  ev: number | null;
}

export interface ParlayEvaluation {
  legs: LegEval[];
  bums: LegEval[];
  full: SlipLine;
  trimmed: SlipLine | null;
  verdict: "PLAY FULL SLIP" | "PLAY TRIMMED SLIP" | "PASS";
  reasons: string[];
}

const toLine = (indexes: number[], probability: number, decimal: number | null): SlipLine => ({
  indexes,
  probability,
  decimal,
  american: decimal ? decimalToAmerican(decimal) : null,
  ev: decimal ? probability * decimal - 1 : null,
});

export const evaluateParlay = (slip: BetSlip, risk: RiskLevel, ai: SlipAnalysis | null): ParlayEvaluation => {
  const profile = RISK_PROFILES[risk].parlay;

  // Of each negatively correlated group, keep only the strongest leg.
  const conflicted = new Set<number>();
  for (const c of ai?.correlations ?? []) {
    if (c.type !== "negative" || c.legs.length < 2) continue;
    const ranked = [...c.legs].sort((a, b) => {
      const la = ai?.legs[a];
      const lb = ai?.legs[b];
      return (
        RATING_RANK[lb?.rating ?? "NEUTRAL"] - RATING_RANK[la?.rating ?? "NEUTRAL"] ||
        (lb?.probability ?? 0) - (la?.probability ?? 0)
      );
    });
    ranked.slice(1).forEach((i) => conflicted.add(i));
  }

  const legs: LegEval[] = slip.legs.map((leg, index) => {
    const analysis = ai?.legs[index] ?? null;
    const decimal = legDecimal(leg);
    const p = analysis?.researched ? analysis.probability : null;
    return {
      index,
      leg,
      analysis,
      marketProbability: legMarketProbability(leg),
      decimal,
      ev: p !== null && decimal ? p * decimal - 1 : null,
      conflicted: conflicted.has(index),
    };
  });

  const legProb = (l: LegEval) => (l.analysis?.researched ? l.analysis.probability : (l.marketProbability ?? 0.5));
  const decimals = legs.map((l) => l.decimal);
  const fullDecimal = slip.comboPrice
    ? kalshiDecimal(slip.comboPrice)
    : slip.comboOdds
      ? americanToDecimal(slip.comboOdds)
      : decimals.every((d) => d !== null)
        ? product(decimals as number[])
        : null;
  const full = toLine(
    legs.map((l) => l.index),
    ai?.trueWinProbability ?? product(legs.map(legProb)),
    fullDecimal
  );
  const bums = legs.filter((l) => l.analysis?.rating === "BUM PICK");

  if (!ai) return { legs, bums, full, trimmed: null, verdict: "PASS", reasons: ["Run research to rate the legs."] };

  // Best +EV subset the risk level allows, built from the strongest, best-value legs.
  const candidates = legs
    .filter(
      (l) =>
        l.analysis?.researched &&
        profile.ratings.includes(l.analysis.rating) &&
        !l.conflicted &&
        l.decimal !== null &&
        (l.ev ?? -1) >= 0
    )
    .sort((a, b) => RATING_RANK[b.analysis!.rating] - RATING_RANK[a.analysis!.rating] || (b.ev ?? 0) - (a.ev ?? 0));
  let trimmed: SlipLine | null = null;
  for (let k = 1; k <= Math.min(profile.maxLegs, candidates.length); k++) {
    const kept = candidates.slice(0, k);
    // Kept legs are treated as independent: conflicting legs were already removed.
    const option = toLine(
      kept.map((l) => l.index).sort((a, b) => a - b),
      product(kept.map(legProb)),
      product(kept.map((l) => l.decimal!))
    );
    if ((option.ev ?? 0) > 0 && option.probability >= profile.minProb && (!trimmed || option.ev! > trimmed.ev!)) {
      trimmed = option;
    }
  }

  const reasons: string[] = [];
  if (bums.length) reasons.push(`${bums.length} bum pick${bums.length > 1 ? "s" : ""} on the slip`);
  if (legs.some((l) => l.conflicted)) reasons.push("Some legs work against each other");
  if (full.ev === null) reasons.push("No slip price — add the combo price or parlay odds to measure EV");
  else if (full.ev <= 0) reasons.push(`Full slip is -EV (${(full.ev * 100).toFixed(1)}%)`);
  if (legs.length > profile.maxLegs) reasons.push(`${legs.length} legs is more than risk level ${risk} allows (${profile.maxLegs})`);
  if (full.probability < profile.minProb) {
    reasons.push(`${(full.probability * 100).toFixed(1)}% to hit is under the ${Math.round(profile.minProb * 100)}% floor`);
  }

  const fullPlayable =
    bums.length === 0 &&
    !legs.some((l) => l.conflicted) &&
    legs.length <= profile.maxLegs &&
    (full.ev ?? -1) > 0 &&
    full.probability >= profile.minProb;
  if (fullPlayable) {
    return { legs, bums, full, trimmed: null, verdict: "PLAY FULL SLIP", reasons: ["Every leg holds up and the slip is +EV"] };
  }
  if (trimmed) return { legs, bums, full, trimmed, verdict: "PLAY TRIMMED SLIP", reasons };
  if (!candidates.length) reasons.push("No priced, +EV legs survive at this risk level");
  return { legs, bums, full, trimmed: null, verdict: "PASS", reasons };
};

/**
 * Decimal odds of the ticket as entered (every leg, not a trimmed version): the Kalshi
 * combo price or parlay odds, else the legs' own prices multiplied together. With no
 * market prices at all, the model's fair odds (1 ÷ its win probability) stand in.
 */
export const ticketDecimal = (slip: BetSlip, ai: SlipAnalysis | null): number | null => {
  if (slip.legs.length === 1) {
    const leg = slip.legs[0];
    const market = legDecimal(leg);
    if (market) return market;
    return ai ? 1 / clamp(ai.trueWinProbability, 0.01, 0.99) : null;
  }
  if (slip.comboPrice) return kalshiDecimal(slip.comboPrice);
  if (slip.comboOdds) return americanToDecimal(slip.comboOdds);
  const decimals = slip.legs.map(legDecimal);
  if (decimals.every((d) => d !== null)) return product(decimals as number[]);
  return ai ? 1 / clamp(ai.trueWinProbability, 0.0001, 0.99) : null;
};
