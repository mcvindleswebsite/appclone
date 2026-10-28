/**
 * Hard football data from API-Football (api-football.com, v3): recent form, goals, head-to-
 * head, injuries, and confirmed lineups for a fixture. Server-only: needs FOOTBALL_API_KEY.
 * No AI involved — these are the verified facts the deep research stage is handed.
 *
 * The free plan allows 100 requests a day, so every response is cached (Upstash when it's
 * connected) and a daily counter stops calls at DAILY_BUDGET.
 */

import type { ScanLeague } from "@/lib/bet/scan-scope";
import { redis } from "@/lib/bet/store";
import type { ReasoningStat } from "@/types/bet";

const API = "https://v3.football.api-sports.io";
const DAILY_BUDGET = 90;
const FIXTURES_TTL = 6 * 60 * 60;
const FACTS_TTL = 3 * 60 * 60;
/** Lineups are published about an hour before kickoff; only ask inside this window. */
const LINEUP_WINDOW_MS = 90 * 60 * 1000;

const LEAGUE_IDS: Record<ScanLeague, number> = {
  "Premier League": 39,
  "La Liga": 140,
  "Serie A": 135,
  Bundesliga: 78,
  "Ligue 1": 61,
  "Champions League": 2,
  "Europa League": 3,
  MLS: 253,
  "Saudi Pro League": 307,
};

/** API-Football names a season by the year it starts; MLS runs in one calendar year. */
const seasonOf = (league: ScanLeague, date: Date) =>
  league === "MLS" ? date.getUTCFullYear() : date.getUTCMonth() >= 6 ? date.getUTCFullYear() : date.getUTCFullYear() - 1;

export const footballConfigured = () => !!process.env.FOOTBALL_API_KEY;

interface ApiFixture {
  fixture: { id: number; date: string };
  teams: { home: { id: number; name: string }; away: { id: number; name: string } };
}

interface ApiPrediction {
  predictions?: { advice?: string; percent?: { home?: string; draw?: string; away?: string } };
  teams?: Record<
    "home" | "away",
    {
      name?: string;
      last_5?: { form?: string; goals?: { for?: { average?: string }; against?: { average?: string } } };
      league?: { form?: string };
    }
  >;
  h2h?: { fixture?: { date?: string }; teams?: { home?: { name?: string }; away?: { name?: string } }; goals?: { home?: number | null; away?: number | null } }[];
}

interface ApiInjury {
  player?: { name?: string; type?: string; reason?: string };
  team?: { name?: string };
}

