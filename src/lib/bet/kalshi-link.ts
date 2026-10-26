import { detectSport } from "@/lib/bet/parse-slip";
import type { BetLeg, KalshiImport, KalshiMarketOption, KalshiSlipImport, Outcome, VaultSettlement } from "@/types/bet";

const LINK = /(?:(?:https?:\/\/)?(?:[\w-]+\.)*kalshi\.com\/|kalshi:\/\/)\S+/gi;

/** Every Kalshi web link or app deep link in a blob of text (one per line, or space-separated). */
export const splitLinks = (text: string) => (text.match(LINK) ?? []).filter((link) => extractTickers(link).length > 0);

/** True when the text is nothing but one or more Kalshi links. */
export const isKalshiLink = (text: string) => {
  const links = splitLinks(text);
  return links.length > 0 && text.replace(LINK, "").trim().length === 0;
};

/**
 * Pulls ticker-shaped tokens (e.g. kxnflgame-26oct26dalphi) out of one Kalshi URL or deep
 * link, last path segment first.
 */
export const extractTickers = (input: string) => {
  const tokens = input.match(/[A-Za-z0-9]+(?:-[A-Za-z0-9.]+)+/g) ?? [];
  const tickers = tokens
    .map((t) => t.toUpperCase())
    .filter((t) => /^[A-Z0-9]+-[A-Z0-9.-]+$/.test(t) && /\d/.test(t));
  return [...new Set(tickers.reverse())].slice(0, 3);
};

/** Resolves pasted Kalshi links into legs through /api/bet/kalshi; throws a readable Error. */
export const importKalshi = async (text: string): Promise<KalshiSlipImport> => {
  const response = await fetch(`/api/bet/kalshi?url=${encodeURIComponent(text)}`);
  const data = (await response.json().catch(() => ({ error: "Bad response" }))) as KalshiSlipImport | { error: string };
  if ("error" in data) throw new Error(data.error);
  return data;
};

/** A leg from one side of an event the user picked by hand. */
export const legFromOption = (event: KalshiImport, market: KalshiMarketOption): BetLeg => ({
  sport: detectSport(`${event.competition} ${event.title} ${event.eventTicker}`),
  matchup: event.title,
  market: market.title,
  pick: market.pick,
  price: market.yesAsk ?? market.lastPrice ?? market.yesBid,
  americanOdds: null,
  ticker: market.ticker,
  side: "yes",
});

/**
 * Settles a slip from its legs' results: a lost leg loses the parlay straight away, every
 * counted leg winning wins it, and VOID legs drop out. A Kalshi combo's own result wins
 * when it has one.
 */
export const settleLegs = (legs: BetLeg[], comboResult: "yes" | "no" | null = null) => {
  const counted = legs.filter((l) => l.result !== "VOID");
  const hit = counted.filter((l) => l.result === "WIN").length;
  const settled = counted.filter((l) => l.result === "WIN" || l.result === "LOSS").length;
  let outcome: Outcome = "PENDING";
  if (comboResult) outcome = comboResult === "yes" ? "WIN" : "LOSS";
  else if (counted.some((l) => l.result === "LOSS")) outcome = "LOSS";
  else if (counted.length > 0 && hit === counted.length) outcome = "WIN";
  return { outcome, legsHit: hit, legsSettled: settled, legsTotal: counted.length };
};

/** Zero-token settlement lookup through /api/vault/parse-link; throws a readable Error. */
export const settleKalshi = async (links: string): Promise<VaultSettlement> => {
  const response = await fetch("/api/vault/parse-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ links }),
  });
  const data = (await response.json().catch(() => ({ error: "Bad response" }))) as VaultSettlement | { error: string };
  if ("error" in data) throw new Error(data.error);
  return data;
};

/** A link Kalshi's API resolves for a bare ticker, used to re-check settlement. */
export const tickerLink = (ticker: string) => `https://kalshi.com/markets/${ticker.toLowerCase()}`;
