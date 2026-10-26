import { extractTickers, splitLinks } from "@/lib/bet/kalshi-link";
import { detectSport } from "@/lib/bet/parse-slip";
import type { BetLeg, KalshiImport, KalshiMarketOption, KalshiSlipImport, LegResult } from "@/types/bet";

/**
 * Server-side reads of Kalshi's public trade API (no auth, no AI). Shared by the slip
 * importer and the vault's settlement route.
 */
const API = "https://api.elections.kalshi.com/trade-api/v2";

interface ApiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  yes_sub_title?: string;
  status: string;
  result?: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  no_bid_dollars?: string;
  no_ask_dollars?: string;
  last_price_dollars?: string;
  settlement_value_dollars?: string;
  expected_expiration_time?: string;
  volume_fp?: string;
  mve_selected_legs?: { event_ticker: string; market_ticker: string; side: "yes" | "no" }[];
}

interface ApiEvent {
  event_ticker: string;
  title: string;
  sub_title?: string;
  series_ticker: string;
  product_metadata?: { competition?: string };
  markets?: ApiMarket[];
}

const cents = (dollars?: string) => {
  const n = Number(dollars);
  return Number.isFinite(n) && n > 0 && n < 1 ? Math.round(n * 100) : null;
};

/** Kalshi's settled result for the YES side, or null while the market is open. */
const resultOf = (m: ApiMarket) => (m.result === "yes" || m.result === "no" ? m.result : null);

const SETTLED_STATUSES = new Set(["finalized", "settled", "determined"]);

const dollars = (value?: string) => {
  const n = Number(value);
  return value !== undefined && Number.isFinite(n) ? n : null;
};

/**
 * Which way YES went, from the most authoritative signal available: Kalshi's `result`,
 * then the settlement value, then the price. After a game ends Kalshi stops trading its
 * contracts (status "closed") with the price pinned at 99¢/100¢ (YES won) or 0–1¢ (YES
 * lost) before it publishes the result, so a pinned price on a closed market counts as
 * settled. On a market still trading, 1¢ or 99¢ is just a longshot or a heavy favorite,
 * so it doesn't. A 0¢ last price usually means "never traded", so a loss needs a real 1¢
 * trade or a NO bid of 99¢+.
 */
const yesOutcome = (m: ApiMarket): "yes" | "no" | null => {
  const result = resultOf(m);
  if (result) return result;
  const settlement = dollars(m.settlement_value_dollars);
  if (settlement !== null) return settlement >= 0.99 ? "yes" : settlement <= 0.01 ? "no" : null;
  if (m.status === "active" || m.status === "initialized") return null;
  const last = dollars(m.last_price_dollars) ?? 0;
  if (last >= 0.99 || (dollars(m.yes_bid_dollars) ?? 0) >= 0.99) return "yes";
  if ((last > 0 && last <= 0.01) || (dollars(m.no_bid_dollars) ?? 0) >= 0.99) return "no";
  return null;
};

/** How a leg on `side` settled: WIN/LOSS from the outcome, VOID if settled without one. */
const legResult = (m: ApiMarket, side: "yes" | "no"): LegResult => {
  const outcome = yesOutcome(m);
  if (outcome) return outcome === side ? "WIN" : "LOSS";
  return SETTLED_STATUSES.has(m.status) ? "VOID" : "PENDING";
};

const toOption = (m: ApiMarket): KalshiMarketOption => ({
  ticker: m.ticker,
  title: m.title,
  pick: m.yes_sub_title || m.title,
  yesAsk: cents(m.yes_ask_dollars),
  yesBid: cents(m.yes_bid_dollars),
  noAsk: cents(m.no_ask_dollars),
  lastPrice: cents(m.last_price_dollars),
  active: m.status === "active",
  result: resultOf(m),
});

const get = async <T,>(path: string): Promise<T | null> => {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  return response.ok ? ((await response.json()) as T) : null;
};

/** Per-request caches so a 12-leg combo on 3 games fetches each game once. */
const createClient = () => {
  const markets = new Map<string, Promise<ApiMarket | null>>();
  const events = new Map<string, Promise<ApiEvent | null>>();
  return {
    market: (ticker: string) => {
      if (!markets.has(ticker)) {
        markets.set(ticker, get<{ market: ApiMarket }>(`/markets/${encodeURIComponent(ticker)}`).then((r) => r?.market ?? null));
      }
      return markets.get(ticker)!;
    },
    event: (ticker: string) => {
      if (!events.has(ticker)) {
        events.set(
          ticker,
          get<{ event: ApiEvent; markets?: ApiMarket[] }>(`/events/${encodeURIComponent(ticker)}?with_nested_markets=true`).then(
            (r) => (r ? { ...r.event, markets: r.event.markets ?? r.markets } : null)
          )
        );
      }
      return events.get(ticker)!;
    },
  };
};

const toLeg = (m: ApiMarket, event: ApiEvent | null, side: "yes" | "no"): BetLeg => {
  const name = m.yes_sub_title || m.title;
  const result = legResult(m, side);
  // A settled contract's 99¢/1¢ quote isn't a price anyone bet at; drop it.
  const live = result === "PENDING";
  return {
    sport: detectSport(`${event?.product_metadata?.competition ?? ""} ${event?.title ?? ""} ${m.event_ticker}`),
    matchup: event?.title ?? "",
    market: side === "yes" ? m.title : `NO — ${m.title}`,
    pick: side === "yes" ? name : `Not ${name}`,
    price: !live ? null : side === "yes" ? (cents(m.yes_ask_dollars) ?? cents(m.last_price_dollars)) : cents(m.no_ask_dollars),
    americanOdds: null,
    ticker: m.ticker,
    side,
    result,
  };
};

