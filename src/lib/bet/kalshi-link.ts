/** True for kalshi.com web links and Kalshi app deep links. */
export const isKalshiLink = (text: string) =>
  /^\s*(?:(?:https?:\/\/)?(?:[\w-]+\.)*kalshi\.com\/|kalshi:\/\/)\S+\s*$/i.test(text) && extractTickers(text).length > 0;

/**
 * Pulls ticker-shaped tokens (e.g. kxnflgame-26oct26dalphi) out of a Kalshi URL or deep
 * link, last path segment first.
 */
export const extractTickers = (input: string) => {
  const tokens = input.match(/[A-Za-z0-9]+(?:-[A-Za-z0-9.]+)+/g) ?? [];
  const tickers = tokens
    .map((t) => t.toUpperCase())
    .filter((t) => /^[A-Z0-9]+-[A-Z0-9.-]+$/.test(t) && /\d/.test(t));
  return [...new Set(tickers.reverse())].slice(0, 3);
};
