import { MAX_LEGS, type BetLeg, type BetSlip } from "@/types/bet";

const SPORT_KEYWORDS: [string, RegExp][] = [
  ["NFL", /\bnfl\b|pro football|touchdown|chiefs|eagles|cowboys|49ers|bills|ravens|packers/i],
  ["NBA", /\bnba\b|pro basketball|lakers|celtics|warriors|knicks|nuggets|bucks|76ers|thunder/i],
  ["MLB", /\bmlb\b|baseball|yankees|dodgers|mets|astros|braves|innings?/i],
  ["NHL", /\bnhl\b|hockey|bruins|rangers|oilers|maple leafs|panthers|puck/i],
  ["NCAAF", /college football|ncaaf|cfb\b/i],
  ["NCAAB", /college basketball|ncaab|march madness/i],
  ["Soccer", /soccer|premier league|\bmls\b|champions league|la liga|\bfc\b/i],
  ["UFC", /\bufc\b|\bmma\b|fight night|knockout/i],
  ["Tennis", /tennis|\batp\b|\bwta\b|grand slam/i],
  ["Golf", /\bpga\b|golf|masters/i],
];

export const SPORTS = [...SPORT_KEYWORDS.map(([sport]) => sport), "Other"];

export const detectSport = (text: string) => SPORT_KEYWORDS.find(([, re]) => re.test(text))?.[0] ?? "Other";

export const emptyLeg = (sport = "NFL"): BetLeg => ({
  sport,
  matchup: "",
  market: "",
  pick: "",
  price: null,
  americanOdds: null,
});

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/^[^A-Za-z0-9+-]+|[^A-Za-z0-9.?)%+]+$/g, "").trim();

