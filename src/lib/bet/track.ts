import { kalshiDecimal } from "@/lib/bet/engine";
import { resolveClosingLines, resolveKalshiLinks } from "@/lib/bet/kalshi-api";
import { tickerLink } from "@/lib/bet/kalshi-link";
import { redis } from "@/lib/bet/store";
import type { RecommendedLeg, TrackedPick, TrackSummary } from "@/types/bet";

/**
 * The scanner's own track record (no AI): every Top Pick is logged here when it's first
 * recommended, bet or not, then settled and given a closing line from Kalshi. Upstash only;
 * without it nothing is tracked.
 */
export const TRACK_KEY = "vindle_scanner_track";

/** Kalshi needs a little time after the final whistle to settle. */
const SETTLE_AFTER_MS = 2.5 * 60 * 60 * 1000;

/** Logs new picks; a pick already tracked keeps its first entry price. */
export const trackPicks = async (legs: RecommendedLeg[]) => {
  const now = Date.now();
  await Promise.all(
    legs
      .filter((l) => l.leg.ticker && l.leg.price !== null)
      .map((l) => {
        const pick: TrackedPick = {
          ticker: l.leg.ticker!,
          matchup: l.matchName,
          pick: l.pick,
          league: l.league,
          kickoffTime: l.kickoffTime,
          entry: l.leg.price!,
          probability: l.modelProbability,
          basis: l.basis,
          deep: l.deep,
          loggedAt: now,
        };
        return redis(["HSETNX", TRACK_KEY, pick.ticker, JSON.stringify(pick)]).catch(() => null);
      })
  );
};

export const readTracked = async (): Promise<TrackedPick[] | null> => {
  const reply = await redis(["HGETALL", TRACK_KEY]);
  if (!reply) return null;
  const flat = (reply.result as string[] | null) ?? [];
  const picks: TrackedPick[] = [];
  for (let i = 1; i < flat.length; i += 2) {
    try {
      picks.push(JSON.parse(flat[i]) as TrackedPick);
    } catch {
      // Skip a corrupt entry.
    }
  }
  return picks.sort((a, b) => b.loggedAt - a.loggedAt);
};

/**
 * Fills in results and closing lines for picks whose games are over, up to `limit` at a
 * time, and writes the changed ones back. Returns the full, updated list.
 */
export const settleTracked = async (limit = 40) => {
  const picks = await readTracked();
  if (!picks) return null;
  const now = Date.now();
  const due = picks.filter(
    (p) => (!p.result || p.result === "PENDING" || p.close === undefined) && Date.parse(p.kickoffTime) + SETTLE_AFTER_MS < now
  );
  const batch = due.slice(0, limit);
  if (!batch.length) return picks;

  const [settled, closes] = await Promise.all([
    resolveKalshiLinks(batch.map((p) => tickerLink(p.ticker)).join("\n"), batch.length).catch(() => null),
    resolveClosingLines(batch.filter((p) => p.close === undefined).map((p) => p.ticker)).catch(() => ({})),
  ]);
  const results = new Map((settled?.legs ?? []).map((l) => [l.ticker, l.result]));
  const changed: TrackedPick[] = [];
  for (const p of batch) {
    const result = results.get(p.ticker);
    const line = (closes as Awaited<ReturnType<typeof resolveClosingLines>>)[p.ticker];
    const next: TrackedPick = {
      ...p,
      ...(result && result !== "PENDING" ? { result } : {}),
      ...(line && line.status !== "upcoming" && p.close === undefined ? { close: line.yes } : {}),
    };
    if (next.result !== p.result || next.close !== p.close) changed.push(next);
  }
  if (changed.length) {
    await redis(["HSET", TRACK_KEY, ...changed.flatMap((p) => [p.ticker, JSON.stringify(p)])]).catch(() => null);
  }
  const byTicker = new Map(changed.map((p) => [p.ticker, p]));
  return picks.map((p) => byTicker.get(p.ticker) ?? p);
};

/** Flat one-unit results and CLV for a set of tracked picks. */
export const trackSummary = (picks: TrackedPick[]): TrackSummary => {
  const settled = picks.filter((p) => p.result === "WIN" || p.result === "LOSS");
  const wins = settled.filter((p) => p.result === "WIN").length;
  const units = settled.map((p) => (p.result === "WIN" ? kalshiDecimal(p.entry) - 1 : -1));
  const clvs = picks.filter((p) => typeof p.close === "number" && p.close > 0).map((p) => (p.close as number) / p.entry - 1);
  return {
    picks: picks.length,
    settled: settled.length,
    wins,
    roi: units.length ? units.reduce((a, b) => a + b, 0) / units.length : null,
    clv: clvs.length ? clvs.reduce((a, b) => a + b, 0) / clvs.length : null,
    clvN: clvs.length,
    beatClose: clvs.length ? clvs.filter((c) => c > 0).length / clvs.length : null,
  };
};
