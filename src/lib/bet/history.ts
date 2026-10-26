import type { BetLeg, BetRecord, BetSlip, HistoryContext, HistoryInsights, RiskLevel } from "@/types/bet";

export const HISTORY_KEY = "mcvindle_bet_history";
export const ACCESS_KEY_STORAGE = "mcvindle_bet_access_key";

interface LegacySlip {
  sport: string;
  matchup: string;
  marketTitle: string;
  pick: string;
  yesPrice: number;
  americanOdds: number | null;
}

/** Upgrades records saved before slips had legs (one flat bet per slip). */
export const normalizeRecord = (record: BetRecord): BetRecord => {
  const slip = record.slip as BetSlip | LegacySlip;
  if ("legs" in slip && Array.isArray(slip.legs)) return record;
  const old = slip as LegacySlip;
  const leg: BetLeg = {
    sport: old.sport ?? "Other",
    matchup: old.matchup ?? "",
    market: old.marketTitle ?? "",
    pick: old.pick ?? "",
    price: typeof old.yesPrice === "number" ? old.yesPrice : null,
    americanOdds: old.americanOdds ?? null,
  };
  return { ...record, slip: { legs: [leg], comboPrice: null, comboOdds: null } };
};

export const loadLocal = (): BetRecord[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as BetRecord[]).map(normalizeRecord) : [];
  } catch {
    return [];
  }
};

export const saveLocal = (records: BetRecord[]) => {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(records));
};

/** Union by id, keeping whichever copy was updated last; newest first. */
export const mergeRecords = (a: BetRecord[], b: BetRecord[]) => {
  const byId = new Map<string, BetRecord>();
  for (const r of [...a, ...b]) {
    const existing = byId.get(r.id);
    if (!existing || r.updatedAt > existing.updatedAt) byId.set(r.id, r);
  }
  return [...byId.values()].sort((x, y) => y.createdAt - x.createdAt);
};

const headers = (key: string) => ({ "Content-Type": "application/json", "x-bet-key": key });

/** "local" (no key), "synced", or a human-readable reason the sync failed. */
export type SyncStatus = "local" | "checking" | "synced" | { error: string };

/** Turns an API failure into something that says what to fix. */
const failure = async (response: Response) => {
  const { error } = (await response.json().catch(() => ({}))) as { error?: string };
  if (response.status === 401) return new Error("Wrong passphrase");
  if (error === "Not configured") return new Error("BET_ACCESS_KEY not set on the server");
  if (error === "Store not configured") return new Error("Storage not connected on the server");
  return new Error(error ?? `Server error ${response.status}`);
};

export const syncErrorMessage = (error: unknown) =>
  error instanceof Error && error.message !== "Failed to fetch" ? error.message : "Can't reach the server";

export const fetchRemote = async (key: string): Promise<BetRecord[]> => {
  const response = await fetch("/api/bet/history", { headers: headers(key), cache: "no-store" });
  if (!response.ok) throw await failure(response);
  const { records } = (await response.json()) as { records: BetRecord[] };
  return records.map(normalizeRecord);
};

export const pushRemote = async (key: string, records: BetRecord[]) => {
  const response = await fetch("/api/bet/history", {
    method: "POST",
    headers: headers(key),
    body: JSON.stringify({ records }),
  });
  if (!response.ok) throw await failure(response);
};

