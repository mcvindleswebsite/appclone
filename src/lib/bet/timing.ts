import type { BetLeg, BetRecord } from "@/types/bet";

/**
 * Game timing for vault legs, with no AI involved. Kalshi's milestones give each game's
 * real start; Kalshi's own `expected_expiration_time` is a flat start + 3h for every sport,
 * so the finish is estimated here from typical game lengths instead.
 */

export interface LegTiming {
  /** ISO start of the game the leg is on. */
  startsAt: string;
  /** ISO estimated time the leg's market can settle (end of the game or period). */
  endsAt: string;
}

const MIN = 60 * 1000;

/** Typical wall-clock length of a full game, by Kalshi series prefix (minutes). */
const GAME_MINUTES: [RegExp, number][] = [
  [/^KXNFL/, 190],
  [/^KXNCAAF/, 205],
  [/^KXWNBA/, 120],
  [/^KXNBA/, 140],
  [/^KXNCAA(?:M|W)?B/, 125],
  [/^KXNHL/, 155],
  [/^KXMLB/, 170],
  [/^KX(?:EPL|LALIGA|SERIEA|BUNDESLIGA|LIGUE1|UCL|UEL|UECL|MLS|LIGAMX|EREDIVISIE|FACUP|WC|SOCCER)/, 115],
  [/^KX(?:ATP|WTA)/, 150],
];

/** Markets that settle partway through the game, as a share of its length. */
const PARTIAL: [RegExp, number][] = [
  [/1Q(?:SPREAD|TOTAL|BTTS)?$/, 0.3],
  [/2Q(?:SPREAD|TOTAL|BTTS)?$/, 0.55],
  [/3Q(?:SPREAD|TOTAL|BTTS)?$/, 0.8],
  [/1P(?:SPREAD|TOTAL)?$/, 0.35],
  [/2P(?:SPREAD|TOTAL)?$/, 0.68],
  [/1H(?:SPREAD|TOTAL|TEAMTOTAL|FT)?$/, 0.55],
  [/^KXMLBF3/, 0.35],
  [/^KXMLBF5(?:SPREAD|TOTAL)?$/, 0.55],
  [/^KXMLBF7/, 0.78],
];

/** Kalshi's expected expiration sits exactly 3 hours after the start for game markets. */
const KALSHI_PAD_MINUTES = 180;

const series = (ticker: string) => ticker.toUpperCase().split("-")[0];

/**
 * When a leg's market should settle: the game's start plus a typical length for its sport
 * (scaled for half/quarter/period markets). Without a known sport, Kalshi's own estimate.
 */
export const estimateTiming = (
  ticker: string,
  start: string | null | undefined,
  kalshiExpected: string | null | undefined,
): LegTiming | null => {
  const s = series(ticker);
  const startMs = Date.parse(start ?? "");
  const expectedMs = Date.parse(kalshiExpected ?? "");
  const minutes = GAME_MINUTES.find(([re]) => re.test(s))?.[1] ?? null;
  const share = PARTIAL.find(([re]) => re.test(s))?.[1] ?? 1;

  if (Number.isFinite(startMs)) {
    const length = minutes ?? (Number.isFinite(expectedMs) ? (expectedMs - startMs) / MIN : KALSHI_PAD_MINUTES);
    return { startsAt: new Date(startMs).toISOString(), endsAt: new Date(startMs + length * share * MIN).toISOString() };
  }
  if (Number.isFinite(expectedMs)) {
    // No milestone: back the start out of Kalshi's padding, then apply the sport length.
    const guessStart = expectedMs - KALSHI_PAD_MINUTES * MIN;
    const end = minutes ? guessStart + minutes * share * MIN : expectedMs;
    return { startsAt: new Date(guessStart).toISOString(), endsAt: new Date(end).toISOString() };
  }
  return null;
};

export interface SlipTiming {
  /** Earliest start across the counted legs. */
  startsAt: number;
  /** When the last leg should be final: the parlay's completion time. */
  endsAt: number;
  /** Counted legs with known timing, and how many legs count at all. */
  known: number;
  total: number;
}

/**
 * The parlay's completion time is its latest-finishing leg. Live timing (fetched fresh, keyed
 * by ticker) wins over timing saved on the leg at import. VOID legs don't count.
 */
export const slipTiming = (record: BetRecord, live: Record<string, LegTiming>): SlipTiming | null => {
  const counted = record.slip.legs.filter((l) => l.result !== "VOID");
  const timings = counted.flatMap((l): LegTiming[] => {
    const t = (l.ticker && live[l.ticker]) || legTiming(l);
    return t ? [t] : [];
  });
  const combo = record.slip.comboTicker ? live[record.slip.comboTicker] : undefined;
  if (combo) timings.push(combo);
  if (!timings.length) return null;
  return {
    startsAt: Math.min(...timings.map((t) => Date.parse(t.startsAt))),
    endsAt: Math.max(...timings.map((t) => Date.parse(t.endsAt))),
    // A combo's timing covers every leg it bundles.
    known: combo ? counted.length : Math.min(counted.length, timings.length),
    total: counted.length,
  };
};

export const legTiming = (leg: BetLeg): LegTiming | null =>
  leg.startsAt && leg.endsAt ? { startsAt: leg.startsAt, endsAt: leg.endsAt } : null;

/** Tickers worth asking Kalshi about: pending picks' legs and combos. */
export const timingTickers = (records: BetRecord[]) => [
  ...new Set(
    records
      .filter((r) => r.outcome === "PENDING")
      .flatMap((r) => [
        ...(r.slip.comboTicker ? [r.slip.comboTicker] : []),
        ...r.slip.legs.flatMap((l) => (l.ticker && l.result !== "VOID" ? [l.ticker] : [])),
      ]),
  ),
];
