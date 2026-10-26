import { MAX_LEGS, type BetLeg, type BetSlip } from "@/types/bet";

const SPORT_KEYWORDS: [string, RegExp][] = [
  ["NFL", /\bnfl\b|pro football|touchdown|chiefs|eagles|cowboys|49ers|bills|ravens|packers/i],
  ["NBA", /\bnba\b|pro basketball|lakers|celtics|warriors|knicks|nuggets|bucks|76ers|thunder/i],
  ["MLB", /\bmlb\b|baseball|yankees|dodgers|mets|astros|braves|innings?/i],
  ["NHL", /\bnhl\b|hockey|bruins|rangers|oilers|maple leafs|panthers|puck/i],
  ["NCAAF", /college football|ncaaf|cfb\b/i],
  ["NCAAB", /college basketball|ncaab|march madness/i],
  [
    "Soccer",
    /soccer|premier league|\bmls\b|champions league|la liga|serie a|bundesliga|\bfc\b|both teams to score|\bbtts\b|arsenal|chelsea|liverpool|man(?:chester)? (?:city|united|utd)|tottenham|newcastle|aston villa|real madrid|barcelona|atletico|bayern|dortmund|juventus|inter milan|ac milan|\bpsg\b/i,
  ],
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

/** A probability or price on its own: "46%", "46¢", "+120". */
const PERCENT = /(\d{1,2}(?:\.\d)?)\s?%/;
const QUOTE_ONLY = /^(?:\d{1,2}(?:\.\d)?\s?%|\d{1,2}\s?(?:¢|c|€)|[+-]\d{3,4})(?:\s*chance)?$/i;

/**
 * Slip chrome inside a block that isn't a pick: side labels, times, money, and headers.
 * Deliberately doesn't catch "to win" on its own, which is a pick ("Lakers to win").
 */
const BLOCK_NOISE =
  /^(?:yes|no|buy|sell|pick|picks|leg \d+|\d+ legs?|live|final|today|tomorrow|tonight|(?:mon|tue|wed|thu|fri|sat|sun)\w*|q[1-4]|\d{1,2}:\d{2}\s?(?:am|pm)?.*|(?:pro|college) (?:football|basketball)|nfl|nba|mlb|nhl|ncaaf|ncaab|soccer|ufc|tennis|golf)$|\$\s?\d|^(?:parlay|combo|wager|stake|payout|potential|cost|total odds|place bet|cash ?out|bet slip|same game|sgp)\b|\bchance\b/i;

/** Price in cents from a line: Kalshi's ¢ price, or its % chance (46% trades at 46¢). */
const centsIn = (line: string) => {
  const cents = line.match(new RegExp(CENTS, "i"));
  if (cents) return Number(cents[1]);
  const percent = line.match(PERCENT);
  return percent ? Math.min(99, Math.max(1, Math.round(Number(percent[1])))) : null;
};

const stripQuotes = (line: string) =>
  clean(line.replace(ODDS, " ").replace(new RegExp(CENTS, "gi"), " ").replace(new RegExp(PERCENT.source, "g"), " "));

/** "Lakers vs Celtics · 7:30 PM" → "Lakers vs Celtics", if the line is a matchup header. */
const matchupHeader = (line: string) => {
  const game = line.match(MATCHUP);
  if (!game) return null;
  // A line like "LeBron James 25+ points vs Celtics" is a pick, not a header.
  if (LEG_LINE.test(line.replace(game[0], "")) || /\d+(?:\.\d)?\+/.test(game[0])) return null;
  return `${clean(game[1])} vs ${clean(game[2])}`;
};

/** Leading words that aren't who the pick is on ("Both teams to score", "Over 47.5"). */
const GENERIC_PICK = /^(?:both|draw|over|under|total|yes|no|either|neither|any|first|last)$/i;

const makeLeg = (line: string, matchup: string): BetLeg => {
  const market = stripQuotes(line);
  const odds = line.match(ODDS);
  const pick = pickFrom(market);
  return {
    sport: detectSport(`${market} ${matchup}`),
    matchup,
    market,
    pick: pick && !GENERIC_PICK.test(pick) ? pick : market,
    price: centsIn(line),
    americanOdds: odds ? Number(odds[1]) : null,
  };
};

/**
 * Pulls a slip out of OCR text from a Kalshi market, a Kalshi combo, or a sportsbook
 * parlay screenshot: up to 12 legs plus the combo price or parlay odds. Anything it can't
 * find is left empty for the manual form.
 *
 * Kalshi combos stack one block per game, top to bottom:
 *   Lakers vs Celtics        ← matchup header
 *   Lakers to win            ← pick (or "Over 47.5 points", "LeBron 25+ points")
 *   46%                      ← chance, which is the price in cents
 * Every block is read, and a block with several picks (a same-game parlay) yields a leg
 * per pick. Lines before the first header still count as legs when they read like
 * selections, which covers sportsbook slips that list legs without game headers.
 */
export const parseSlipText = (raw: string): BetSlip => {
  const text = raw.replace(/[−–—]/g, "-");
  const lines = text.split(/\n+/).map(clean).filter(Boolean);
  const sport = detectSport(text);

  const legs: BetLeg[] = [];
  let matchup = "";
  let inBlock = false;
  let pricedLast = true;
  for (const line of lines) {
    if (legs.length >= MAX_LEGS) break;
    const header = matchupHeader(line);
    if (header) {
      matchup = header;
      inBlock = true;
      continue;
    }

    // A quote on its own line belongs to the pick just above it.
    if (QUOTE_ONLY.test(line)) {
      const last = legs.at(-1);
      if (last && !pricedLast) {
        const odds = line.match(ODDS);
        if (odds) last.americanOdds = Number(odds[1]);
        else last.price = centsIn(line);
        pricedLast = true;
      }
      continue;
    }

    const isPick = inBlock
      ? !BLOCK_NOISE.test(line) && /[A-Za-z]{2}/.test(line)
      : LEG_LINE.test(line) && !NOT_LEG.test(line);
    if (!isPick || line.length < 3) continue;

    const leg = makeLeg(line, matchup);
    legs.push(leg);
    pricedLast = leg.price !== null || leg.americanOdds !== null;
  }

  // A leg with no sport cue of its own takes the slip's sport only when every leg that
  // has a cue agrees; a mixed slip leaves it as Other rather than guessing.
  const cued = new Set(legs.map((l) => l.sport).filter((s) => s !== "Other"));
  const fallback = cued.size === 1 ? [...cued][0] : cued.size === 0 ? sport : "Other";
  for (const leg of legs) if (leg.sport === "Other") leg.sport = fallback;

  const comboOddsLine = lines.find((l) => /\b(parlay|combo|total odds|sgp|odds)\b/i.test(l) && ODDS.test(l));
  const comboOdds = comboOddsLine ? Number(comboOddsLine.match(ODDS)![1]) : null;

  if (legs.length === 0) {
    return { legs: [singleLeg(text, lines)], comboPrice: null, comboOdds: null };
  }
  if (legs.length === 1) return { legs, comboPrice: null, comboOdds: null };

  // The combo's own price: a "Yes 8¢" / "Cost 8¢" quote, or its "12% chance" header.
  const cents = text.match(new RegExp(String.raw`(?:\byes\b|price|cost)[^\d\n]{0,12}${CENTS}`, "i"));
  const chance = lines.find((l) => /\bchance\b/i.test(l) && PERCENT.test(l));
  const comboPrice = cents ? Number(cents[1]) : chance ? centsIn(chance) : null;
  return { legs, comboPrice, comboOdds };
};
