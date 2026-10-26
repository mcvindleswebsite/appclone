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
  no_ask_dollars?: string;
  last_price_dollars?: string;
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

/** How a leg on `side` settled: WIN/LOSS from the result, VOID if settled without one. */
const legResult = (m: ApiMarket, side: "yes" | "no"): LegResult => {
  const result = resultOf(m);
  if (result) return result === side ? "WIN" : "LOSS";
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
  return {
    sport: detectSport(`${event?.product_metadata?.competition ?? ""} ${event?.title ?? ""} ${m.event_ticker}`),
    matchup: event?.title ?? "",
    market: side === "yes" ? m.title : `NO — ${m.title}`,
    pick: side === "yes" ? name : `Not ${name}`,
    price: side === "yes" ? (cents(m.yes_ask_dollars) ?? cents(m.last_price_dollars)) : cents(m.no_ask_dollars),
    americanOdds: null,
    ticker: m.ticker,
    side,
    result: legResult(m, side),
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
      out.comboPrice = cents(r.combo.yes_ask_dollars) ?? cents(r.combo.last_price_dollars);
      out.comboResult = resultOf(r.combo);
    }
    out.legs.push(...r.legs);
    if (r.choice) out.choices.push(r.choice);
  }
  out.legs = out.legs.slice(0, maxLegs);
  return out;
};