interface ApiLineup {
  team?: { name?: string };
  formation?: string;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Reserves one request from today's budget; false once it's spent. Without Upstash, trusts the cache alone. */
const reserve = async () => {
  const key = `vindle_af_count:${today()}`;
  const reply = await redis(["INCR", key]).catch(() => null);
  if (!reply) return true;
  if (reply.result === 1) await redis(["EXPIRE", key, 36 * 60 * 60]).catch(() => null);
  return typeof reply.result === "number" && reply.result <= DAILY_BUDGET;
};

const memory = new Map<string, { at: number; value: unknown }>();

/** GET with a shared cache; null on any failure or when the daily budget is spent. */
const get = async <T,>(path: string, ttl: number): Promise<T[] | null> => {
  const cacheKey = `vindle_af:${path}`;
  const hit = memory.get(cacheKey);
  if (hit && Date.now() - hit.at < ttl * 1000) return hit.value as T[];
  const shared = await redis(["GET", cacheKey]).catch(() => null);
  if (typeof shared?.result === "string") {
    try {
      const value = JSON.parse(shared.result) as T[];
      memory.set(cacheKey, { at: Date.now(), value });
      return value;
    } catch {
      // Refetch below.
    }
  }
  const key = process.env.FOOTBALL_API_KEY;
  if (!key || !(await reserve())) return null;
  try {
    const response = await fetch(`${API}${path}`, {
      headers: { "x-apisports-key": key },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { response?: T[]; errors?: unknown };
    // API-Football reports plan limits and bad params in `errors` with a 200.
    const errors = data.errors && typeof data.errors === "object" ? Object.keys(data.errors) : [];
    if (!Array.isArray(data.response) || errors.length) return null;
    memory.set(cacheKey, { at: Date.now(), value: data.response });
    await redis(["SET", cacheKey, JSON.stringify(data.response), "EX", ttl]).catch(() => null);
    return data.response;
  } catch {
    return null;
  }
};

const tokens = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(fc|cf|afc|sc|ac|club|de|al)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);

/** Kalshi and API-Football spell clubs differently ("Man City" / "Manchester City"); any shared word prefix counts. */
const sameTeam = (a: string, b: string) => {
  const x = tokens(a);
  const y = tokens(b);
  return x.some((t) => y.some((w) => w.startsWith(t) || t.startsWith(w)));
};

export interface FootballFacts {
  fixtureId: number;
  /** Verified stats, ready to cite (source "API-Football"). */
  stats: ReasoningStat[];
  /** Plain block for the research prompt. */
  text: string;
  lineupsConfirmed: boolean;
}

/**
 * Verified facts for a Kalshi soccer match, or null when the fixture can't be matched, the
 * key isn't set, or today's request budget is spent. Costs at most 4 requests (fewer cached).
 */
export const footballFacts = async (league: ScanLeague, matchup: string, kickoffIso: string): Promise<FootballFacts | null> => {
  if (!footballConfigured()) return null;
  const kickoff = new Date(kickoffIso);
  if (!Number.isFinite(kickoff.getTime())) return null;
  const teams = matchup.split(/\s+(?:vs\.?|v\.?|@|at)\s+/i).map((t) => t.trim());
  if (teams.length !== 2) return null;

  const date = kickoff.toISOString().slice(0, 10);
  const fixtures = await get<ApiFixture>(
    `/fixtures?league=${LEAGUE_IDS[league]}&season=${seasonOf(league, kickoff)}&date=${date}`,
    FIXTURES_TTL
  );
  const fixture = fixtures?.find(
    (f) =>
      (sameTeam(teams[0], f.teams.home.name) && sameTeam(teams[1], f.teams.away.name)) ||
      (sameTeam(teams[0], f.teams.away.name) && sameTeam(teams[1], f.teams.home.name))
  );
  if (!fixture) return null;
  const id = fixture.fixture.id;
  const home = fixture.teams.home.name;
  const away = fixture.teams.away.name;

  const nearKickoff = kickoff.getTime() - Date.now() < LINEUP_WINDOW_MS;
  const [prediction, injuries, lineups] = await Promise.all([
    get<ApiPrediction>(`/predictions?fixture=${id}`, FACTS_TTL),
    get<ApiInjury>(`/injuries?fixture=${id}`, FACTS_TTL),
    nearKickoff ? get<ApiLineup>(`/fixtures/lineups?fixture=${id}`, 30 * 60) : Promise.resolve(null),
  ]);

  const stats: ReasoningStat[] = [];
  const lines: string[] = [`Fixture: ${home} (home) vs ${away} (away), kickoff ${fixture.fixture.date}`];
  const source = "API-Football";
  const p = prediction?.[0];
  for (const side of ["home", "away"] as const) {
    const t = p?.teams?.[side];
    if (!t) continue;
    const name = side === "home" ? home : away;
    const form = t.league?.form?.slice(-5);
    if (form) {
      stats.push({ metric: `${name} league form (last 5)`, value: form, source });
      lines.push(`${name} league form, last 5 (oldest→newest): ${form}`);
    }
    const gf = t.last_5?.goals?.for?.average;
    const ga = t.last_5?.goals?.against?.average;
    if (gf && ga) {
      stats.push({ metric: `${name} goals/game, last 5`, value: `${gf} for · ${ga} against`, source });
      lines.push(`${name} last 5: ${gf} goals scored and ${ga} conceded per game`);
    }
  }
  const h2h = (p?.h2h ?? [])
    .filter((m) => m.goals?.home !== null && m.goals?.home !== undefined)
    .slice(-5)
    .map((m) => `${m.fixture?.date?.slice(0, 10)} ${m.teams?.home?.name} ${m.goals?.home}-${m.goals?.away} ${m.teams?.away?.name}`);
  if (h2h.length) {
    let homeWins = 0;
    let draws = 0;
    let awayWins = 0;
    for (const m of (p?.h2h ?? []).slice(-5)) {
      const g = m.goals;
      if (g?.home === null || g?.home === undefined || g.away === null || g.away === undefined) continue;
      const winner = g.home > g.away ? m.teams?.home?.name : g.away > g.home ? m.teams?.away?.name : null;
      if (!winner) draws++;
      else if (sameTeam(winner, home)) homeWins++;
      else awayWins++;
    }
    stats.push({ metric: `Head-to-head, last ${h2h.length}`, value: `${home} ${homeWins} · draws ${draws} · ${away} ${awayWins}`, source });
    lines.push(`Head-to-head, last ${h2h.length}:\n${h2h.map((m) => `  ${m}`).join("\n")}`);
  }
  if (injuries?.length) {
    const out = injuries.slice(0, 12).map((i) => `${i.player?.name} (${i.team?.name}, ${i.player?.type ?? "out"}: ${i.player?.reason ?? "n/a"})`);
    stats.push({ metric: "Injuries / suspensions", value: `${injuries.length} listed`, source });
    lines.push(`Injuries and suspensions:\n${out.map((s) => `  ${s}`).join("\n")}`);
  } else if (injuries) {
    lines.push("Injuries and suspensions: none listed.");
  }
  const lineupsConfirmed = !!lineups?.length;
  if (lineupsConfirmed) {
    stats.push({ metric: "Lineups", value: "Confirmed", source });
    lines.push(`Confirmed lineups: ${lineups!.map((l) => `${l.team?.name} ${l.formation ?? ""}`.trim()).join(" · ")}`);
  }
  const pct = p?.predictions?.percent;
  if (pct?.home && pct.away) lines.push(`API-Football's own model: home ${pct.home}, draw ${pct.draw ?? "?"}, away ${pct.away}`);

  return stats.length ? { fixtureId: id, stats, text: lines.join("\n"), lineupsConfirmed } : null;
};