export const deleteRemote = async (key: string, id: string) => {
  const response = await fetch(`/api/bet/history?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: headers(key),
  });
  return response.ok;
};

const tally = <K extends string>(records: BetRecord[], keyOf: (r: BetRecord) => K[]) => {
  const map = new Map<K, { count: number; wins: number; losses: number }>();
  for (const r of records) {
    for (const k of keyOf(r)) {
      const row = map.get(k) ?? { count: 0, wins: 0, losses: 0 };
      row.count++;
      if (r.outcome === "WIN") row.wins++;
      if (r.outcome === "LOSS") row.losses++;
      map.set(k, row);
    }
  }
  return [...map.entries()].sort((a, b) => b[1].count - a[1].count);
};

export const teamsOf = (r: BetRecord) => [
  ...new Set(
    r.slip.legs.flatMap((leg) =>
      leg.matchup
        .split(/\s+(?:vs\.?|v\.?|@|at)\s+/i)
        .map((t) => t.trim())
        .filter((t) => t.length > 1)
    )
  ),
];

export const sportsOf = (r: BetRecord) => [...new Set(r.slip.legs.map((leg) => leg.sport))];

/** Short human label for a slip: "Durant 25+ pts" or "4-leg parlay: Durant, Brunson, …". */
export const slipLabel = (slip: BetSlip) => {
  const names = slip.legs.map((l) => l.pick || l.market || l.matchup).filter(Boolean);
  if (slip.legs.length <= 1) return slip.legs[0]?.market || slip.legs[0]?.matchup || names[0] || "Bet";
  return `${slip.legs.length}-leg parlay: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""}`;
};

/** Units won on a settled pick at one unit staked; null while pending or without odds. */
const unitsWon = (r: BetRecord) => {
  if (r.outcome === "PENDING" || !r.decimalOdds) return null;
  return r.outcome === "WIN" ? r.decimalOdds - 1 : -1;
};

/** Rough market family for leg-level stats. */
export const marketType = (leg: BetLeg) => {
  const m = `${leg.market} ${leg.pick}`;
  if (/spread|wins? by|[+-]\d+\.5\b/i.test(m)) return "Spread";
  if (/^(?:no — )?(?:over|under)\b|\btotal\b/i.test(leg.market)) return "Total";
  if (/\b(points?|pts|rebounds?|reb|assists?|ast|yards?|yds|touchdowns?|td|receptions?|hits?|strikeouts?|threes|goals?|shots?|saves|rbis?)\b|\d+\+/i.test(m)) {
    return "Player prop";
  }
  if (/\bwins?\b|moneyline|\bml\b/i.test(m)) return "Moneyline";
  return "Other";
};

/** "8/9" for a slip whose legs have settled results, else null. */
export const legTally = (slip: BetSlip) => {
  const counted = slip.legs.filter((l) => l.result && l.result !== "VOID");
  const settled = counted.filter((l) => l.result === "WIN" || l.result === "LOSS");
  if (settled.length === 0) return null;
  return { hit: settled.filter((l) => l.result === "WIN").length, settled: settled.length, total: counted.length };
};

const legRate = <K extends string>(legs: BetLeg[], keyOf: (leg: BetLeg) => K) => {
  const map = new Map<K, { hit: number; settled: number }>();
  for (const leg of legs) {
    if (leg.result !== "WIN" && leg.result !== "LOSS") continue;
    const row = map.get(keyOf(leg)) ?? { hit: 0, settled: 0 };
    row.settled++;
    if (leg.result === "WIN") row.hit++;
    map.set(keyOf(leg), row);
  }
  return [...map.entries()].sort((a, b) => b[1].settled - a[1].settled);
};

/** What the AI sees of the vault: last 20 picks with leg results, win rate, ROI, and leg hit rates. */
export const historyContext = (records: BetRecord[]): HistoryContext => {
  const settled = records.filter((r) => r.outcome !== "PENDING");
  const priced = settled.map(unitsWon).filter((u): u is number => u !== null);
  const wins = settled.filter((r) => r.outcome === "WIN").length;
  const recent = [...records].sort((a, b) => b.createdAt - a.createdAt).slice(0, 20);
  const recentLegs = recent.flatMap((r) => r.slip.legs);
  return {
    settled: settled.length,
    winRate: settled.length ? wins / settled.length : null,
    roi: priced.length ? priced.reduce((a, b) => a + b, 0) / priced.length : null,
    recent: recent.map((r) => ({
        date: new Date(r.createdAt).toISOString().slice(0, 10),
        legs: r.slip.legs
          .map((l) => `${l.sport}: ${l.market || l.pick}${l.result && l.result !== "PENDING" ? ` [${l.result}]` : ""}`)
          .join(" | ")
          .slice(0, 600),
        verdict: r.verdict,
        outcome: r.outcome,
        odds: r.decimalOdds ? Math.round(r.decimalOdds * 100) / 100 : null,
        legsHit: (() => {
          const t = legTally(r.slip);
          return t ? `${t.hit}/${t.total} legs hit${t.settled < t.total ? ` (${t.total - t.settled} pending)` : ""}` : null;
        })(),
      })),
    legs: {
      hit: recentLegs.filter((l) => l.result === "WIN").length,
      settled: recentLegs.filter((l) => l.result === "WIN" || l.result === "LOSS").length,
      bySport: legRate(recentLegs, (l) => l.sport).map(([sport, row]) => ({ sport, ...row })),
      byType: legRate(recentLegs, marketType).map(([type, row]) => ({ type, ...row })),
    },
  };
};

export const buildInsights = (records: BetRecord[]): HistoryInsights => ({
  total: records.length,
  record: {
    wins: records.filter((r) => r.outcome === "WIN").length,
    losses: records.filter((r) => r.outcome === "LOSS").length,
    pending: records.filter((r) => r.outcome === "PENDING").length,
  },
  sports: tally(records, sportsOf).map(([sport, row]) => ({ sport, ...row })),
  teams: tally(records, teamsOf).map(([team, row]) => ({ team, ...row })),
  byRisk: ([1, 2, 3, 4, 5] as RiskLevel[]).map((risk) => {
    const at = records.filter((r) => r.risk === risk);
    return {
      risk,
      wins: at.filter((r) => r.outcome === "WIN").length,
      losses: at.filter((r) => r.outcome === "LOSS").length,
    };
  }),
});

/** One-line memory notes relevant to the slip being evaluated. */
export const memoryNotes = (insights: HistoryInsights, slip: BetSlip) => {
  const sport = slip.legs[0]?.sport ?? "";
  const matchup = slip.legs.map((l) => l.matchup).join(" ");
  const notes: string[] = [];
  const s = insights.sports.find((row) => row.sport === sport);
  if (s && s.wins + s.losses >= 3) {
    notes.push(`You're ${s.wins}-${s.losses} on settled ${sport} picks.`);
  }
  const lower = matchup.toLowerCase();
  for (const t of insights.teams) {
    if (t.team.length > 2 && lower.includes(t.team.toLowerCase()) && t.count >= 2) {
      notes.push(`${t.team}: ${t.count} past picks (${t.wins}-${t.losses}).`);
    }
  }
  return notes.slice(0, 3);
};
