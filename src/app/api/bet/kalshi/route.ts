import type { NextRequest } from "next/server";

import { resolveKalshiLinks } from "@/lib/bet/kalshi-api";
import { splitLinks } from "@/lib/bet/kalshi-link";
import { MAX_LEGS } from "@/types/bet";

export const dynamic = "force-dynamic";

/** Resolves pasted Kalshi links into slip legs with live prices, for the evaluator. */
export async function GET(request: NextRequest) {
  const input = request.nextUrl.searchParams.get("url") ?? "";
  if (splitLinks(input).length === 0 || input.length > 6000) {
    return Response.json({ error: "Not a Kalshi link" }, { status: 400 });
  }

  try {
    const out = await resolveKalshiLinks(input, MAX_LEGS);
    if (out.legs.length === 0 && out.choices.length === 0) {
      return Response.json(
        { error: "Couldn't find a market in that link — open a specific game and copy its link" },
        { status: 404 }
      );
    }
    return Response.json(out);
  } catch {
    return Response.json({ error: "Kalshi didn't respond — try again" }, { status: 502 });
  }
}
