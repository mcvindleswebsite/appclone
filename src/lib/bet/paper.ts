import { kalshiDecimal } from "@/lib/bet/engine";
import { resolveKalshiLinks } from "@/lib/bet/kalshi-api";
import { tickerLink } from "@/lib/bet/kalshi-link";
import { formatMoney } from "@/lib/bet/pnl";
import { buildParlay, PAYOUT_TARGETS } from "@/lib/bet/parlay-builder";
import { loadProfile } from "@/lib/bet/profile";
import { scan } from "@/lib/bet/scan";
import { SCAN_LEAGUES } from "@/lib/bet/scan-scope";
import { redis } from "@/lib/bet/store";
import { trackPicks } from "@/lib/bet/track";
import type { PaperCalibration, PaperLeg, PaperParlay, PaperSummary, RecommendedLeg } from "@/types/bet";

/**
 * The paper bankroll: once a day it bets fake money on the parlays the AI Picks scan expects
 * to profit, and settles them from Kalshi. Stakes are a share of the current balance, so wins
 * and losses compound. It learns by calibration (no AI): settled legs show how often the AI's
 * probabilities actually hit, and later parlays are judged on the corrected numbers.
 */

export const PAPER_KEY = "vindle_paper_bankroll";
export const PAPER_START = 300;
/** Share of the balance staked each day, split across that day's parlays. */
export const DAILY_STAKE = 0.1;
/** A parlay needs this much expected profit per $1, after calibration, to be bet. */
const MIN_EV = 0.05;
const MIN_STAKE = 0.5;
/**
 * Calibration prior, in expected hits (about 20 legs' worth): until the paper record outweighs
 * it, the AI's own probabilities mostly stand, so one lucky or unlucky day can't steer it.
 */
const PRIOR_HITS = 12;
const FACTOR_MIN = 0.6;
const FACTOR_MAX = 1.15;
const MAX_PROBABILITY = 0.97;
/** Kalshi needs a little time after the final whistle to settle. */
const SETTLE_AFTER_MS = 2.5 * 60 * 60 * 1000;
const MAX_SETTLE_TICKERS = 60;
const DAY = 24 * 60 * 60 * 1000;
const SHOWN_PARLAYS = 40;

interface PaperStore {
  start: number;
  startedAt: number;
  cash: number;
  lastRun: string | null;
  lastNote: string | null;
  parlays: PaperParlay[];
}

const cents = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/** The stored bankroll; undefined when it hasn't started, null when Upstash isn't configured. */
const readPaper = async (): Promise<PaperStore | null | undefined> => {
  const reply = await redis(["GET", PAPER_KEY]);
  if (!reply) return null;
  return typeof reply.result === "string" ? (JSON.parse(reply.result) as PaperStore) : undefined;
};

const writePaper = (store: PaperStore) => redis(["SET", PAPER_KEY, JSON.stringify(store)]);

const pendingStake = (store: PaperStore) => store.parlays.filter((p) => p.outcome === "PENDING").reduce((s, p) => s + p.stake, 0);

/** Learned from every settled paper leg, counted once even when it rode on several parlays. */
export const calibrate = (parlays: PaperParlay[]): PaperCalibration => {
  const legs = new Map<string, PaperLeg>();
  for (const p of parlays) for (const l of p.legs) if (l.result === "WIN" || l.result === "LOSS") legs.set(l.ticker, l);
  const settled = [...legs.values()];
  const hit = settled.filter((l) => l.result === "WIN").length;
  const expected = settled.reduce((s, l) => s + l.probability, 0);
  const overall = clamp((hit + PRIOR_HITS) / (expected + PRIOR_HITS), FACTOR_MIN, FACTOR_MAX);
  const leagues = [...new Set(settled.map((l) => l.league))];
  const byLeague = leagues.map((league) => {
    const of = settled.filter((l) => l.league === league);
    const leagueHit = of.filter((l) => l.result === "WIN").length;
    const leagueExpected = of.reduce((s, l) => s + l.probability, 0);
    // A league with few legs leans on the overall factor.
    const factor = clamp((leagueHit + PRIOR_HITS * overall) / (leagueExpected + PRIOR_HITS), FACTOR_MIN, FACTOR_MAX);
    return { league, factor, legs: of.length };
  });
  return { overall, byLeague: byLeague.sort((a, b) => b.legs - a.legs), legs: settled.length, hit, expected };
};

