import { kalshiDecimal } from "@/lib/bet/engine";
import type { RecommendedLeg } from "@/types/bet";

/**
 * Builds a parlay for a target payout from a scan's picks (no AI): of every combination of
 * legs that pays at least the target, the one the AI rates most likely to hit. Payouts are
 * each leg's Kalshi price with the taker fee, multiplied — legs bought separately; a Kalshi
 * combo quotes its own price.
 */

export const PAYOUT_TARGETS = [3, 5, 10, 20] as const;
/** More legs than this and one draw sinks the ticket too often to be worth building. */
export const MAX_PARLAY_LEGS = 6;
/** Pools are small (a scan returns at most 10), so every combination is checked. */
const MAX_POOL = 12;

export interface BuiltParlay {
  legs: RecommendedLeg[];
  /** Payout per $1 staked, fees in. */
  decimal: number;
  /** The AI's chance every leg wins (legs are different matches, so treated as independent). */
  probability: number;
  /** False when no combination reaches the target; this is then the biggest payout available. */
  reached: boolean;
}

export const buildParlay = (pool: RecommendedLeg[], target: number): BuiltParlay | null => {
  const legs = pool.filter((l) => l.leg.price !== null).slice(0, MAX_POOL);
  if (legs.length < 2) return null;
  const decimals = legs.map((l) => kalshiDecimal(l.leg.price!));
  let best: BuiltParlay | null = null;
  let biggest: BuiltParlay | null = null;
  for (let mask = 1; mask < 1 << legs.length; mask++) {
    let size = 0;
    let decimal = 1;
    let probability = 1;
    for (let i = 0; i < legs.length; i++) {
      if (!(mask & (1 << i))) continue;
      size++;
      decimal *= decimals[i];
      probability *= legs[i].modelProbability;
    }
    if (size < 2 || size > MAX_PARLAY_LEGS) continue;
    const pick = () => ({ legs: legs.filter((_, i) => mask & (1 << i)), decimal, probability });
    if (decimal >= target) {
      // Likeliest to hit wins; on a tie, fewer legs.
      if (!best || probability > best.probability + 1e-9 || (Math.abs(probability - best.probability) < 1e-9 && size < best.legs.length)) {
        best = { ...pick(), reached: true };
      }
    } else if (!biggest || decimal > biggest.decimal) {
      biggest = { ...pick(), reached: false };
    }
  }
  return best ?? biggest;
};
