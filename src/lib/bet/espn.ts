/**
 * ESPN's public, keyless scoreboard and standings JSON: live game pages for US sports (the
 * "Game" button) and basketball league tables (the Mismatches mode). Cached 10 minutes.
 */

import type { TableSpot } from "@/lib/bet/football-api";

const API = "https://site.api.espn.com/apis";
const KICKOFF_SLACK_MS = 6 * 60 * 60 * 1000;
/** Standings this early in a season are noise: no mismatches until teams average this many games. */
const MIN_GAMES = 5;

/** Kalshi game series → ESPN sport path. */
const SERIES_PATHS: Record<string, string> = {
  KXNBAGAME: "basketball/nba",
  KXWNBAGAME: "basketball/wnba",
  KXNCAAMBGAME: "basketball/mens-college-basketball",
  KXNFLGAME: "football/nfl",
  KXNCAAFGAME: "football/college-football",
  KXNHLGAME: "hockey/nhl",
  KXMLBGAME: "baseball/mlb",
};

/** Scanner leagues with an ESPN table. College ranks by conference, so it's left out. */
const STANDINGS_PATHS: Record<string, string> = { NBA: "basketball/nba", WNBA: "basketball/wnba" };

export const espnPathFor = (ticker: string) => SERIES_PATHS[ticker.toUpperCase().split("-")[0]] ?? null;

const get = async <T,>(url: string): Promise<T | null> => {
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, next: { revalidate: 600 } });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
};

const tokens = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Every Kalshi word ("Los Angeles L") starts a word of one of ESPN's names for the team. */
const sameTeam = (kalshi: string, names: (string | undefined)[]) => {
  const k = tokens(kalshi);
  return (
    k.length > 0 &&
    names.some((n) => {
      const t = tokens(n ?? "");
      return t.length > 0 && k.every((w) => t.some((x) => x.startsWith(w)));
    })
  );
};

interface EspnTeam {
  displayName?: string;
  shortDisplayName?: string;
  location?: string;
  name?: string;
  abbreviation?: string;
}
const namesOf = (t: EspnTeam | undefined) => [t?.displayName, t?.shortDisplayName, t?.location, t?.abbreviation, `${t?.location} ${t?.name}`];

interface EspnEvent {
  date: string;
  links?: { href?: string }[];
  competitions?: { competitors?: { team?: EspnTeam }[] }[];
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replaceAll("-", "");

/** ESPN's game page for a Kalshi matchup at a kickoff, or null. */
export const espnGameUrl = async (path: string, matchup: string, kickoffIso: string): Promise<string | null> => {
  const teams = matchup.split(/\s+(?:vs\.?|v\.?|@|at)\s+/i).map((t) => t.replace(/^game \d+:\s*/i, "").trim()).filter(Boolean);
  const kickoff = Date.parse(kickoffIso);
  if (teams.length !== 2 || !Number.isFinite(kickoff)) return null;
  // ESPN files games under US dates, so an evening tip-off in UTC can sit on the day before.
  const days = [...new Set([ymd(kickoff), ymd(kickoff - KICKOFF_SLACK_MS)])];
  // College needs groups=50 (all of Division I) or only ranked teams come back.
  const extra = path.includes("college") ? "&groups=50&limit=500" : "&limit=500";
  const events = (
    await Promise.all(days.map((d) => get<{ events?: EspnEvent[] }>(`${API}/site/v2/sports/${path}/scoreboard?dates=${d}${extra}`)))
  ).flatMap((r) => r?.events ?? []);

  const score = (e: EspnEvent) => {
    const sides = (e.competitions?.[0]?.competitors ?? []).map((c) => namesOf(c.team));
    return teams.filter((t) => sides.some((names) => sameTeam(t, names))).length;
  };
  const off = (e: EspnEvent) => Math.abs(Date.parse(e.date) - kickoff);
  const ranked = events
    .map((e) => ({ e, s: score(e) }))
    // Both teams on a nearby date (ESPN and Kalshi times can be placeholders that disagree), or one
    // team close to the kickoff when Kalshi's short name ("Los Angeles C") doesn't read like ESPN's ("LA Clippers").
    .filter(({ e, s }) => s === 2 || (s === 1 && off(e) <= KICKOFF_SLACK_MS))
    .sort((a, b) => b.s - a.s || off(a.e) - off(b.e));
  const best = ranked[0];
  if (!best) return null;
  const href = best.e.links?.find((l) => l.href?.startsWith("https://www.espn.com/"))?.href;
  return href ?? null;
};

interface EspnStandings {
  children?: { standings?: { entries?: { team?: EspnTeam; stats?: { name?: string; value?: number; displayValue?: string }[] }[] } }[];
}

/** A basketball league's table, ranked by win percentage across both conferences; null when unavailable or too early. */
export const espnStandings = async (league: string): Promise<Map<string, TableSpot> | null> => {
  const path = STANDINGS_PATHS[league];
  if (!path) return null;
  const data = await get<EspnStandings>(`${API}/v2/sports/${path}/standings`);
  const rows = (data?.children ?? []).flatMap((c) => c.standings?.entries ?? []).flatMap((e) => {
    const stat = (n: string) => e.stats?.find((s) => s.name === n);
    const wins = stat("wins")?.value ?? 0;
    const losses = stat("losses")?.value ?? 0;
    const name = e.team?.displayName;
    return name ? [{ name, wins, games: wins + losses, pct: wins + losses ? wins / (wins + losses) : 0, streak: stat("streak")?.displayValue ?? "" }] : [];
  });
  if (!rows.length || rows.reduce((s, r) => s + r.games, 0) / rows.length < MIN_GAMES) return null;
  rows.sort((a, b) => b.pct - a.pct || b.wins - a.wins);
  return new Map(rows.map((r, i) => [r.name, { rank: i + 1, of: rows.length, points: r.wins, form: r.streak === "-" ? "" : r.streak }]));
};