const toChoice = (event: ApiEvent): KalshiImport => ({
  eventTicker: event.event_ticker,
  title: event.title,
  subtitle: event.sub_title ?? "",
  competition: event.product_metadata?.competition ?? event.series_ticker,
  markets: (event.markets ?? []).map(toOption),
});

/**
 * Resolves pasted Kalshi links (combos, markets, or game pages) into legs. A combo link
 * expands into every leg it bundles, with each leg's chosen side.
 */
export const resolveKalshiLinks = async (input: string, maxLegs: number): Promise<KalshiSlipImport> => {
  const links = splitLinks(input).slice(0, maxLegs);
  const kalshi = createClient();
  const out: KalshiSlipImport = { choices: [], legs: [], comboPrice: null, comboTicker: null, comboResult: null };

  const resolved = await Promise.all(
    links.map(async (link) => {
      for (const ticker of extractTickers(link)) {
        const market = await kalshi.market(ticker);
        if (market?.mve_selected_legs?.length) {
          const legs = await Promise.all(
            market.mve_selected_legs.slice(0, maxLegs).map(async (l) => {
              const [m, e] = await Promise.all([kalshi.market(l.market_ticker), kalshi.event(l.event_ticker)]);
              return m ? toLeg(m, e, l.side) : null;
            })
          );
          return { combo: market, legs: legs.filter((l): l is BetLeg => l !== null), choice: null };
        }
        if (market) return { combo: null, legs: [toLeg(market, await kalshi.event(market.event_ticker), "yes")], choice: null };
        const event = await kalshi.event(ticker);
        if (event) {
          const live = (event.markets ?? []).filter((m) => m.status === "active" || resultOf(m));
          if (live.length === 1) return { combo: null, legs: [toLeg(live[0], event, "yes")], choice: null };
          return { combo: null, legs: [], choice: toChoice(event) };
        }
      }
      return null;
    })
  );

  for (const r of resolved) {
    if (!r) continue;
    if (r.combo) {
      out.comboTicker = r.combo.ticker;
      out.comboResult = yesOutcome(r.combo);
      out.comboPrice = out.comboResult ? null : (cents(r.combo.yes_ask_dollars) ?? cents(r.combo.last_price_dollars));
    }
    out.legs.push(...r.legs);
    if (r.choice) out.choices.push(r.choice);
  }
  out.legs = out.legs.slice(0, maxLegs);
  return out;
};

/* ------------------------------ Soccer scanner ----------------------------- */

/** Kalshi match-winner series for the leagues the scanner covers. */
export const SOCCER_LEAGUES = [
  { series: "KXEPLGAME", name: "Premier League" },
  { series: "KXLALIGAGAME", name: "La Liga" },
  { series: "KXSERIEAGAME", name: "Serie A" },
  { series: "KXBUNDESLIGAGAME", name: "Bundesliga" },
  { series: "KXLIGUE1GAME", name: "Ligue 1" },
  { series: "KXUCLGAME", name: "Champions League" },
  { series: "KXUELGAME", name: "Europa League" },
  { series: "KXMLSGAME", name: "MLS" },
] as const;

export interface SoccerCandidate {
  leg: BetLeg;
  league: string;
  eventTicker: string;
  /** Kalshi's expected settlement time (roughly two hours after kickoff). */
  settlesAt: string;
  volume: number;
}

const HOUR = 60 * 60 * 1000;

/**
 * Open match-winner markets worth researching, with no AI involved: for each upcoming
 * match, the favorite (a team, never the draw) priced 40–85¢ — a real chance to win without
 * being a near-certainty that pays nothing — with a live bid and a tight spread.
 */
export const soccerCandidates = async (): Promise<SoccerCandidate[]> => {
  const now = Date.now();
  const perLeague = await Promise.all(
    SOCCER_LEAGUES.map(async ({ series, name }) => {
      const data = await get<{ events: ApiEvent[] }>(
        `/events?series_ticker=${series}&status=open&with_nested_markets=true&limit=100`
      ).catch(() => null);
      return (data?.events ?? []).flatMap((event): SoccerCandidate[] => {
        const teams = (event.markets ?? []).filter((m) => m.status === "active" && !/^tie\b/i.test(m.yes_sub_title ?? m.title));
        const favorite = teams.sort((a, b) => (cents(b.yes_ask_dollars) ?? 0) - (cents(a.yes_ask_dollars) ?? 0))[0];
        if (!favorite) return [];
        const ask = cents(favorite.yes_ask_dollars);
        const bid = cents(favorite.yes_bid_dollars);
        const settles = Date.parse(favorite.expected_expiration_time ?? "");
        // Not started yet (settlement ~2h after kickoff) and within the next week.
        if (!Number.isFinite(settles) || settles < now + 2.5 * HOUR || settles > now + 7 * 24 * HOUR) return [];
        if (ask === null || bid === null || ask < 40 || ask > 85 || ask - bid > 3) return [];
        const volume = Number(favorite.volume_fp ?? 0);
        return [
          {
            leg: { ...toLeg(favorite, event, "yes"), sport: "Soccer" },
            league: name,
            eventTicker: event.event_ticker,
            settlesAt: new Date(settles).toISOString(),
            volume: Number.isFinite(volume) ? volume : 0,
          },
        ];
      });
    })
  );
  return perLeague.flat();
};
