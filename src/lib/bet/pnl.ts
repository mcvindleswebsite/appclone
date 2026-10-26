import type { BetRecord } from "@/types/bet";

export const DEFAULT_WAGER = 10;

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * Fills in a pick's potential payout and net profit from its wager, ticket odds, and
 * outcome. The one place this math lives: the page, the vault API, and the settlement
 * sync all run records through it, so their numbers always agree.
 */
export const withPnl = (r: BetRecord): BetRecord => {
  if (!r.wager || r.wager <= 0) return { ...r, potentialPayout: null, netProfit: null };
  const potentialPayout = r.decimalOdds && r.decimalOdds > 1 ? cents(r.wager * r.decimalOdds) : null;
  const netProfit =
    r.outcome === "LOSS" ? -cents(r.wager) : r.outcome === "WIN" && potentialPayout !== null ? cents(potentialPayout - r.wager) : null;
  return { ...r, wager: cents(r.wager), potentialPayout, netProfit };
};

/** Dollar totals over settled, staked picks. */
export const profitSummary = (records: BetRecord[]) => {
  const settled = records.filter((r) => r.netProfit !== null && r.netProfit !== undefined && r.wager);
  const staked = settled.reduce((sum, r) => sum + (r.wager ?? 0), 0);
  const profit = settled.reduce((sum, r) => sum + (r.netProfit ?? 0), 0);
  return { profit: cents(profit), staked: cents(staked), roi: staked ? profit / staked : null, picks: settled.length };
};

export const formatMoney = (n: number, signed = false) =>
  `${signed && n > 0 ? "+" : n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
