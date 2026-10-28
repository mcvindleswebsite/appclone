/**
 * What a Top Picks scan covers: which leagues, and which stretch of the calendar.
 * Shared by the Scanner (to ask for and filter picks) and the recommendations route.
 */

export const SCAN_LEAGUES = [
  "Premier League",
  "La Liga",
  "Serie A",
  "Bundesliga",
  "Ligue 1",
  "Champions League",
  "Europa League",
  "MLS",
  "Saudi Pro League",
] as const;

export type ScanLeague = (typeof SCAN_LEAGUES)[number];

export const TIME_WINDOWS = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "This Week" },
  { id: "month", label: "This Month" },
  { id: "futures", label: "Waiting Game" },
] as const;

export type TimeWindow = (typeof TIME_WINDOWS)[number]["id"];

export interface ScanScope {
  window: TimeWindow;
  /** Kickoff range in epoch ms, from the viewer's own day boundaries. Ignored for futures. */
  from: number;
  to: number;
  leagues: ScanLeague[];
}

const DAY = 24 * 60 * 60 * 1000;

/** Kalshi settles soccer match markets about two hours after kickoff. */
export const kickoffOf = (settlesAt: string) => Date.parse(settlesAt) - 2 * 60 * 60 * 1000;

/** Kickoff range for a match window, in local time. Futures have no range. */
export const windowRange = (window: TimeWindow, now: number): { from: number; to: number } => {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const today = midnight.getTime();
  switch (window) {
    case "today":
      return { from: now, to: today + DAY };
    case "tomorrow":
      return { from: today + DAY, to: today + 2 * DAY };
    case "week":
      return { from: now, to: now + 7 * DAY };
    case "month":
      return { from: now, to: now + 30 * DAY };
    case "futures":
      return { from: now, to: Number.POSITIVE_INFINITY };
  }
};

export const isTimeWindow = (value: unknown): value is TimeWindow => TIME_WINDOWS.some((w) => w.id === value);

export const isScanLeague = (value: unknown): value is ScanLeague => SCAN_LEAGUES.includes(value as ScanLeague);