const factorOf = (c: PaperCalibration, league: string) => c.byLeague.find((l) => l.league === league)?.factor ?? c.overall;

/** Grades pending parlays from Kalshi: a lost leg sinks it, cancelled legs drop out. Returns how many settled. */
const settlePaper = async (store: PaperStore, now: number) => {
  const pending = store.parlays.filter((p) => p.outcome === "PENDING");
  const due = [
    ...new Set(
      pending.flatMap((p) =>
        p.legs.filter((l) => (!l.result || l.result === "PENDING") && Date.parse(l.kickoffTime) + SETTLE_AFTER_MS < now).map((l) => l.ticker)
      )
    ),
  ].slice(0, MAX_SETTLE_TICKERS);
  if (!due.length) return 0;

  const data = await resolveKalshiLinks(due.map(tickerLink).join("\n"), due.length);
  const results = new Map(data.legs.flatMap((l) => (l.ticker && l.result ? [[l.ticker, l.result] as const] : [])));
  let settled = 0;
  for (const p of pending) {
    p.legs = p.legs.map((l) => {
      const result = results.get(l.ticker);
      return result && result !== "PENDING" ? { ...l, result } : l;
    });
    const states = p.legs.map((l) => l.result ?? "PENDING");
    if (states.includes("LOSS")) {
      Object.assign(p, { outcome: "LOSS", payout: 0, settledAt: now });
    } else if (states.every((r) => r === "WIN" || r === "VOID")) {
      const won = p.legs.filter((l) => l.result === "WIN");
      const payout = won.length ? cents(p.stake * won.reduce((d, l) => d * kalshiDecimal(l.price), 1)) : p.stake;
      Object.assign(p, { outcome: won.length ? "WIN" : "VOID", payout, settledAt: now });
    } else {
      continue;
    }
    store.cash = cents(store.cash + (p.payout ?? 0));
    settled++;
  }
  return settled;
};

const toPaperLeg = (l: RecommendedLeg, raw: Map<string, number>): PaperLeg => ({
  ticker: l.leg.ticker!,
  matchup: l.matchName,
  pick: l.pick,
  league: l.league,
  kickoffTime: l.kickoffTime,
  price: l.leg.price!,
  probability: raw.get(l.leg.ticker!) ?? l.modelProbability,
});

/**
 * Today's bets: the Money Parlay builder at each payout target, on calibrated probabilities,
 * keeping the distinct parlays with real expected profit. The day's stake is split by Kelly
 * weight, so the better bets get more.
 */
const placeBets = (store: PaperStore, legs: RecommendedLeg[], calibration: PaperCalibration, day: string, now: number) => {
  const usable = legs.filter((l) => !l.futures && !l.vetoed && l.leg.ticker && l.leg.price !== null);
  const raw = new Map(usable.map((l) => [l.leg.ticker!, l.modelProbability]));
  const pool = usable.map((l) => ({ ...l, modelProbability: Math.min(MAX_PROBABILITY, l.modelProbability * factorOf(calibration, l.league)) }));

  const seen = new Set<string>();
  const picked: { legs: RecommendedLeg[]; decimal: number; probability: number; weight: number }[] = [];
  for (const target of PAYOUT_TARGETS) {
    const built = buildParlay(pool, target);
    if (!built?.reached) continue;
    const key = built.legs.map((l) => l.leg.ticker).sort().join(",");
    const ev = built.probability * built.decimal - 1;
    if (seen.has(key) || ev < MIN_EV) continue;
    seen.add(key);
    picked.push({ ...built, weight: ev / (built.decimal - 1) });
  }
  if (!picked.length) return { placed: 0, staked: 0 };

  const budget = Math.min(store.cash, cents((store.cash + pendingStake(store)) * DAILY_STAKE));
  const totalWeight = picked.reduce((s, p) => s + p.weight, 0);
  let staked = 0;
  for (const [i, p] of picked.entries()) {
    const stake = cents((budget * p.weight) / totalWeight);
    if (stake < MIN_STAKE) continue;
    store.parlays.push({
      id: `${day}-${i}`,
      day,
      placedAt: now,
      legs: p.legs.map((l) => toPaperLeg(l, raw)),
      decimal: p.decimal,
      probability: p.probability,
      stake,
      outcome: "PENDING",
      payout: null,
    });
    staked += stake;
  }
  store.cash = cents(store.cash - staked);
  return { placed: store.parlays.filter((p) => p.day === day).length, staked: cents(staked) };
};

