import { kalshiFee, RISK_PROFILES, type Calibrator, type Evaluation } from "@/lib/bet/engine";
import { marketType, sportsOf } from "@/lib/bet/history";
import type { BetLeg, BetRecord, BetSlip, RiskLevel, Side } from "@/types/bet";

/**
 * Edge measurement, no AI involved: closing line value, how well the AI's probabilities
 * match reality, where the money is won and lost, combo markups, and limit-order pricing.
 */

const product = (ns: number[]) => ns.reduce((a, b) => a * b, 1);
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/* -------------------------- Closing line value (CLV) -------------------------- */

export interface TicketClv {
  /** Price paid for the ticket, as a probability (0–1). */
  entry: number;
  /** Fair price of the same ticket when its games started. */
  close: number;
  /** close ÷ entry − 1: positive means the market moved toward you after you bet. */
  clv: number;
}

/** Legs whose closing line should be looked up: priced Kalshi legs not yet checked. */
export const needsClose = (leg: BetLeg) => !!leg.ticker && leg.closePrice === undefined && leg.result !== "VOID";

/**
 * A ticket's CLV: what it would have cost at the close (the legs' fair prices at kickoff,
 * multiplied) against what was paid. A Kalshi combo's markup is part of what was paid, so
 * it counts against parlay CLV, as it should.
 */
export const ticketClv = (r: BetRecord): TicketClv | null => {
  const legs = r.slip.legs.filter((l) => l.result !== "VOID");
  if (!legs.length || legs.some((l) => typeof l.closePrice !== "number")) return null;
  let close = product(legs.map((l) => (l.closePrice as number) / 100));
  let entry: number | null = null;

  if (legs.length === 1) {
    const leg = legs[0];
    if (r.imported) entry = r.probability || (leg.price ? leg.price / 100 : null);
    else if (r.side && leg.price) {
      // An evaluated BUY NO faded a leg written as YES.
      entry = r.side === "NO" ? 1 - leg.price / 100 : leg.price / 100;
      if (r.side === "NO") close = 1 - close;
    }
  } else if (r.imported && r.probability) entry = r.probability;
  else if (r.slip.comboPrice) entry = r.slip.comboPrice / 100;
  else if (legs.every((l) => l.price)) entry = product(legs.map((l) => (l.price as number) / 100));

  if (!entry || entry <= 0 || close <= 0) return null;
  return { entry, close, clv: close / entry - 1 };
};

export interface ClvSummary {
  n: number;
  /** Mean CLV across tickets (0.04 = bought 4% cheaper than the close). */
  average: number | null;
  /** Share of tickets that beat the closing line. */
  beatRate: number | null;
  recent: { record: BetRecord; clv: TicketClv }[];
}

export const clvSummary = (records: BetRecord[]): ClvSummary => {
  const rows = records
    .map((record) => ({ record, clv: ticketClv(record) }))
    .filter((r): r is { record: BetRecord; clv: TicketClv } => r.clv !== null)
    .sort((a, b) => b.record.createdAt - a.record.createdAt);
  const n = rows.length;
  return {
    n,
    average: n ? rows.reduce((s, r) => s + r.clv.clv, 0) / n : null,
    beatRate: n ? rows.filter((r) => r.clv.clv > 0).length / n : null,
    recent: rows.slice(0, 12),
  };
};

/* ------------------------------- Calibration ------------------------------- */

/** Settled picks needed before the correction is applied to new evaluations. */
export const MIN_CALIBRATION_PICKS = 15;

const BUCKETS: [number, number][] = [
  [0, 0.2],
  [0.2, 0.35],
  [0.35, 0.5],
  [0.5, 0.65],
  [0.65, 0.8],
  [0.8, 1.01],
];

export interface CalibrationBucket {
  from: number;
  to: number;
  n: number;
  /** Mean probability the model gave the picks in this band. */
  predicted: number;
  /** How often they actually won. */
  actual: number;
}

export interface Calibration {
  n: number;
  buckets: CalibrationBucket[];
  /** Mean predicted vs actual hit rate over every calibrated pick. */
  predicted: number | null;
  actual: number | null;
  /** Brier score of the raw model (lower is better; 0.25 is a coin flip at 50%). */
  brier: number | null;
  /** Fitted correction in log-odds: calibrated = σ(alpha · logit(p) + beta). */
  alpha: number;
  beta: number;
  /** True once there's enough history to correct new evaluations. */
  active: boolean;
}

