import Anthropic from "@anthropic-ai/sdk";

import { checkAccess } from "@/lib/bet/access";
import { americanToDecimal, kalshiDecimal, legDecimal } from "@/lib/bet/engine";
import { historyContext } from "@/lib/bet/history";
import { BET_MODEL } from "@/lib/bet/model";
import { clamp, describeLeg, int, researchLeg, runTool } from "@/lib/bet/research";
import { readVault } from "@/lib/bet/store";
import {
  MAX_LEGS,
  type BetLeg,
  type BetSlip,
  type Correlation,
  type HistoryContext,
  type LegRating,
  type RiskLevel,
  type SlipAnalysis,
} from "@/types/bet";

export const dynamic = "force-dynamic";
// Legs are researched in parallel, so a 12-leg slip takes about as long as one leg.
export const maxDuration = 120;

/* ------------------------------ Whole slip ------------------------------ */

const SLIP_SYSTEM = `You are a sharp, calibrated sports analyst reviewing a whole bet slip. Each leg has already been researched; you get those findings. Your job is the slip as a whole:

- Flag correlations between legs, especially same-game parlay legs that work against each other (negative: e.g. a QB passing over with his RB rushing over, or both teams' unders with a game over). Positive correlations matter too, because they raise the true joint probability.
- Weigh the per-leg opponent-tier findings: a trap-game favorite drags the whole slip down, and a play-up underdog spot can be the best value on it.
- Estimate the true probability that EVERY leg hits, accounting for those correlations — not just the product of the leg probabilities.
- riskScore 1-5 is the slip's variance: 1 is stable and high-floor, 5 depends on many swingy outcomes.
- reasoning is exactly two sentences: the case, then the main risk.
- If a leg should be downgraded because it conflicts with stronger legs, add it to legAdjustments with its new rating and a one-sentence reason. Leave legAdjustments empty otherwise.
- For a single-leg slip, pathsToVictory lists concrete ways it hits and risks lists concrete ways it misses.

The user's own betting record is included below, with how each past leg settled and their leg hit rates by sport and market type. Use it as context: when a leg on this slip is the kind that has kept missing for them (a market type or sport with a poor leg hit rate), say so, and you may downgrade it through legAdjustments if the research also supports that. Note when the slip repeats a pattern that has been losing them money, or plays to what has worked. Never shift a probability just because of their preferences.

When done, call submit_slip exactly once.`;

const SUBMIT_SLIP: Anthropic.Beta.BetaTool = {
  name: "submit_slip",
  description: "Submit the whole-slip evaluation.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      trueWinProbability: { type: "number", description: "Probability (0-1) every leg hits, correlation included." },
      riskScore: { type: "integer", enum: [1, 2, 3, 4, 5] },
      reasoning: { type: "string", description: "Exactly two sentences." },
      correlations: {
        type: "array",
        items: {
          type: "object",
          properties: {
            legs: { type: "array", items: { type: "integer" }, description: "1-based leg numbers." },
            type: { type: "string", enum: ["negative", "positive"] },
            note: { type: "string" },
          },
          required: ["legs", "type", "note"],
          additionalProperties: false,
        },
      },
      legAdjustments: {
        type: "array",
        items: {
          type: "object",
          properties: {
            leg: { type: "integer", description: "1-based leg number." },
            rating: { type: "string", enum: ["STRONG VALUE", "NEUTRAL", "BUM PICK"] },
            reason: { type: "string" },
          },
          required: ["leg", "rating", "reason"],
          additionalProperties: false,
        },
      },
      pathsToVictory: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
    },
    required: ["trueWinProbability", "riskScore", "reasoning", "correlations", "legAdjustments", "pathsToVictory", "risks"],
    additionalProperties: false,
  },
};

interface SlipSubmission {
  trueWinProbability: number;
  riskScore: number;
  reasoning: string;
  correlations: { legs: number[]; type: Correlation["type"]; note: string }[];
  legAdjustments: { leg: number; rating: LegRating; reason: string }[];
  pathsToVictory: string[];
  risks: string[];
}

/* -------------------------------- Helpers -------------------------------- */

const describeHistory = (h: HistoryContext | null) => {
  if (!h || h.recent.length === 0) return "No betting history yet.";
  const pct = (n: number | null) => (n === null ? "n/a" : `${(n * 100).toFixed(1)}%`);
  const rate = (r: { hit: number; settled: number }) => `${r.hit}/${r.settled} (${pct(r.settled ? r.hit / r.settled : null)})`;
  const legs = h.legs ?? { hit: 0, settled: 0, bySport: [], byType: [] };
  return [
    `Settled picks: ${h.settled} · win rate ${pct(h.winRate)} · ROI ${pct(h.roi)} per unit staked${
      h.dollars?.staked ? ` · net ${h.dollars.profit >= 0 ? "+" : "-"}$${Math.abs(h.dollars.profit).toFixed(2)} on $${h.dollars.staked.toFixed(2)} staked` : ""
    }`,
    legs.settled
      ? [
          `Leg hit rate over these picks: ${rate(legs)}`,
          `By sport: ${legs.bySport.map((s) => `${s.sport} ${rate(s)}`).join("; ")}`,
          `By market type: ${legs.byType.map((t) => `${t.type} ${rate(t)}`).join("; ")}`,
        ].join("\n")
      : "No settled legs yet.",
    "Last 20 picks (newest first):",
    ...h.recent.map(
      (r) =>
        `- ${r.date} [${r.outcome}${r.legsHit ? ` · ${r.legsHit}` : ""}] ${r.verdict}${r.odds ? ` @ ${r.odds}x` : ""}: ${r.legs}`
    ),
  ].join("\n");
};

