import { normalizeRecord } from "@/lib/bet/history";
import type { BetRecord } from "@/types/bet";

export const VAULT_KEY = "mcvindle_bet_history";

/** Upstash Redis over REST; Vercel's Upstash integration sets either pair of env vars. Null when unconfigured. */
export const redis = async (command: (string | number)[]) => {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Redis ${response.status}`);
  const { result } = (await response.json()) as { result: unknown };
  return { result };
};

export const isRecord = (value: unknown): value is BetRecord => {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<BetRecord>;
  return typeof r.id === "string" && r.id.length <= 64 && typeof r.updatedAt === "number" && !!r.slip;
};

/** Every vault record, or null when the store isn't configured. */
export const readVault = async (): Promise<BetRecord[] | null> => {
  const reply = await redis(["HGETALL", VAULT_KEY]);
  if (!reply) return null;
  // HGETALL comes back flat: [id, json, id, json, ...].
  const flat = (reply.result as string[] | null) ?? [];
  const records: BetRecord[] = [];
  for (let i = 1; i < flat.length; i += 2) {
    try {
      const parsed: unknown = JSON.parse(flat[i]);
      if (isRecord(parsed)) records.push(normalizeRecord(parsed));
    } catch {
      // Skip a corrupt entry rather than failing the whole vault.
    }
  }
  return records;
};
