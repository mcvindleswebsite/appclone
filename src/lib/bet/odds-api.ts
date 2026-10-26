/**
 * Sharp sportsbook lines for Kalshi game-winner legs, from The Odds API (the-odds-api.com),
 * de-vigged into fair win probabilities. Server-only: needs ODDS_API_KEY. No AI involved.
 */

const API = "https://api.the-odds-api.com/v4/sports";
const CACHE_MS = 10 * 60 * 1000;

/** Kalshi game-winner series → The Odds API sport key. */
const SPORT_KEYS: [RegExp, string][] = [
  [/^KXNFLGAME$/, "americanfootball_nfl"],
  [/^KXNCAAFGAME$/, "americanfootball_ncaaf"],
  [/^KXNBAGAME$/, "basketball_nba"],
  [/^KXWNBAGAME$/, "basketball_wnba"],
  [/^KXNCAAMBGAME$/, "basketball_ncaab"],
  [/^KXNHLGAME$/, "icehockey_nhl"],
  [/^KXMLBGAME$/, "baseball_mlb"],
  [/^KXEPLGAME$/, "soccer_epl"],
  [/^KXLALIGAGAME$/, "soccer_spain_la_liga"],
  [/^KXSERIEAGAME$/, "soccer_italy_serie_a"],
  [/^KXBUNDESLIGAGAME$/, "soccer_germany_bundesliga"],
  [/^KXLIGUE1GAME$/, "soccer_france_ligue_one"],
  [/^KXUCLGAME$/, "soccer_uefa_champs_league"],
  [/^KXUELGAME$/, "soccer_uefa_europa_league"],
  [/^KXMLSGAME$/, "soccer_usa_mls"],
];

interface OddsEvent {
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: { key: string; title: string; markets: { key: string; outcomes: { name: string; price: number }[] }[] }[];
}

export interface BookLegQuery {
  ticker: string;
  matchup: string;
  pick: string;
  side?: "yes" | "no";
  startsAt?: string;
}

export interface BookLine {
  /** De-vigged probability for the leg's side. */
  fair: number;
  source: string;
}

export const sportKeyFor = (ticker: string) => {
  const series = ticker.toUpperCase().split("-")[0];
  return SPORT_KEYS.find(([re]) => re.test(series))?.[1] ?? null;
};

const cache = new Map<string, { at: number; events: Promise<OddsEvent[] | null> }>();

const eventsFor = (sport: string, key: string) => {
  const hit = cache.get(sport);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.events;
  // decimal odds, US + EU books (EU carries Pinnacle); 2 credits per refresh on the free tier.
  const url = `${API}/${sport}/odds?apiKey=${encodeURIComponent(key)}&regions=us,eu&markets=h2h&oddsFormat=decimal`;
  const events = fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) })
    .then((r) => (r.ok ? (r.json() as Promise<OddsEvent[]>) : null))
    .catch(() => null);
  cache.set(sport, { at: Date.now(), events });
  return events;
};

const tokens = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Every word Kalshi uses ("New York R") starts a word of the book's name ("New York Rangers"). */
const sameTeam = (kalshi: string, book: string) => {
  const k = tokens(kalshi);
  const b = tokens(book);
  return k.length > 0 && k.every((t) => b.some((w) => w.startsWith(t)));
};

const isDraw = (pick: string) => /^(tie|draw)$/i.test(pick.trim());

/** Fair probabilities for one book's moneyline, vig removed by normalizing. */
const fairOf = (outcomes: { name: string; price: number }[]) => {
  const implied = outcomes.map((o) => ({ name: o.name, p: o.price > 1 ? 1 / o.price : 0 }));
  const total = implied.reduce((s, o) => s + o.p, 0);
  return total > 0 ? implied.map((o) => ({ name: o.name, p: o.p / total })) : [];
};

const median = (ns: number[]) => {
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The book event for a Kalshi leg: both teams match, closest to the game's start. */
const findEvent = (events: OddsEvent[], leg: BookLegQuery) => {
  const teams = leg.matchup.split(/\s+(?:vs\.?|v\.?|@|at)\s+/i).map((t) => t.trim()).filter(Boolean);
  if (teams.length !== 2) return null;
  const start = Date.parse(leg.startsAt ?? "");
  const candidates = events.filter((e) => {
    const both =
      (sameTeam(teams[0], e.home_team) && sameTeam(teams[1], e.away_team)) ||
      (sameTeam(teams[0], e.away_team) && sameTeam(teams[1], e.home_team));
    return both && (!Number.isFinite(start) || Math.abs(Date.parse(e.commence_time) - start) < 36 * 3600 * 1000);
  });
  if (!Number.isFinite(start)) return candidates[0] ?? null;
  return candidates.sort((a, b) => Math.abs(Date.parse(a.commence_time) - start) - Math.abs(Date.parse(b.commence_time) - start))[0] ?? null;
};

/** Sharp-book fair probabilities for the legs that can be matched; others are left out. */
export const bookLines = async (legs: BookLegQuery[]): Promise<{ configured: boolean; lines: Record<string, BookLine> }> => {
  const key = process.env.ODDS_API_KEY;
  if (!key) return { configured: false, lines: {} };
  const lines: Record<string, BookLine> = {};

  await Promise.all(
    legs.map(async (leg) => {
      const sport = sportKeyFor(leg.ticker);
      if (!sport) return;
      const events = await eventsFor(sport, key);
      const event = events && findEvent(events, leg);
      if (!event) return;

      // A NO leg is written "Not Philadelphia"; match the team, then flip below.
      const team = leg.side === "no" ? leg.pick.replace(/^not\s+/i, "") : leg.pick;
      const probFor = (outcomes: { name: string; p: number }[]) =>
        outcomes.find((o) => (isDraw(team) ? isDraw(o.name) : !isDraw(o.name) && sameTeam(team, o.name)))?.p ?? null;

      const books = event.bookmakers
        .map((b) => {
          const h2h = b.markets.find((m) => m.key === "h2h");
          const p = h2h ? probFor(fairOf(h2h.outcomes)) : null;
          return p === null ? null : { key: b.key, title: b.title, p };
        })
        .filter((b): b is { key: string; title: string; p: number } => b !== null);
      if (!books.length) return;

      const pinnacle = books.find((b) => b.key === "pinnacle");
      const yes = pinnacle ? pinnacle.p : books.length >= 2 ? median(books.map((b) => b.p)) : null;
      if (yes === null) return;
      lines[leg.ticker] = {
        fair: Math.round((leg.side === "no" ? 1 - yes : yes) * 1000) / 1000,
        source: pinnacle ? "Pinnacle" : `${books.length}-book consensus`,
      };
    })
  );
  return { configured: true, lines };
};