/** AI-researched picks with a model probability and a known result for the side taken. */
const calibrationPoints = (records: BetRecord[]) =>
  records.flatMap((r): { p: number; y: number }[] => {
    if (r.outcome === "PENDING" || !r.ai || r.imported || /TRIMMED/.test(r.verdict)) return [];
    const p = r.rawProbability ?? r.probability;
    if (!(p > 0 && p < 1)) return [];
    if (r.slip.legs.length === 1) {
      if (!r.side) return []; // a PASS took no side, so there's nothing to grade
      const leg = r.slip.legs[0];
      const settled = leg.result === "WIN" || leg.result === "LOSS";
      // Leg results are for the leg as written; a BUY NO won when that leg lost.
      const won = settled ? (r.side === "NO" ? leg.result === "LOSS" : leg.result === "WIN") : r.outcome === "WIN";
      return [{ p, y: won ? 1 : 0 }];
    }
    return [{ p, y: r.outcome === "WIN" ? 1 : 0 }];
  });

const logit = (p: number) => Math.log(p / (1 - p));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

export const calibration = (records: BetRecord[]): Calibration => {
  const points = calibrationPoints(records);
  const n = points.length;
  const buckets = BUCKETS.map(([from, to]) => {
    const inside = points.filter((pt) => pt.p >= from && pt.p < to);
    return {
      from,
      to: Math.min(1, to),
      n: inside.length,
      predicted: inside.length ? inside.reduce((s, pt) => s + pt.p, 0) / inside.length : (from + Math.min(1, to)) / 2,
      actual: inside.length ? inside.reduce((s, pt) => s + pt.y, 0) / inside.length : 0,
    };
  });

  // Fit σ(α·logit(p)+β) by grid search on log loss, with a pull toward "no correction"
  // (α=1, β=0) so a handful of results can't swing it wildly.
  let alpha = 1;
  let beta = 0;
  if (n > 0) {
    let best = Infinity;
    for (let a = 0.3; a <= 1.6001; a += 0.05) {
      for (let b = -1.5; b <= 1.5001; b += 0.05) {
        let loss = 4 * ((a - 1) ** 2 + b ** 2);
        for (const pt of points) {
          const q = clamp(sigmoid(a * logit(clamp(pt.p, 0.005, 0.995)) + b), 1e-4, 1 - 1e-4);
          loss -= pt.y ? Math.log(q) : Math.log(1 - q);
        }
        if (loss < best) {
          best = loss;
          alpha = a;
          beta = b;
        }
      }
    }
  }

  return {
    n,
    buckets,
    predicted: n ? points.reduce((s, pt) => s + pt.p, 0) / n : null,
    actual: n ? points.reduce((s, pt) => s + pt.y, 0) / n : null,
    brier: n ? points.reduce((s, pt) => s + (pt.p - pt.y) ** 2, 0) / n : null,
    alpha: Math.round(alpha * 100) / 100,
    beta: Math.round(beta * 100) / 100,
    active: n >= MIN_CALIBRATION_PICKS,
  };
};

/** The correction as a function, or undefined until there's enough history. */
export const calibrator = (c: Calibration): Calibrator | undefined =>
  c.active && (c.alpha !== 1 || c.beta !== 0)
    ? (p) => sigmoid(c.alpha * logit(clamp(p, 0.005, 0.995)) + c.beta)
    : undefined;

/* ------------------------------ ROI breakdown ------------------------------ */

export type BreakdownDimension = "Sport" | "Market" | "Legs" | "Source" | "Risk";

export interface BreakdownRow {
  key: string;
  picks: number;
  wins: number;
  losses: number;
  /** Units won per unit staked (flat 1-unit stakes), when the picks have odds. */
  roi: number | null;
  /** Dollars won or lost on staked picks. */
  profit: number;
  staked: number;
  /** Average CLV of the group's picks that have one. */
  clv: number | null;
  tag: "leak" | "strength" | null;
}

const legsBucket = (n: number) => (n === 1 ? "Straight" : n <= 3 ? "2–3 legs" : n <= 6 ? "4–6 legs" : "7+ legs");

const keyFor = (r: BetRecord, dim: BreakdownDimension): string => {
  switch (dim) {
    case "Sport": {
      const sports = sportsOf(r);
      return sports.length === 1 ? sports[0] : "Mixed sports";
    }
    case "Market": {
      const types = [...new Set(r.slip.legs.map(marketType))];
      return types.length === 1 ? types[0] : "Mixed markets";
    }
    case "Legs":
      return legsBucket(r.slip.legs.length);
    case "Source":
      return r.verdict.startsWith("AI SCANNER") ? "Top Picks scanner" : r.imported ? "Logged from Kalshi" : r.ai ? "AI researched" : "Market only";
    case "Risk":
      return `Risk ${r.risk}`;
  }
};

