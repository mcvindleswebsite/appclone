/**
 * The Bet Vault's storage API, served at /api/vault (and /api/bet/history, the older path
 * existing clients still call). Every route is gated by the access key.
 */
import { checkAccess } from "@/lib/bet/access";
import { withPnl } from "@/lib/bet/pnl";
import { isRecord, readVault, redis, VAULT_KEY } from "@/lib/bet/store";

const MAX_RECORDS_PER_WRITE = 500;
const MAX_RECORD_BYTES = 16_000;

const notConfigured = () => Response.json({ error: "Store not configured" }, { status: 503 });

/** Runs a store command, mapping a missing or failing store to a JSON error response. */
const run = async (command: (string | number)[]) => {
  try {
    const reply = await redis(command);
    return reply ?? notConfigured();
  } catch {
    return Response.json({ error: "Storage error — check the Upstash connection" }, { status: 502 });
  }
};

export async function vaultGet(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  try {
    const records = await readVault();
    return records ? Response.json({ records }) : notConfigured();
  } catch {
    return Response.json({ error: "Storage error — check the Upstash connection" }, { status: 502 });
  }
}

export async function vaultPost(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;

  const body = (await request.json().catch(() => null)) as { records?: unknown[] } | null;
  // Payout and profit are recomputed here from wager, odds, and outcome, never trusted as sent.
  const records = (body?.records ?? []).filter(isRecord).slice(0, MAX_RECORDS_PER_WRITE).map(withPnl);
  const fields = records.flatMap((r) => {
    const json = JSON.stringify(r);
    return json.length <= MAX_RECORD_BYTES ? [r.id, json] : [];
  });
  if (fields.length === 0) return Response.json({ saved: 0 });

  const reply = await run(["HSET", VAULT_KEY, ...fields]);
  if (reply instanceof Response) return reply;
  return Response.json({ saved: fields.length / 2 });
}

export async function vaultDelete(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
  const reply = await run(["HDEL", VAULT_KEY, id]);
  if (reply instanceof Response) return reply;
  return Response.json({ deleted: reply.result });
}