/**
 * The daily run: settles what finished, then (once per UTC day) scans every league for the
 * next 24 hours and bets today's parlays. Null when Upstash isn't configured.
 */
export const runPaperDay = async (now = Date.now()) => {
  const stored = await readPaper();
  if (stored === null) return null;
  const store: PaperStore = stored ?? { start: PAPER_START, startedAt: now, cash: PAPER_START, lastRun: null, lastNote: null, parlays: [] };

  const settled = await settlePaper(store, now).catch(() => 0);
  const day = new Date(now).toISOString().slice(0, 10);
  if (store.lastRun === day) {
    await writePaper(store);
    return { day, settled, placed: 0, note: "Already bet today." };
  }

  const balance = store.cash + pendingStake(store);
  let note: string;
  if (balance * DAILY_STAKE < MIN_STAKE) {
    note = `Bust: ${formatMoney(balance)} left, too little to bet.`;
  } else {
    try {
      const profile = await loadProfile(null);
      const result = await scan({ window: "today", from: now, to: now + DAY, leagues: [...SCAN_LEAGUES] }, profile, "opinion");
      await trackPicks(result.legs).catch(() => null);
      const { placed, staked } = placeBets(store, result.legs, calibrate(store.parlays), day, now);
      note = placed
        ? `Bet ${placed} parlay${placed === 1 ? "" : "s"}, ${formatMoney(staked)} total.`
        : result.legs.length < 2
          ? `Sat out: only ${result.legs.length} pick${result.legs.length === 1 ? "" : "s"} today.${result.note ? ` ${result.note}` : ""}`
          : `Sat out: no parlay cleared +${Math.round(MIN_EV * 100)}% expected profit.`;
    } catch {
      // Not marked as run: the bankroll waits for tomorrow rather than recording a fake sit-out.
      store.lastNote = "Today's scan failed — Kalshi or the AI didn't respond.";
      await writePaper(store);
      return { day, settled, placed: 0, note: store.lastNote };
    }
  }
  store.lastRun = day;
  store.lastNote = note;
  await writePaper(store);
  return { day, settled, placed: store.parlays.filter((p) => p.day === day).length, note };
};

/** What the Bet Vault shows. Null when Upstash isn't configured. */
export const paperSummary = async (): Promise<PaperSummary | null> => {
  const stored = await readPaper();
  if (stored === null) return null;
  const store = stored ?? { start: PAPER_START, startedAt: 0, cash: PAPER_START, lastRun: null, lastNote: null, parlays: [] };
  const pending = cents(pendingStake(store));
  return {
    start: store.start,
    cash: store.cash,
    pending,
    balance: cents(store.cash + pending),
    startedAt: stored ? store.startedAt : null,
    lastRun: store.lastRun,
    lastNote: store.lastNote,
    wins: store.parlays.filter((p) => p.outcome === "WIN").length,
    losses: store.parlays.filter((p) => p.outcome === "LOSS").length,
    calibration: calibrate(store.parlays),
    parlays: [...store.parlays].sort((a, b) => b.placedAt - a.placedAt).slice(0, SHOWN_PARLAYS),
  };
};
