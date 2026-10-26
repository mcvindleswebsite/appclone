import { checkAccess } from "@/lib/bet/access";
import type { BetRecord } from "@/types/bet";

export const dynamic = "force-dynamic";

const KEY = "mcvindle_bet_history";
const MAX_RECORDS_PER_WRITE = 500;
const MAX_RECORD_BYTES = 8_000;

/** Upstash Redis over REST; Vercel's Upstash integration sets either pair of env vars. */
const redis = async (command: (string | number)[]) => {
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

const notConfigured = () => Response.json({ error: "Store not configured" }, { status: 503 });

const isRecord = (value: unknown): value is BetRecord => {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<BetRecord>;
  return typeof r.id === "string" && r.id.length <= 64 && typeof r.updatedAt === "number" && !!r.slip;
};

export async function GET(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  const reply = await redis(["HGETALL", KEY]);
  if (!reply) return notConfigured();

  // HGETALL comes back flat: [id, json, id, json, ...].
  const flat = (reply.result as string[] | null) ?? [];
  const records: BetRecord[] = [];
  for (let i = 1; i < flat.length; i += 2) {
    try {
      const parsed: unknown = JSON.parse(flat[i]);
      if (isRecord(parsed)) records.push(parsed);
    } catch {
      // Skip a corrupt entry rather than failing the whole vault.
    }
  }
  return Response.json({ records });
}

export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as { records?: unknown[] } | null;
  const records = (body?.records ?? []).filter(isRecord).slice(0, MAX_RECORDS_PER_WRITE);
  const fields = records.flatMap((r) => {
    const json = JSON.stringify(r);
    return json.length <= MAX_RECORD_BYTES ? [r.id, json] : [];
  });
  if (fields.length === 0) return Response.json({ saved: 0 });

  const reply = await redis(["HSET", KEY, ...fields]);
  if (!reply) return notConfigured();
  return Response.json({ saved: fields.length / 2 });
}

export async function DELETE(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  const reply = await redis(["HDEL", KEY, id]);
  if (!reply) return notConfigured();
  return Response.json({ deleted: reply.result });
}
