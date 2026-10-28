import { checkAccess } from "@/lib/bet/access";
import { settleTracked, trackSummary } from "@/lib/bet/track";
import type { TrackedPick } from "@/types/bet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The scanner's track record: settles any finished picks against Kalshi (no AI), then
 * returns recent picks and flat-stake results overall, by basis (sharp vs AI-only), and by
 * research depth.
 */
export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  try {
    const picks = await settleTracked();
    if (!picks) return Response.json({ configured: false });
    const by = (keep: (p: TrackedPick) => boolean) => trackSummary(picks.filter(keep));
    return Response.json({
      configured: true,
      summary: trackSummary(picks),
      sharp: by((p) => p.basis === "sharp"),
      ai: by((p) => p.basis === "ai"),
      safe: by((p) => p.basis === "safe"),
      deep: by((p) => p.deep),
      recent: picks.slice(0, 30),
    });
  } catch {
    return Response.json({ error: "Couldn't read the track record — Kalshi or the store didn't respond" }, { status: 502 });
  }
}
