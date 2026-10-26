import Anthropic from "@anthropic-ai/sdk";

import { checkAccess } from "@/lib/bet/access";
import { kalshiFee } from "@/lib/bet/engine";
import type { AiSynthesis, BetSlip, InjuryFactor, RiskLevel } from "@/types/bet";

export const dynamic = "force-dynamic";
// Web research plus reasoning can take a while; well under Vercel's limit.
export const maxDuration = 120;

const MODEL = "claude-opus-5-5";
const MAX_TURNS = 4;

const SYSTEM = `You are a sharp, calibrated sports analyst evaluating a single Kalshi event contract. You get only the bet itself: who the YES side is on (a team or a player), the market or stat line, and the price. Research everything else yourself with web search, preferring sources from the last few days.

Work out three things:

1. Recent 10-game trend and line hit rate. For a player prop, count how many of the player's last 10 games cleared this exact line, and note the trend (minutes, role, averages). For a team market, count how many of the last 10 games would have hit (wins for a moneyline, covers for a spread, overs for a total).
2. Matchup and strength of schedule. Rank the opposing defense against this stat or team (1 = the toughest matchup in the league), and judge whether either side's recent results are inflated or deflated by the schedule.
3. Injuries and usage shifts. List the injuries, absences, and role or minutes changes that move this bet, and whether each one helps or hurts the YES side.

Then estimate the true probability that YES resolves. The market price is a strong prior; move off it only as far as the evidence justifies, and never inflate a pick to make it look playable.

Also rate:
- hitConfidence, 1-10: how sure you are of your probability estimate (data quality, consistency, how settled the injury news is).
- riskRating, 1-5: the bet's variance. 1 is a high-floor, stable outcome; 5 is volatile and depends on a few swingy events.

reasoning must be exactly two sentences: the core case, then the main risk. pathsToVictory lists concrete, evidence-backed ways YES hits; risks lists concrete ways it misses. Keep both lists short rather than padding them.

When done, call submit_evaluation exactly once.`;

const SUBMIT_TOOL: Anthropic.Beta.BetaTool = {
  name: "submit_evaluation",
  description: "Submit the final evaluation of the contract.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      probability: { type: "number", description: "Probability (0-1) that YES resolves." },
      hitConfidence: { type: "integer", description: "1-10 confidence in the probability estimate." },
      riskRating: { type: "integer", enum: [1, 2, 3, 4, 5] },
      reasoning: { type: "string", description: "Exactly two sentences: the case, then the main risk." },
      last10: {
        type: "object",
        properties: {
          hits: { type: "integer", description: "Games of the last `games` that hit this line." },
          games: { type: "integer", description: "Games counted, normally 10." },
          detail: { type: "string", description: "Short trend note, e.g. 'Avg 27.1 pts, 36 min'." },
        },
        required: ["hits", "games", "detail"],
        additionalProperties: false,
      },
      matchup: {
        type: "object",
        properties: {
          rank: { type: "integer", description: "Opposing defense rank vs this stat; 1 = toughest matchup." },
          outOf: { type: "integer", description: "Teams in the league." },
          label: { type: "string", description: "Short context, e.g. '28th vs PGs, soft schedule'." },
        },
        required: ["rank", "outOf", "label"],
        additionalProperties: false,
      },
      injuries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            note: { type: "string", description: "e.g. 'Embiid OUT (knee)' or 'Usage up 4% since trade'." },
            effect: { type: "string", enum: ["helps", "hurts", "neutral"] },
          },
          required: ["note", "effect"],
          additionalProperties: false,
        },
      },
      pathsToVictory: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } },
    },
    required: [
      "probability",
      "hitConfidence",
      "riskRating",
      "reasoning",
      "last10",
      "matchup",
      "injuries",
      "pathsToVictory",
      "risks",
    ],
    additionalProperties: false,
  },
};

type Submission = Omit<AiSynthesis, "model" | "evPercent">;

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
const int = (n: number, min: number, max: number) => clamp(Math.round(n), min, max);

const sanitize = (raw: Submission): Submission => {
  const games = int(raw.last10.games, 0, 20);
  const outOf = int(raw.matchup.outOf, 1, 64);
  return {
    ...raw,
    probability: clamp(raw.probability, 0.01, 0.99),
    hitConfidence: int(raw.hitConfidence, 1, 10),
    riskRating: int(raw.riskRating, 1, 5) as RiskLevel,
    last10: { ...raw.last10, games, hits: int(raw.last10.hits, 0, games) },
    matchup: { ...raw.matchup, outOf, rank: int(raw.matchup.rank, 1, outOf) },
    injuries: raw.injuries.slice(0, 6) as InjuryFactor[],
    pathsToVictory: raw.pathsToVictory.slice(0, 5),
    risks: raw.risks.slice(0, 5),
  };
};

/** EV of buying YES at the slip price, after Kalshi's fee, as a % of the stake. Computed, not model-reported. */
const yesEvPercent = (probability: number, yesPrice: number) => {
  const price = yesPrice / 100;
  const fee = kalshiFee(price);
  return ((probability - price - fee) / (price + fee)) * 100;
};

const describe = (slip: BetSlip) =>
  [
    `Sport: ${slip.sport}`,
    slip.matchup && `Matchup: ${slip.matchup}`,
    `Market / stat line: ${slip.marketTitle || slip.matchup}`,
    `YES side is on: ${slip.pick || "(see market)"}`,
    `Kalshi YES price: ${slip.yesPrice}¢ (NO ≈ ${100 - slip.yesPrice}¢)`,
    slip.americanOdds ? `Sportsbook odds for the pick: ${slip.americanOdds > 0 ? "+" : ""}${slip.americanOdds}` : null,
    `Today's date: ${new Date().toDateString()}`,
  ]
    .filter(Boolean)
    .join("\n");

const isSlip = (value: unknown): value is BetSlip => {
  if (!value || typeof value !== "object") return false;
  const s = value as Partial<BetSlip>;
  return (
    typeof s.yesPrice === "number" &&
    s.yesPrice >= 1 &&
    s.yesPrice <= 99 &&
    [s.sport, s.matchup, s.marketTitle, s.pick].every((f) => typeof f === "string" && f.length <= 300)
  );
};

export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI not configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { slip?: unknown } | null;
  if (!isSlip(body?.slip)) return Response.json({ error: "Invalid bet details" }, { status: 400 });
  const slip = body.slip;

  const client = new Anthropic();
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: describe(slip) }];

  try {
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const response = await client.beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: "medium" },
        system: SYSTEM,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 8 }, SUBMIT_TOOL],
        messages,
      });

      if (response.stop_reason === "refusal") {
        return Response.json({ error: "The model declined this request" }, { status: 502 });
      }

      const submission = response.content.find(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === SUBMIT_TOOL.name
      );
      if (submission) {
        const clean = sanitize(submission.input as Submission);
        const result: AiSynthesis = {
          ...clean,
          evPercent: Math.round(yesEvPercent(clean.probability, slip.yesPrice) * 10) / 10,
          model: response.model,
        };
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