/** Where the money comes from and goes, over settled picks. */
export const breakdown = (records: BetRecord[], dim: BreakdownDimension): BreakdownRow[] => {
  const groups = new Map<string, BetRecord[]>();
  for (const r of records) {
    if (r.outcome === "PENDING") continue;
    const key = keyFor(r, dim);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, rs]) => {
      const priced = rs.filter((r) => r.decimalOdds && r.decimalOdds > 1);
      const units = priced.reduce((s, r) => s + (r.outcome === "WIN" ? (r.decimalOdds as number) - 1 : -1), 0);
      const staked = rs.filter((r) => r.wager && r.netProfit !== null && r.netProfit !== undefined);
      const clvs = rs.map(ticketClv).filter((c): c is TicketClv => c !== null);
      const roi = priced.length ? units / priced.length : null;
      return {
        key,
        picks: rs.length,
        wins: rs.filter((r) => r.outcome === "WIN").length,
        losses: rs.filter((r) => r.outcome === "LOSS").length,
        roi,
        profit: staked.reduce((s, r) => s + (r.netProfit ?? 0), 0),
        staked: staked.reduce((s, r) => s + (r.wager ?? 0), 0),
        clv: clvs.length ? clvs.reduce((s, c) => s + c.clv, 0) / clvs.length : null,
        tag: (rs.length >= 5 && roi !== null ? (roi <= -0.15 ? "leak" : roi >= 0.1 ? "strength" : null) : null) as BreakdownRow["tag"],
      };
    })
    .sort((a, b) => (a.roi ?? 0) - (b.roi ?? 0));
};

/* ------------------------------- Combo markup ------------------------------- */

export interface ComboMarkup {
  /** The legs' own prices multiplied, in cents. */
  fair: number;
  combo: number;
  /** Cents paid above the legs' product. */
  cents: number;
  /** combo ÷ fair − 1. */
  ratio: number;
  /** Worth flagging: at least 2¢ or 10% over the legs. */
  steep: boolean;
}

/**
 * How much a Kalshi combo charges over buying its legs' odds separately. Leg prices are
 * asks, which already include each leg's spread, so the true markup is at least this.
 */
export const comboMarkup = (slip: BetSlip): ComboMarkup | null => {
  const legs = slip.legs.filter((l) => l.result !== "VOID");
  if (legs.length < 2 || !slip.comboPrice || !legs.every((l) => l.price)) return null;
  const fair = product(legs.map((l) => (l.price as number) / 100)) * 100;
  if (fair <= 0) return null;
  const cents = slip.comboPrice - fair;
  const ratio = slip.comboPrice / fair - 1;
  return { fair, combo: slip.comboPrice, cents, ratio, steep: cents >= 2 || ratio >= 0.1 };
};

/* ------------------------------ Limit orders ------------------------------ */

/** Kalshi's maker fee where it applies (many markets charge none): 1.75% of P × (1 − P). */
export const makerFee = (price: number) => 0.0175 * price * (1 - price);

export interface MakerPlan {
  side: Side;
  /** Current ask in cents. */
  ask: number;
  /** Suggested resting bid in cents: a cent under the ask, never above `maxPrice`. */
  limit: number;
  /** Highest price that still clears the risk level's minimum edge as a maker. */
  maxPrice: number;
  takerEdge: number;
  makerEdge: number;
  /** Fee saved per contract by resting instead of taking at the ask, in cents. */
  feeSaved: number;
  /** Taking misses the minimum edge, but a filled limit order would clear it. */
  unlocks: boolean;
}

/** Straight bets: what to bid with a limit order instead of paying the taker fee. */
export const makerPlan = (evaluation: Evaluation, risk: RiskLevel, hasPrice: boolean): MakerPlan | null => {
  if (!hasPrice) return null;
  const minEdge = RISK_PROFILES[risk].minEdge;
  const s = evaluation.side
    ? evaluation.sides[evaluation.side]
    : [evaluation.sides.YES, evaluation.sides.NO].sort((a, b) => b.edge - a.edge)[0];
  let maxPrice = 0;
  for (let c = 99; c >= 1; c--) {
    if (s.probability - c / 100 - makerFee(c / 100) >= minEdge) {
      maxPrice = c;
      break;
    }
  }
  if (!maxPrice) return null;
  const ask = Math.round(s.price * 100);
  const limit = Math.max(1, Math.min(ask - 1, maxPrice));
  const p = limit / 100;
  return {
    side: s.side,
    ask,
    limit,
    maxPrice,
    takerEdge: s.edge,
    makerEdge: s.probability - p - makerFee(p),
    feeSaved: (kalshiFee(s.price) - makerFee(s.price)) * 100,
    unlocks: !evaluation.side && s.edge < minEdge,
  };
};