const isLeg = (value: unknown): value is BetLeg => {
  if (!value || typeof value !== "object") return false;
  const l = value as Partial<BetLeg>;
  const priceOk = l.price === null || (typeof l.price === "number" && l.price >= 1 && l.price <= 99);
  return priceOk && [l.sport, l.matchup, l.market, l.pick].every((f) => typeof f === "string" && f.length <= 300);
};

const isSlip = (value: unknown): value is BetSlip => {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<BetSlip>;
  return Array.isArray(s.legs) && s.legs.length >= 1 && s.legs.length <= MAX_LEGS && s.legs.every(isLeg);
};

/** History from the Upstash vault when it's connected, else what the browser sent. */
const loadHistory = async (sent: unknown): Promise<HistoryContext | null> => {
  try {
    const records = await readVault();
    if (records) return historyContext(records);
  } catch {
    // Fall through to the client copy.
  }
  if (sent && typeof sent === "object" && Array.isArray((sent as HistoryContext).recent)) {
    const h = sent as HistoryContext;
    return { ...h, recent: h.recent.slice(0, 20) };
  }
  return null;
};

/** EV of the full slip at its price, % of stake. Computed here, not by the model. */
const slipEvPercent = (slip: BetSlip, probability: number) => {
  const decimals = slip.legs.map(legDecimal);
  const decimal = slip.comboPrice
    ? kalshiDecimal(slip.comboPrice)
    : slip.comboOdds
      ? americanToDecimal(slip.comboOdds)
      : decimals.every((d) => d !== null)
        ? (decimals as number[]).reduce((a, b) => a * b, 1)
        : null;
  return decimal ? Math.round((probability * decimal - 1) * 1000) / 10 : null;
};

export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI not configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { slip?: unknown; history?: unknown } | null;
  if (!isSlip(body?.slip) || JSON.stringify(body).length > 60_000) {
    return Response.json({ error: "Invalid bet details" }, { status: 400 });
  }
  const slip = body.slip;

  try {
    const [legs, history] = await Promise.all([Promise.all(slip.legs.map((leg) => researchLeg(leg))), loadHistory(body.history)]);
    if (legs.every((l) => !l.researched)) {
      return Response.json({ error: "Research failed for every leg — try again" }, { status: 502 });
    }

    const findings = slip.legs
      .map((leg, i) => {
        const a = legs[i];
        return `${describeLeg(leg, i + 1)}\nFinding: ${a.rating}, ${Math.round(a.probability * 100)}% to hit (confidence ${a.hitConfidence}/10). ${a.reason} Last 10: ${a.last10.hits}/${a.last10.games}. Matchup: ${a.matchup.label}.${a.opponentTier.note ? ` Opponent tier: ${a.opponentTier.note}.` : ""}${a.opponentTier.trapGame ? " TRAP GAME." : ""}${a.opponentTier.playUpSpot ? " Play-up underdog spot." : ""}${a.injuries.length ? ` Injuries: ${a.injuries.map((x) => `${x.note} (${x.effect})`).join("; ")}.` : ""}`;
      })
      .join("\n\n");
    const price = slip.comboPrice ? `Combo price: ${slip.comboPrice}¢` : slip.comboOdds ? `Parlay odds: ${slip.comboOdds}` : "No combo price.";

    const whole = await runTool<SlipSubmission>(
      `${SLIP_SYSTEM}\n\n<betting_history>\n${describeHistory(history)}\n</betting_history>`,
      SUBMIT_SLIP,
      `${slip.legs.length}-leg slip. ${price}\n\n${findings}`,
      { webSearches: 0, effort: "medium" }
    );
    if (!whole) return Response.json({ error: "No slip evaluation returned" }, { status: 502 });

    for (const adj of whole.legAdjustments) {
      const target = legs[adj.leg - 1];
      if (target?.researched) Object.assign(target, { rating: adj.rating, reason: adj.reason });
    }
    const trueWinProbability = clamp(whole.trueWinProbability, 0.0001, 0.99);
    const result: SlipAnalysis = {
      legs,
      trueWinProbability,
      riskScore: int(whole.riskScore, 1, 5) as RiskLevel,
      reasoning: whole.reasoning,
      correlations: whole.correlations
        .map((c) => ({ ...c, legs: c.legs.map((n) => n - 1).filter((i) => i >= 0 && i < slip.legs.length) }))
        .filter((c) => c.legs.length >= 2),
      pathsToVictory: whole.pathsToVictory.slice(0, 5),
      risks: whole.risks.slice(0, 5),
      evPercent: slipEvPercent(slip, trueWinProbability),
      model: BET_MODEL,
    };
    return Response.json(result);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) {
      return Response.json({ error: "Rate limited — try again shortly" }, { status: 429 });
    }
    if (error instanceof Anthropic.APIError) {
      return Response.json({ error: `AI error ${error.status ?? ""}`.trim() }, { status: 502 });
    }
    return Response.json({ error: "AI request failed" }, { status: 502 });
  }
}
