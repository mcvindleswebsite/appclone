import { extractTickers, splitLinks } from "@/lib/bet/kalshi-link";
import { detectSport } from "@/lib/bet/parse-slip";
import { estimateTiming, type LegTiming } from "@/lib/bet/timing";
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

const get = async <T,>(path: string, retries = 1): Promise<T | null> => {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  // Kalshi throttles bursts (a big combo fans out into many reads); back off once and retry.
  if (response.status === 429 && retries > 0) {
    await new Promise((resolve) => setTimeout(resolve, 600));
    return get<T>(path, retries - 1);
  }
  return response.ok ? ((await response.json()) as T) : null;
};

/** Runs `fn` over `items` with at most `limit` in flight, keeping Kalshi under its rate limit. */
const mapLimit = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> => {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
};

/** Per-request caches so a 12-leg combo on 3 games fetches each game once. */
const createClient = () => {
  const markets = new Map<string, Promise<ApiMarket | null>>();
  const events = new Map<string, Promise<ApiEvent | null>>();
  const starts = new Map<string, Promise<string | null>>();
  return {
    /** The game's real start time from Kalshi's milestones (null for non-game markets). */
    start: (eventTicker: string) => {
      if (!starts.has(eventTicker)) {
        starts.set(
          eventTicker,
          get<{ milestones?: { start_date?: string }[] }>(
            `/milestones?related_event_ticker=${encodeURIComponent(eventTicker)}&limit=1`
          )
            .then((r) => r?.milestones?.[0]?.start_date ?? null)
            .catch(() => null)
        );
      }
      return starts.get(eventTicker)!;
    },
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

const toLeg = (m: ApiMarket, event: ApiEvent | null, side: "yes" | "no", start: string | null = null): BetLeg => {
  const name = m.yes_sub_title || m.title;
  const result = legResult(m, side);
  const timing = estimateTiming(m.ticker, start, m.expected_expiration_time);
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
    ...(timing ?? {}),
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
              const [m, e, start] = await Promise.all([
                kalshi.market(l.market_ticker),
                kalshi.event(l.event_ticker),
                kalshi.start(l.event_ticker),
              ]);
              return m ? toLeg(m, e, l.side, start) : null;
            })
          );
          return { combo: market, legs: legs.filter((l): l is BetLeg => l !== null), choice: null };
        }
        if (market) {
          const [event, start] = await Promise.all([kalshi.event(market.event_ticker), kalshi.start(market.event_ticker)]);
          return { combo: null, legs: [toLeg(market, event, "yes", start)], choice: null };
        }
        const event = await kalshi.event(ticker);
        if (event) {
          const live = (event.markets ?? []).filter((m) => m.status === "active" || resultOf(m));
          if (live.length === 1) {
            return { combo: null, legs: [toLeg(live[0], event, "yes", await kalshi.start(event.event_ticker))], choice: null };
          }
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

/**
 * Fresh game timing for vault tickers: each market's start and estimated finish, and for a
 * combo the span of all its legs (its finish is the last leg's). Unknown tickers are skipped.
 */
export const resolveTimings = async (tickers: string[]): Promise<Record<string, LegTiming>> => {
  const kalshi = createClient();
  const out: Record<string, LegTiming> = {};
  const marketTiming = async (m: ApiMarket) => {
    const timing = estimateTiming(m.ticker, await kalshi.start(m.event_ticker), m.expected_expiration_time);
    if (timing) out[m.ticker] = timing;
    return timing;
  };
  const safeMarket = (ticker: string) => kalshi.market(ticker).catch(() => null);

  await mapLimit(tickers, 4, async (ticker) => {
    const market = await safeMarket(ticker);
    if (!market) return;
    if (!market.mve_selected_legs?.length) {
      await marketTiming(market);
      return;
    }
    const legs = await mapLimit(market.mve_selected_legs, 4, async (l) => {
      const m = await safeMarket(l.market_ticker);
      return m ? marketTiming(m) : null;
    });
    const known = legs.filter((t): t is LegTiming => t !== null);
    if (known.length) {
      out[ticker] = {
        startsAt: new Date(Math.min(...known.map((t) => Date.parse(t.startsAt)))).toISOString(),
        endsAt: new Date(Math.max(...known.map((t) => Date.parse(t.endsAt)))).toISOString(),
      };
    }
  });
  return out;
};

interface Candle {
  end_period_ts: number;
  price?: { close_dollars?: string };
  yes_bid?: { close_dollars?: string };
  yes_ask?: { close_dollars?: string };
}

export interface ClosingLine {
  /** "closed": the game started and a price was found; "upcoming": not started yet; "none": no data. */
  status: "closed" | "upcoming" | "none";
  /** Fair YES price in cents at the start (bid/ask midpoint, else last trade), one decimal. */
  yes: number | null;
  startsAt: string | null;
}

/** Fair price from one candle: the bid/ask midpoint when both sides quote, else the last trade. */
const candleFair = (c: Candle) => {
  const bid = dollars(c.yes_bid?.close_dollars);
  const ask = dollars(c.yes_ask?.close_dollars);
  if (bid !== null && ask !== null && bid > 0 && ask > 0 && ask >= bid) return (bid + ask) / 2;
  const last = dollars(c.price?.close_dollars);
  return last !== null && last > 0 ? last : null;
};

/**
 * Closing lines for CLV: each market's fair YES price at the minute its game started, read
 * from Kalshi's public candlestick history (no AI). Markets without a game start (no
 * milestone) or without trading before it come back "none".
 */
export const resolveClosingLines = async (tickers: string[]): Promise<Record<string, ClosingLine>> => {
  const kalshi = createClient();
  const out: Record<string, ClosingLine> = {};
  const now = Date.now();

  await mapLimit(tickers, 4, async (ticker) => {
    const market = await kalshi.market(ticker).catch(() => null);
    if (!market) {
      out[ticker] = { status: "none", yes: null, startsAt: null };
      return;
    }
    const [event, start] = await Promise.all([
      kalshi.event(market.event_ticker).catch(() => null),
      kalshi.start(market.event_ticker),
    ]);
    const startMs = Date.parse(start ?? "");
    if (!Number.isFinite(startMs)) {
      out[ticker] = { status: "none", yes: null, startsAt: null };
      return;
    }
    if (startMs > now) {
      out[ticker] = { status: "upcoming", yes: null, startsAt: start };
      return;
    }
    const series = event?.series_ticker ?? ticker.split("-")[0];
    const startTs = Math.floor(startMs / 1000);
    // Minute candles for the half hour before kickoff, then hourly over the prior day.
    for (const [from, interval] of [
      [startTs - 1800, 1],
      [startTs - 86_400, 60],
    ] as const) {
      const data = await get<{ candlesticks?: Candle[] }>(
        `/series/${encodeURIComponent(series)}/markets/${encodeURIComponent(ticker)}/candlesticks?start_ts=${from}&end_ts=${startTs + 60}&period_interval=${interval}`
      ).catch(() => null);
      const before = (data?.candlesticks ?? []).filter((c) => c.end_period_ts <= startTs + 60);
      for (let i = before.length - 1; i >= 0; i--) {
        const fair = candleFair(before[i]);
        if (fair !== null) {
          out[ticker] = { status: "closed", yes: Math.round(fair * 1000) / 10, startsAt: start };
          return;
        }
      }
    }
    out[ticker] = { status: "none", yes: null, startsAt: start };
  });
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
