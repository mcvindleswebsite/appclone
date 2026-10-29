/**
 * Finds a soccer match on FotMob (live scores, lineups, stats) so the app can link to it.
 * Uses FotMob's public, keyless JSON: one day's fixtures by UTC date, cached 10 minutes.
 */

import { sameTeam } from "@/lib/bet/football-api";

const SITE = "https://www.fotmob.com";
/** Kalshi and FotMob kickoff times can differ a little; anything further off is another game. */
const KICKOFF_SLACK_MS = 6 * 60 * 60 * 1000;

interface FotmobMatch {
  id: number;
  home: { name: string; longName?: string };
  away: { name: string; longName?: string };
  status?: { utcTime?: string };
}

const get = async <T,>(path: string): Promise<T | null> => {
  try {
    const res = await fetch(`${SITE}${path}`, {
      headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
      next: { revalidate: 600 },
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
};

const teamsOf = (matchup: string) => matchup.split(/\s+(?:vs\.?|v\.?|@|at)\s+/i).map((t) => t.trim()).filter(Boolean);

const named = (team: FotmobMatch["home"], name: string) => sameTeam(name, team.longName ?? team.name) || sameTeam(name, team.name);

/** The FotMob match page for a Kalshi matchup ("Chelsea vs Man United") at a kickoff, or null. */
export const fotmobMatchUrl = async (matchup: string, kickoffIso: string): Promise<string | null> => {
  const teams = teamsOf(matchup);
  const kickoff = new Date(kickoffIso).getTime();
  if (teams.length !== 2 || !Number.isFinite(kickoff)) return null;

  // FotMob's "date" is a UTC day; a late kickoff can be listed on the next one.
  const days = [...new Set([kickoff, kickoff + KICKOFF_SLACK_MS, kickoff - KICKOFF_SLACK_MS].map((t) => new Date(t).toISOString().slice(0, 10).replaceAll("-", "")))];
  for (const day of days) {
    const data = await get<{ leagues?: { matches?: FotmobMatch[] }[] }>(`/api/data/matches?date=${day}`);
    const match = (data?.leagues ?? [])
      .flatMap((l) => l.matches ?? [])
      .find((m) => {
        const at = new Date(m.status?.utcTime ?? "").getTime();
        if (Number.isFinite(at) && Math.abs(at - kickoff) > KICKOFF_SLACK_MS) return false;
        return (named(m.home, teams[0]) && named(m.away, teams[1])) || (named(m.home, teams[1]) && named(m.away, teams[0]));
      });
    if (match) return `${SITE}/match/${match.id}`;
  }
  return null;
};

/** A team's FotMob page, for when the match itself can't be found. */
export const fotmobTeamUrl = async (name: string): Promise<string | null> => {
  const groups = await get<{ suggestions?: { type?: string; id?: string }[] }[]>(`/api/data/search/suggest?term=${encodeURIComponent(name)}`);
  const team = groups?.flatMap((g) => g.suggestions ?? []).find((s) => s.type === "team" && s.id && /^\d+$/.test(s.id));
  return team ? `${SITE}/teams/${team.id}` : null;
};

export { teamsOf as fotmobTeams };
