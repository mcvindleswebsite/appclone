import type { BetRecord, BetSlip } from "@/types/bet";

/**
 * Bankroll and stake sizing for /bet, in the browser: fractional Kelly on the probability
 * the app trusts, capped per bet and per day. No AI involved.
 */

export interface BankrollSettings {
  /** Dollars set aside for betting; 0 = not set (sizing is off). */
  bankroll: number;
  /** Share of full Kelly to bet (0.25 = quarter Kelly). */
  kellyFraction: number;
  /** Largest single bet, as a share of bankroll. */
  maxBetPct: number;
  /** Most new money at risk per calendar day, as a share of bankroll. */
  dailyCapPct: number;
}

export const BANKROLL_STORAGE = "mcvindle_bet_bankroll";

export const DEFAULT_BANKROLL: BankrollSettings = { bankroll: 0, kellyFraction: 0.25, maxBetPct: 0.05, dailyCapPct: 0.15 };

export const KELLY_OPTIONS = [
  { value: 0.1, label: "1/10" },
  { value: 0.25, label: "1/4" },
  { value: 0.5, label: "1/2" },
] as const;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));

export const loadBankroll = (): BankrollSettings => {
  try {
    const saved = JSON.parse(localStorage.getItem(BANKROLL_STORAGE) ?? "null") as Partial<BankrollSettings> | null;
    if (!saved) return DEFAULT_BANKROLL;
    return {
      bankroll: clamp(Number(saved.bankroll), 0, 10_000_000),
      kellyFraction: clamp(Number(saved.kellyFraction), 0.05, 1),
      maxBetPct: clamp(Number(saved.maxBetPct), 0.005, 0.5),
      dailyCapPct: clamp(Number(saved.dailyCapPct), 0.01, 1),
    };
  } catch {
    return DEFAULT_BANKROLL;
  }
};

export const saveBankroll = (settings: BankrollSettings) => {
  try {
    localStorage.setItem(BANKROLL_STORAGE, JSON.stringify(settings));
  } catch {
    // Private mode: settings last for this visit only.
  }
};

/** Full-Kelly share of bankroll for a bet that wins with probability p and pays `decimal` (fees in). */
export const fullKelly = (p: number, decimal: number) => {
  const b = decimal - 1;
  if (!(b > 0)) return 0;
  return Math.max(0, (b * p - (1 - p)) / b);
};

/** New money staked today (local day), across every pick logged today. */
export const exposureToday = (records: BetRecord[], now: number) => {
  const day = new Date(now).toDateString();
  return records.filter((r) => new Date(r.createdAt).toDateString() === day).reduce((sum, r) => sum + (r.wager ?? 0), 0);
};

export interface StakeAdvice {
  /** Suggested dollars, rounded to cents; 0 when there's no edge or nothing left today. */
  stake: number;
  /** Full Kelly share before scaling. */
  kelly: number;
  /** What limited the stake, if anything. */
  cappedBy: "max bet" | "daily cap" | null;
  /** Dollars still allowed today before this bet. */
  remainingToday: number;
}

/** Fractional-Kelly stake, then the per-bet and daily caps. Null when no bankroll is set. */
export const adviseStake = (
  settings: BankrollSettings,
  p: number,
  decimal: number,
  exposure: number
): StakeAdvice | null => {
  if (!settings.bankroll) return null;
  const kelly = fullKelly(p, decimal);
  const remainingToday = Math.max(0, settings.bankroll * settings.dailyCapPct - exposure);
  let stake = settings.bankroll * kelly * settings.kellyFraction;
  let cappedBy: StakeAdvice["cappedBy"] = null;
  if (stake > settings.bankroll * settings.maxBetPct) {
    stake = settings.bankroll * settings.maxBetPct;
    cappedBy = "max bet";
  }
  if (stake > remainingToday) {
    stake = remainingToday;
    cappedBy = "daily cap";
  }
  return { stake: Math.floor(stake * 100) / 100, kelly, cappedBy, remainingToday };
};

/**
 * A Kalshi ticker's game code ("KXEPLGAME-26OCT31ARSCHE-ARS" → "26OCT31ARSCHE"), shared by
 * every market on that game (winner, total, spread), whatever the series.
 */
const eventOf = (ticker: string) => ticker.split("-")[1] ?? ticker;

const teamsIn = (matchup: string) =>
  matchup
    .split(/\s+(?:vs\.?|v\.?|@|at)\s+/i)
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 2);

/**
 * Parlay legs whose results move together, which the parlay math (legs multiplied as if
 * independent) prices wrong: two legs on one game, or the same team in two legs.
 */
export const correlationWarnings = (slip: BetSlip): string[] => {
  if (slip.legs.length < 2) return [];
  const warnings: string[] = [];
  const events = new Map<string, number[]>();
  const teams = new Map<string, number[]>();
  slip.legs.forEach((leg, i) => {
    if (leg.ticker) events.set(eventOf(leg.ticker), [...(events.get(eventOf(leg.ticker)) ?? []), i + 1]);
    for (const t of new Set(teamsIn(leg.matchup))) teams.set(t, [...(teams.get(t) ?? []), i + 1]);
  });
  for (const legs of events.values()) {
    if (legs.length > 1) warnings.push(`Legs ${legs.join(" & ")} are on the same game — their results are linked, so multiplying their odds misprices the parlay.`);
  }
  for (const [team, legs] of teams) {
    if (legs.length > 1 && !warnings.some((w) => w.startsWith(`Legs ${legs.join(" & ")}`))) {
      warnings.push(`Legs ${legs.join(" & ")} both involve ${team.replace(/\b\w/g, (c) => c.toUpperCase())} — correlated, not independent.`);
    }
  }
  return warnings.slice(0, 3);
};
