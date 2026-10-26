import { resolveKalshiLinks } from "@/lib/bet/kalshi-api";
import { settleLegs, splitLinks } from "@/lib/bet/kalshi-link";
import type { VaultSettlement } from "@/types/bet";

export const dynamic = "force-dynamic";

/** Settled combos can bundle more legs than the evaluator handles; read all of them. */
const MAX_SETTLEMENT_LEGS = 25;

/**
 * Settles pasted Kalshi links leg by leg from Kalshi's public market results. No AI is
 * involved: each leg's WIN/LOSS comes straight from the market's settled `result` against
 * the side that was bet (combos carry their legs' sides in `mve_selected_legs`).
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { links?: unknown } | null;
  const links = typeof body?.links === "string" ? body.links : "";
  if (splitLinks(links).length === 0 || links.length > 8000) {
    return Response.json({ error: "Not a Kalshi link" }, { status: 400 });
  }

  try {
    const resolved = await resolveKalshiLinks(links, MAX_SETTLEMENT_LEGS);
    if (resolved.legs.length === 0) {
      return Response.json(
        { error: "That's a game page, not a bet — open the specific market or combo you bet and copy its link." },
        { status: 422 }
      );
    }
    const result: VaultSettlement = {
      legs: resolved.legs,
      comboTicker: resolved.comboTicker,
      comboPrice: resolved.comboPrice,
      ...settleLegs(resolved.legs, resolved.comboResult),
      skipped: resolved.choices.length,
    };
    return Response.json(result);
  } catch {
    return Response.json({ error: "Kalshi didn't respond — try again" }, { status: 502 });
  }
}
