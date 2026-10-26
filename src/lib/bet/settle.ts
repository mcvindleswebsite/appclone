import { resolveKalshiLinks } from "@/lib/bet/kalshi-api";
import { settleLegs, tickerLink } from "@/lib/bet/kalshi-link";
import type { BetRecord } from "@/types/bet";

/** Combos settle as one market but can bundle more legs than the evaluator handles. */
const MAX_SETTLEMENT_LEGS = 25;

/** Kalshi tickers a pending pick can be checked by, or none for hand-entered legs. */
export const settlementTickers = (r: BetRecord) =>
  r.slip.comboTicker ? [r.slip.comboTicker] : r.slip.legs.flatMap((l) => (l.ticker ? [l.ticker] : []));

export const isSettleable = (r: BetRecord) => r.outcome === "PENDING" && settlementTickers(r).length > 0;

/**
 * Re-reads a pending pick's markets from Kalshi (no AI): each leg takes its WIN/LOSS as its
 * game finishes, and the pick settles as soon as a leg loses or every leg has won. Returns
 * the updated record, or null when nothing changed.
 */
export const settleRecord = async (r: BetRecord): Promise<BetRecord | null> => {
  const tickers = settlementTickers(r);
  if (r.outcome !== "PENDING" || tickers.length === 0) return null;

  const data = await resolveKalshiLinks(tickers.map(tickerLink).join("\n"), MAX_SETTLEMENT_LEGS);
  const results = new Map(data.legs.map((l) => [l.ticker, l.result]));
  const legs = r.slip.legs.map((l) => {
    const result = l.ticker ? results.get(l.ticker) : undefined;
    return result && result !== l.result ? { ...l, result } : l;
  });
  // A combo link resolves to its own legs, which may not carry the stored legs' tickers.
  const comboLegs = r.slip.comboTicker && !r.slip.legs.some((l) => l.ticker && results.has(l.ticker)) ? data.legs : null;
  const nextLegs = comboLegs ?? legs;
  const { outcome } = settleLegs(nextLegs, r.slip.comboTicker ? data.comboResult : null);

  const changed = outcome !== r.outcome || nextLegs.some((l, i) => l.result !== r.slip.legs[i]?.result);
  if (!changed) return null;
  return { ...r, outcome, updatedAt: Date.now(), slip: { ...r.slip, legs: nextLegs } };
};

/** Settles pending picks a few at a time, so a big vault doesn't flood Kalshi's API. */
export const settleRecords = async (records: BetRecord[], limit = 60, concurrency = 5) => {
  const pending = records.filter(isSettleable).slice(0, limit);
  const updated: BetRecord[] = [];
  let failed = 0;
  for (let i = 0; i < pending.length; i += concurrency) {
    const batch = await Promise.allSettled(pending.slice(i, i + concurrency).map(settleRecord));
    for (const r of batch) {
      if (r.status === "fulfilled" && r.value) updated.push(r.value);
      else if (r.status === "rejected") failed++;
    }
  }
  return {
    checked: pending.length,
    updated,
    settled: updated.filter((r) => r.outcome !== "PENDING").length,
    failed,
  };
};
