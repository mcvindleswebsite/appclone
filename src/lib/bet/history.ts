import type { BetRecord, HistoryInsights, RiskLevel } from "@/types/bet";

export const HISTORY_KEY = "mcvindle_bet_history";
export const ACCESS_KEY_STORAGE = "mcvindle_bet_access_key";

export const loadLocal = (): BetRecord[] => {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(parsed) ? (parsed as BetRecord[]) : [];
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
export type SyncStatus = "local" | "synced" | { error: string };

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
  return records;
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

export const teamsOf = (r: BetRecord) =>
  r.slip.matchup
    .split(/\s+(?:vs\.?|v\.?|@|at)\s+/i)
    .map((t) => t.trim())
    .filter((t) => t.length > 1);

export const buildInsights = (records: BetRecord[]): HistoryInsights => ({
  total: records.length,
  record: {
    wins: records.filter((r) => r.outcome === "WIN").length,
    losses: records.filter((r) => r.outcome === "LOSS").length,
    pending: records.filter((r) => r.outcome === "PENDING").length,
  },
  sports: tally(records, (r) => [r.slip.sport]).map(([sport, row]) => ({ sport, ...row })),
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
export const memoryNotes = (insights: HistoryInsights, sport: string, matchup: string) => {
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