/** OCR reads ¢ as c, €, or ¢ glued to the digits; accept all of them. */
const CENTS = String.raw`(\d{1,2})\s?(?:¢|c\b|€|cents?)`;
const ODDS = /(?:^|[\s(])([+-]\d{3,4})(?![\d.])/;
const MATCHUP = /([A-Z][A-Za-z.' ]{1,28}?)\s+(?:vs\.?|v\.?|@|at)\s+([A-Z][A-Za-z.' ]{1,28}?)(?=\s*(?:$|[-|·•?(]|\d))/;

/** A line that reads like a selection: a stat, a line, or a team result. */
const LEG_LINE =
  /\b(points?|pts|rebounds?|reb|assists?|ast|pra|threes|3pt|3-pointers|yards?|yds|touchdowns?|td|receptions?|rec|hits?|strikeouts?|ks|home runs?|hr|rbis?|goals?|shots?|saves|wins?|winner|moneyline|ml|spread|over|under|total|anytime)\b|\d+(?:\.\d)?\+|[+-]\d{1,2}\.5\b|\b[ou]\s?\d+(?:\.\d)?\b/i;
/** Slip chrome that matches LEG_LINE's words but isn't a leg. */
const NOT_LEG = /\b(parlay|combo|total odds|wager|stake|payout|to win|bet slip|potential|place bet|cash ?out|same game|sgp|legs?)\b/i;

/** Picks out "Kevin Durant" from "Kevin Durant Over 24.5 Points" or "Dallas: wins by 3+". */
const pickFrom = (line: string) => {
  const beforeColon = line.split(/[:|·•]/)[0];
  if (beforeColon !== line && beforeColon.length > 2) return clean(beforeColon);
  const name = line.match(/^((?:[A-Z][A-Za-z.'-]+\s?){1,3})/);
  return name ? clean(name[1].replace(/\b(Over|Under|To|Wins?|Yes|No|Moneyline|ML|Spread|Total)\b.*$/, "")) : "";
};

const singleLeg = (text: string, lines: string[]): BetLeg => {
  const leg = emptyLeg(detectSport(text));
  const yes =
    text.match(new RegExp(String.raw`\byes\b[^\d\n]{0,12}${CENTS}`, "i")) ??
    text.match(new RegExp(String.raw`(?:avg\.?\s*price|price|cost)[^\d\n]{0,8}${CENTS}`, "i"));
  const no = text.match(new RegExp(String.raw`\bno\b[^\d\n]{0,12}${CENTS}`, "i"));
  const anyCents = text.match(new RegExp(CENTS, "i"));
  if (yes) leg.price = Number(yes[1]);
  else if (no) leg.price = 100 - Number(no[1]);
  else if (anyCents) leg.price = Number(anyCents[1]);

  const odds = text.match(new RegExp(ODDS.source, "m"));
  if (odds) leg.americanOdds = Number(odds[1]);
  const matchup = text.match(new RegExp(MATCHUP.source, "m"));
  if (matchup) leg.matchup = `${clean(matchup[1])} vs ${clean(matchup[2])}`;

  leg.market =
    lines.find((line) => line.endsWith("?") && line.length > 8) ??
    lines.find((line) => /^will\b/i.test(line)) ??
    lines.find((line) => LEG_LINE.test(line) && line.length > 8) ??
    "";
  const pick =
    text.match(/\b(?:buy|bought)\s+yes\s*[·•:\-|]?\s*([A-Z][A-Za-z.' ]{2,28})/) ??
    text.match(/\byes\s*[·•:\-|]\s*([A-Z][A-Za-z.' ]{2,28})/);
  leg.pick = pick ? clean(pick[1]) : matchup ? clean(matchup[1]) : pickFrom(leg.market);
  return leg;
};

/**
 * Pulls a slip out of OCR text from a Kalshi market, a Kalshi combo, or a sportsbook
 * parlay screenshot: up to 12 legs plus the combo price or parlay odds. Anything it can't
 * find is left empty for the manual form.
 */
export const parseSlipText = (raw: string): BetSlip => {
  const text = raw.replace(/[−–—]/g, "-");
  const lines = text.split(/\n+/).map(clean).filter(Boolean);
  const sport = detectSport(text);

  const legs: BetLeg[] = [];
  let matchup = "";
  for (let i = 0; i < lines.length && legs.length < MAX_LEGS; i++) {
    const line = lines[i];
    const game = line.match(MATCHUP);
    if (game && !LEG_LINE.test(line.replace(game[0], ""))) {
      matchup = `${clean(game[1])} vs ${clean(game[2])}`;
      continue;
    }
    if (!LEG_LINE.test(line) || NOT_LEG.test(line) || line.length < 5) continue;

    // Odds or a price often sit on the leg's own line or the line right after it.
    const next = lines[i + 1] ?? "";
    const nextIsQuote = /^([+-]\d{3,4}|\d{1,2}\s?(?:¢|c|€))$/i.test(next);
    const quoteText = `${line} ${nextIsQuote ? next : ""}`;
    const odds = quoteText.match(ODDS);
    const price = quoteText.match(new RegExp(CENTS, "i"));
    const market = clean(line.replace(ODDS, " ").replace(new RegExp(CENTS, "i"), " "));
    legs.push({
      sport: detectSport(`${market} ${matchup}`) === "Other" ? sport : detectSport(`${market} ${matchup}`),
      matchup,
      market,
      pick: pickFrom(market),
      price: price ? Number(price[1]) : null,
      americanOdds: odds ? Number(odds[1]) : null,
    });
    if (nextIsQuote) i++;
  }

  const comboOddsLine = lines.find((l) => /\b(parlay|combo|total odds|sgp|odds)\b/i.test(l) && ODDS.test(l));
  const comboOdds = comboOddsLine ? Number(comboOddsLine.match(ODDS)![1]) : null;

  if (legs.length <= 1) {
    return { legs: [singleLeg(text, lines)], comboPrice: null, comboOdds: null };
  }
  const comboPrice = text.match(new RegExp(String.raw`(?:\byes\b|price|cost)[^\d\n]{0,12}${CENTS}`, "i"));
  return { legs, comboPrice: comboPrice ? Number(comboPrice[1]) : null, comboOdds };
};
