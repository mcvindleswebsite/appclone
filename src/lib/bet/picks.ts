import { kalshiDecimal } from "@/lib/bet/engine";
import type { LegAnalysis, SharpLine } from "@/types/bet";

/**
 * The bar a Top Pick has to clear, shared by the scan and the on-demand deep check. No AI
 * here: these are the rules applied to the research.
 */

/** A recommended match leg must be at least a coin flip. */
export const MIN_PROBABILITY = 0.5;
/** Title races rarely have a coin-flip favorite, so a futures leg only needs a real chance. */
export const MIN_FUTURES_PROBABILITY = 0.25;
/**
 * An AI-only leg (no sharp-book price to anchor it) needs solid evidence: 6+ on the 1-10
 * scale, where 4-5 means partial and 1-3 thin.
 */
export const MIN_AI_CONFIDENCE = 6;
/** The AI vetoes a sharp-anchored leg when its grounded estimate sits this far below the books. */
export const AI_VETO_GAP = 0.08;
/** Markets trading less than this ($ volume) aren't recommended at all: the quote is rarely real. */
export const MIN_VOLUME = 1000;

/**
 * The price edge a sharp-anchored leg needs after Kalshi's fee. Thin markets drift from the
 * books more often for no good reason (stale or tiny orders), so they need a bigger gap.
 */
export const minSharpEdge = (volume: number) => (volume < 5000 ? 0.02 : 0.01);

/**
 * Mismatches: a good-not-elite team against a bottom-of-the-table one. Works off the real
 * league table, so the obvious title favorites (top 3) are left out on purpose.
 */
export const MISMATCH = {
  /** The favorite still has to be the market's favorite to win. */
  minProbability: 0.5,
  /** Leave out the league's top 3: everyone already knows those. */
  skipTop: 3,
  /** The opponent sits in the bottom third of the table. */
  bottomShare: 1 / 3,
  /** Table places between them, as a share of the league (7 places in a 20-team league). */
  minGapShare: 0.35,
  /** Thin leagues (Saudi) are allowed down to this; the pick is flagged as thin. */
  minVolume: 200,
} as const;

export interface TableMatchup {
  pick: { rank: number; form: string };
  opponent: { rank: number; form: string };
  of: number;
}

/** Whether a favorite-vs-opponent table spot is the kind of mismatch the mode looks for. */
export const isMismatch = (t: TableMatchup) =>
  t.pick.rank > MISMATCH.skipTop &&
  t.opponent.rank > t.of - Math.ceil(t.of * MISMATCH.bottomShare) &&
  t.opponent.rank - t.pick.rank >= Math.round(t.of * MISMATCH.minGapShare);

/** The AI can knock a mismatch out; it can't add one. */
export const mismatchFailReason = (input: PickInput, a: LegAnalysis): string | null => {
  if (input.price === null) return "No Kalshi price";
  if (input.volume < MISMATCH.minVolume) return "Market too thin";
  if (marketWinProbability(input) < MISMATCH.minProbability) return "Not the favorite";
  if (a.researched && a.rating === "BUM PICK") return "Rated a bum pick";
  if (a.researched && a.opponentTier.trapGame) return "Trap game";
  if (a.researched && a.dataSufficient && a.probability < marketWinProbability(input) - AI_VETO_GAP) {
    return "Research sees an upset risk the market doesn't";
  }
  return null;
};

/** Safest Wins: the favorite must be at least this likely to win, by the market's best price. */
export const SAFE_MIN_PROBABILITY = 0.6;

export interface PickInput {
  /** Kalshi ask in cents. */
  price: number | null;
  volume: number;
  sharp?: SharpLine;
  futures?: boolean;
}

/** Why a researched leg fails the bar, or null when it qualifies. */
export const failReason = (input: PickInput, a: LegAnalysis): string | null => {
  if (input.price === null) return "No Kalshi price";
  if (!a.researched) return "Research failed";
  if (!input.futures && input.volume < MIN_VOLUME) return "Market too thin";
  const minProbability = input.futures ? MIN_FUTURES_PROBABILITY : MIN_PROBABILITY;
  if (a.rating === "BUM PICK") return "Rated a bum pick";
  if (a.opponentTier.trapGame) return "Trap game";
  if (input.sharp) {
    if (input.sharp.edge < minSharpEdge(input.volume)) return "Price edge too small";
    if (input.sharp.fair < minProbability) return "Below the win-probability floor";
    if (a.dataSufficient && a.probability < input.sharp.fair - AI_VETO_GAP) return "Research disagrees with the books";
    return null;
  }
  if (!a.dataSufficient) return "Insufficient data";
  if (a.hitConfidence < MIN_AI_CONFIDENCE) return `Confidence below ${MIN_AI_CONFIDENCE}/10`;
  if (a.probability < minProbability) return "Below the win-probability floor";
  if (a.probability * kalshiDecimal(input.price) - 1 <= 0) return "Not +EV";
  return null;
};

/**
 * The market's best read on a favorite winning: the sharp books' de-vigged price when they
 * have one, else Kalshi's own price.
 */
export const marketWinProbability = (input: PickInput) => input.sharp?.fair ?? (input.price ?? 0) / 100;

/**
 * Safest Wins: the most likely winners, not the best value. A favorite qualifies on the
 * market's win probability; the AI can only knock it out (a bum pick, a trap game, or
 * grounded research well below the market). Research that comes back thin doesn't block it.
 */
export const safeFailReason = (input: PickInput, a: LegAnalysis): string | null => {
  if (input.price === null) return "No Kalshi price";
  if (!input.futures && input.volume < MIN_VOLUME) return "Market too thin";
  const p = marketWinProbability(input);
  if (p < SAFE_MIN_PROBABILITY) return `Under ${Math.round(SAFE_MIN_PROBABILITY * 100)}% to win`;
  if (a.researched && a.rating === "BUM PICK") return "Rated a bum pick";
  if (a.researched && a.opponentTier.trapGame) return "Trap game";
  if (a.researched && a.dataSufficient && a.probability < p - AI_VETO_GAP) return "Research sees an upset risk the market doesn't";
  return null;
};
