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
