import type { BetSlip } from "@/types/bet";

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

const clean = (s: string) => s.replace(/\s+/g, " ").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9.?)]+$/g, "").trim();

/** OCR reads ¢ as c, €, or ¢ glued to the digits; accept all of them. */
const CENTS = String.raw`(\d{1,2})\s?(?:¢|c\b|€|cents?)`;

/**
 * Pulls slip fields out of OCR text from a Kalshi market or order screenshot.
 * Anything it can't find is left empty for the manual form.
 */
export const parseSlipText = (raw: string): Partial<BetSlip> => {
  const text = raw.replace(/[−–—]/g, "-");
  const lines = text.split(/\n+/).map(clean).filter(Boolean);
  const out: Partial<BetSlip> = {};

  const yes =
    text.match(new RegExp(String.raw`\byes\b[^\d\n]{0,12}${CENTS}`, "i")) ??
    text.match(new RegExp(String.raw`(?:avg\.?\s*price|price|cost)[^\d\n]{0,8}${CENTS}`, "i"));
  const no = text.match(new RegExp(String.raw`\bno\b[^\d\n]{0,12}${CENTS}`, "i"));
  const anyCents = text.match(new RegExp(CENTS, "i"));
  if (yes) out.yesPrice = Number(yes[1]);
  else if (no) out.yesPrice = 100 - Number(no[1]);
  else if (anyCents) out.yesPrice = Number(anyCents[1]);

  const odds = text.match(/(?:^|[\s(])([+-]\d{3,4})(?![\d.])/m);
  if (odds) out.americanOdds = Number(odds[1]);

  const matchup = text.match(
    /([A-Z][A-Za-z.' ]{1,28}?)\s+(?:vs\.?|v\.?|@|at)\s+([A-Z][A-Za-z.' ]{1,28}?)(?=\s*(?:\n|$|[-|·•?(]|\d))/m
  );
  if (matchup) out.matchup = `${clean(matchup[1])} vs ${clean(matchup[2])}`;

  const title =
    lines.find((line) => line.endsWith("?") && line.length > 8) ??
    lines.find((line) => /^will\b/i.test(line)) ??
    lines.find((line) => /\b(win|winner|over|under|spread|total|points|parlay)\b/i.test(line) && line.length > 8);
  if (title) out.marketTitle = title;

  const pick =
    text.match(/\b(?:buy|bought)\s+yes\s*[·•:\-|]?\s*([A-Z][A-Za-z.' ]{2,28})/) ??
    text.match(/\byes\s*[·•:\-|]\s*([A-Z][A-Za-z.' ]{2,28})/);
  if (pick) out.pick = clean(pick[1]);
  else if (matchup) out.pick = clean(matchup[1]);

  out.sport = detectSport(text);
  return out;
};
