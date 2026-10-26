import type { NextRequest } from "next/server";

import { extractTickers } from "@/lib/bet/kalshi-link";
import type { KalshiImport, KalshiMarketOption } from "@/types/bet";

export const dynamic = "force-dynamic";

const API = "https://api.elections.kalshi.com/trade-api/v2";

interface ApiMarket {
  ticker: string;
  event_ticker: string;
  title: string;
  yes_sub_title?: string;
  status: string;
  yes_bid_dollars?: string;
  yes_ask_dollars?: string;
  last_price_dollars?: string;
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
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
};

const toOption = (m: ApiMarket): KalshiMarketOption => ({
  ticker: m.ticker,
  title: m.title,
  pick: m.yes_sub_title || m.title,
  yesAsk: cents(m.yes_ask_dollars),
  yesBid: cents(m.yes_bid_dollars),
  lastPrice: cents(m.last_price_dollars),
  active: m.status === "active",
});

const get = async <T,>(path: string): Promise<T | null> => {
  const response = await fetch(`${API}${path}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(8000),
  });
  return response.ok ? ((await response.json()) as T) : null;
};

const fromEvent = (event: ApiEvent, selected: string | null): KalshiImport => ({
  eventTicker: event.event_ticker,
  title: event.title,
  subtitle: event.sub_title ?? "",
  competition: event.product_metadata?.competition ?? event.series_ticker,
  markets: (event.markets ?? []).map(toOption),
  selected,
});

export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("url") ?? "";
  if (!/kalshi/i.test(input) || input.length > 500 || extractTickers(input).length === 0) {
    return Response.json({ error: "Not a Kalshi link" }, { status: 400 });
  }

  try {
    for (const ticker of extractTickers(input)) {
      // A market ticker resolves directly; load its event for the matchup and sibling sides.
      const market = await get<{ market: ApiMarket }>(`/markets/${encodeURIComponent(ticker)}`);
      const eventTicker = market?.market.event_ticker ?? ticker;
      const event = await get<{ event: ApiEvent; markets?: ApiMarket[] }>(
        `/events/${encodeURIComponent(eventTicker)}?with_nested_markets=true`
      );
      if (event) {
        const merged = { ...event.event, markets: event.event.markets ?? event.markets };
        const result: KalshiImport = fromEvent(merged, market?.market.ticker ?? null);
        return Response.json(result);
      }
    }
  } catch {
    return Response.json({ error: "Kalshi didn't respond — try again" }, { status: 502 });
  }
  return Response.json({ error: "Couldn't find a market in that link — open a specific game and copy its link" }, { status: 404 });
}
