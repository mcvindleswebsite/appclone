import Anthropic from "@anthropic-ai/sdk";

import { checkAccess } from "@/lib/bet/access";
import type { AiSynthesis, BetSlip, ContextFactors, HistoryInsights, InjuryImpact } from "@/types/bet";

export const dynamic = "force-dynamic";
// Web research plus reasoning can take a while; well under Vercel's limit.
export const maxDuration = 120;

const MODEL = "claude-opus-5-5";
const MAX_TURNS = 4;

const SYSTEM = `You are a sharp, calibrated sports analyst evaluating a single Kalshi event contract.

Research with web search before answering: each side's last 10 games, strength of schedule, the latest injury report (who is out or questionable, and how much they matter), and rest/travel (back-to-backs, short weeks, days since last game). Prefer sources from the last few days and note when information is stale.

Then estimate the true probability that the YES side of the contract resolves. Be calibrated: the market price is a strong prior, so move off it only as far as the evidence justifies. Never inflate a pick to make it look playable.

Fill the factor fields from your research: form as wins in the last 10 games; sosEdge from -5 (the pick faced a much tougher schedule than the opponent) to +5 (the opponent did); injuries 0 none, 1 minor, 2 a key starter out, 3 a star out or several starters; restDiff as the pick's rest days minus the opponent's.

pathsToVictory lists concrete, evidence-backed reasons YES can win; risks lists concrete reasons it can lose. Leave either list short rather than padding it.

The user's betting history is provided only so you can mention relevant tendencies (for example, a losing record on a team or sport) in the summary. Do not shift the probability because of the user's preferences.

When done, call submit_evaluation exactly once.`;

const SUBMIT_TOOL: Anthropic.Beta.BetaTool = {
  name: "submit_evaluation",
  description: "Submit the final evaluation of the contract.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      probability: { type: "number", description: "Probability (0-1) that YES resolves." },
      confidence: { type: "string", enum: ["low", "medium", "high"] },
      summary: { type: "string", description: "2-4 sentences: the read, the key evidence, and any history tendency." },
      pathsToVictory: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
      factors: {
        type: "object",
        properties: {
          pickForm: { type: "integer" },
          oppForm: { type: "integer" },
          sosEdge: { type: "integer" },
          pickInjuries: { type: "integer", enum: [0, 1, 2, 3] },
          oppInjuries: { type: "integer", enum: [0, 1, 2, 3] },
          restDiff: { type: "integer" },
        },
        required: ["pickForm", "oppForm", "sosEdge", "pickInjuries", "oppInjuries", "restDiff"],
        additionalProperties: false,
      },
    },
    required: ["probability", "confidence", "summary", "pathsToVictory", "risks", "factors"],
    additionalProperties: false,
  },
};

type Submission = Omit<AiSynthesis, "model">;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));

const sanitize = (raw: Submission): Submission => {
  const f = raw.factors;
  const injury = (n: number) => clamp(Math.round(n), 0, 3) as InjuryImpact;
  const factors: ContextFactors = {
    pickForm: clamp(Math.round(f.pickForm), 0, 10),
    oppForm: clamp(Math.round(f.oppForm), 0, 10),
    sosEdge: clamp(Math.round(f.sosEdge), -5, 5),
    pickInjuries: injury(f.pickInjuries),
    oppInjuries: injury(f.oppInjuries),
    restDiff: clamp(Math.round(f.restDiff), -7, 7),
  };
  return {
    ...raw,
    probability: clamp(raw.probability, 0.01, 0.99),
    pathsToVictory: raw.pathsToVictory.slice(0, 5),
    risks: raw.risks.slice(0, 5),
    factors,
  };
};

const describe = (slip: BetSlip, factors: ContextFactors, insights: HistoryInsights | null) => {
  const lines = [
    `Sport: ${slip.sport}`,
    `Matchup: ${slip.matchup}`,
    `Market: ${slip.marketTitle}`,
    `YES side is on: ${slip.pick}`,
    `Kalshi YES price: ${slip.yesPrice}¢ (NO ≈ ${100 - slip.yesPrice}¢)`,
    slip.americanOdds ? `Sportsbook odds for the pick: ${slip.americanOdds > 0 ? "+" : ""}${slip.americanOdds}` : null,
    `Today's date: ${new Date().toDateString()}`,
    `User's own factor estimates (may be rough): ${JSON.stringify(factors)}`,
  ];
  if (insights && insights.total > 0) {
    const fmt = (rows: { label: string; count: number; wins: number; losses: number }[]) =>
      rows.slice(0, 5).map((r) => `${r.label} ${r.wins}-${r.losses} (${r.count} picks)`).join("; ");
    lines.push(
      `User history: ${insights.total} picks, ${insights.record.wins}-${insights.record.losses} settled.`,
      `By sport: ${fmt(insights.sports.map((r) => ({ ...r, label: r.sport })))}`,
      `Most-picked teams: ${fmt(insights.teams.map((r) => ({ ...r, label: r.team })))}`
    );
  }
  return lines.filter(Boolean).join("\n");
};

export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI not configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as {
    slip?: BetSlip;
    factors?: ContextFactors;
    insights?: HistoryInsights | null;
  } | null;
  if (!body?.slip || !body.factors || JSON.stringify(body).length > 20_000) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: describe(body.slip, body.factors, body.insights ?? null) },
  ];

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: SYSTEM,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 6 }, SUBMIT_TOOL],
        messages,
      });

      if (response.stop_reason === "refusal") {
        return Response.json({ error: "The model declined this request" }, { status: 502 });
      }

      const submission = response.content.find(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === SUBMIT_TOOL.name
      );
      if (submission) {
        const result: AiSynthesis = { ...sanitize(submission.input as Submission), model: response.model };
        return Response.json(result);
      }

      messages.push({ role: "assistant", content: response.content });
      // A paused server-tool turn resumes as-is; otherwise ask for the submission.
      if (response.stop_reason !== "pause_turn") {
        messages.push({ role: "user", content: "Call submit_evaluation with your final evaluation now." });
      }
    }
    return Response.json({ error: "No evaluation returned" }, { status: 502 });
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
