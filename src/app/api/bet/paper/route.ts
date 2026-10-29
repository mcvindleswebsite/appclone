import { checkAccess, isCron } from "@/lib/bet/access";
import { paperSummary, runPaperDay } from "@/lib/bet/paper";

export const dynamic = "force-dynamic";
// Settlement plus a full AI Picks scan (research alone is capped at 100s).
export const maxDuration = 300;

const notConfigured = () => Response.json({ error: "Store not configured" }, { status: 503 });

/** Vercel Cron, once a day: settle the paper bankroll's parlays and bet today's. */
export async function GET(request: Request) {
  if (!isCron(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await runPaperDay();
    return result ? Response.json(result) : notConfigured();
  } catch {
    return Response.json({ error: "Paper run failed — Kalshi or the store didn't respond" }, { status: 502 });
  }
}

/** The Bet Vault's counter: the bankroll's current state, read-only. */
export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  try {
    const summary = await paperSummary();
    return summary ? Response.json(summary) : notConfigured();
  } catch {
    return Response.json({ error: "Storage error — check the Upstash connection" }, { status: 502 });
  }
}
