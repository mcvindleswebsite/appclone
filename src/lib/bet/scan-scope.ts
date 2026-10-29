/**
 * What a Top Picks scan covers: which leagues, and which stretch of the calendar.
 * Shared by the Scanner (to ask for and filter picks) and the recommendations route.
 */

export const SOCCER_SCAN_LEAGUES = [
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

export const BASKETBALL_SCAN_LEAGUES = ["NBA", "College Basketball", "WNBA", "EuroLeague"] as const;

export const SCAN_LEAGUES = [...SOCCER_SCAN_LEAGUES, ...BASKETBALL_SCAN_LEAGUES] as const;

export type ScanLeague = (typeof SCAN_LEAGUES)[number];

export type ScanSport = "soccer" | "basketball";

export const sportOfLeague = (league: string): ScanSport =>
  (BASKETBALL_SCAN_LEAGUES as readonly string[]).includes(league) ? "basketball" : "soccer";

export const leaguesOfSport = (sport: ScanSport): readonly ScanLeague[] =>
  sport === "basketball" ? BASKETBALL_SCAN_LEAGUES : SOCCER_SCAN_LEAGUES;

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

/**
 * Kalshi expects a soccer match market to settle about two hours after kickoff, and a
 * basketball game about three hours after tip-off.
 */
export const kickoffOf = (settlesAt: string, league = "") =>
  Date.parse(settlesAt) - (sportOfLeague(league) === "basketball" ? 3 : 2) * 60 * 60 * 1000;

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
