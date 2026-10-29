import { checkAccess, isCron } from "@/lib/bet/access";
import { settleRecords } from "@/lib/bet/settle";
import { readVault, redis, VAULT_KEY } from "@/lib/bet/store";
import { settleTracked } from "@/lib/bet/track";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Settles every pending vault pick that has Kalshi tickers, straight from Kalshi's public
 * market results (no AI), and writes the changed picks back to Upstash. Overall record,
 * hit rate, and ROI are derived from the picks, so they update with them.
 */
const sync = async () => {
  try {
    const records = await readVault();
    if (!records) return Response.json({ error: "Store not configured" }, { status: 503 });

    const [{ checked, updated, settled, failed }] = await Promise.all([
      settleRecords(records),
      // The scanner's own track record settles on the same schedule.
      settleTracked().catch(() => null),
    ]);
    if (updated.length) {
      const reply = await redis(["HSET", VAULT_KEY, ...updated.flatMap((r) => [r.id, JSON.stringify(r)])]);
      if (!reply) return Response.json({ error: "Store not configured" }, { status: 503 });
    }
    return Response.json({ checked, updated: updated.length, settled, failed, at: new Date().toISOString() });
  } catch {
    return Response.json({ error: "Sync failed — Kalshi or the store didn't respond" }, { status: 502 });
  }
};

/** Vercel Cron: authenticated with `Authorization: Bearer $CRON_SECRET`. */
export async function GET(request: Request) {
  if (!isCron(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return sync();
}

/** The Bet Vault's Sync Results button: authenticated with the access key. */
export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  return sync();
}
