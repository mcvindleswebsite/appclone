import Anthropic from "@anthropic-ai/sdk";

import { BET_MODEL } from "@/lib/bet/model";
import type { BetLeg, LegAnalysis } from "@/types/bet";

/**
 * Per-leg AI research (web search on Claude Haiku): trend and line hit rate, matchup and
 * schedule, injuries, and opponent-tier/trap-game profiling. Shared by the slip evaluator
 * and the soccer scanner.
 */
const MODEL = BET_MODEL;
const MAX_TURNS = 3;

const client = () => new Anthropic({ timeout: 90_000, maxRetries: 1 });

/* --------------------------------- Per leg --------------------------------- */

const LEG_SYSTEM = `You are a sharp, calibrated sports analyst rating ONE leg of a bet slip. Research it with web search, preferring sources from the last few days:

1. Recent 10-game trend and line hit rate. For a player prop, count how many of the player's last 10 games cleared this exact line. For a team market, count how many of the last 10 would have hit (wins for a moneyline, covers for a spread, overs for a total).
2. Matchup and strength of schedule. Rank the opposing defense against this stat or team (1 = the toughest matchup in the league).
3. Injuries and usage shifts: absences, minutes or role changes, and whether each helps or hurts this leg.
4. Opponent tier and playstyle. A team's overall record hides how it does against different kinds of opponent, so split it:
   a) Against top-tier or aggressive sides (title contenders, high-pressing or high-line teams — in soccer, sides like Man City or Chelsea): does this team lock in and raise its level, or get overrun?
   b) Against low-block, bottom-table, or otherwise lower-tier sides: does it keep winning comfortably, or does it have a history of dropping points and failing to break down deep, compact opponents?
   Use results from this season and last against opponents of the same tier and style as today's. Classify today's opponent's tier and playstyle, then report this team's record in that bucket (e.g. "W2 D3 L1 vs bottom-six low blocks this season, 1.1 xG per game").

Flag the spots this exposes:
- trapGame: this leg BACKS a favorite (to win, cover, or score heavily) that has a proven record of underperforming against opponents like today's lower-tier one — repeated dropped points, narrow escapes, or failing to cover against weaker, deep-sitting sides — even though its overall record looks strong on paper. Base it on a real pattern across several games, not one result. If the leg instead fades that favorite (backs the underdog, the draw, or the under), trapGame stays false: mention the pattern in the note, because it supports the leg.
- playUpSpot: this leg backs an underdog that systematically elevates its level against top-tier opposition (e.g. strong results against the top four) — a high-value underdog spot.
Leave both false when the evidence isn't there, and for props or sports where opponent tier doesn't apply.

Estimate the true probability the leg hits. When a market price is given it's a strong prior; move off it only as far as the evidence justifies. Often there's no price — the user typed the leg in — so build the probability from your research alone, including what books and markets are currently pricing it at if you find that.

Rate the leg:
- STRONG VALUE: your probability is clearly above what the price implies (with no price given, above what this selection is typically priced at), and the trend, matchup, and usage all support it.
- NEUTRAL: roughly fairly priced, or mixed evidence.
- BUM PICK: likely to miss or clearly overpriced — a poor 10-game hit rate, a bad defensive matchup, a usage reduction, or similar. A leg backing a favorite in a trap game is always a BUM PICK: a proven record of struggling against this kind of lower-tier opponent outweighs a strong overall record.

reason is one sentence. For a BUM PICK it must name the specific reason (e.g. "Cleared 24.5 in only 3 of his last 10 and faces the league's #2 defense vs PGs." or "Trap game: won only 2 of 7 against bottom-half low blocks this season despite sitting 2nd.").

When done, call submit_leg exactly once.`;

const SUBMIT_LEG: Anthropic.Beta.BetaTool = {
  name: "submit_leg",
  description: "Submit the rating for this leg.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      rating: { type: "string", enum: ["STRONG VALUE", "NEUTRAL", "BUM PICK"] },
      probability: { type: "number", description: "Probability (0-1) the leg hits." },
      hitConfidence: { type: "integer", description: "1-10 confidence in the probability." },
      reason: { type: "string", description: "One sentence." },
      last10: {
        type: "object",
        properties: {
          hits: { type: "integer" },
          games: { type: "integer" },
          detail: { type: "string", description: "Short trend note, e.g. 'Avg 27.1 pts, 36 min'." },
        },
        required: ["hits", "games", "detail"],
        additionalProperties: false,
      },
      matchup: {
        type: "object",
        properties: {
          rank: { type: "integer", description: "Opposing defense rank vs this stat; 1 = toughest." },
          outOf: { type: "integer" },
          label: { type: "string" },
        },
        required: ["rank", "outOf", "label"],
        additionalProperties: false,
      },
      injuries: {
        type: "array",
        items: {
          type: "object",
          properties: {
            note: { type: "string" },
            effect: { type: "string", enum: ["helps", "hurts", "neutral"] },
          },
          required: ["note", "effect"],
          additionalProperties: false,
        },
      },
      opponentTier: {
        type: "object",
        properties: {
          note: {
            type: "string",
            description: "Today's opponent tier and style, and this team's record against that bucket. Empty if not applicable.",
          },
          trapGame: {
            type: "boolean",
            description: "The leg backs a favorite with a proven record of underperforming vs this lower tier.",
          },
          playUpSpot: {
            type: "boolean",
            description: "The leg backs an underdog that systematically elevates vs top-tier opponents.",
          },
        },
        required: ["note", "trapGame", "playUpSpot"],
        additionalProperties: false,
      },
    },
    required: ["rating", "probability", "hitConfidence", "reason", "last10", "matchup", "injuries", "opponentTier"],
    additionalProperties: false,
  },
};

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
export const int = (n: number, min: number, max: number) => clamp(Math.round(n), min, max);

export const describeLeg = (leg: BetLeg, n?: number) =>
  [
    n !== undefined ? `Leg ${n}` : null,
    `Sport: ${leg.sport}`,
    leg.matchup && `Matchup: ${leg.matchup}`,
    `Market / stat line: ${leg.market || leg.matchup}`,
    `Pick: ${leg.pick || "(see market)"}`,
    leg.price ? `Kalshi price: ${leg.price}¢` : null,
    leg.americanOdds ? `Sportsbook odds: ${leg.americanOdds > 0 ? "+" : ""}${leg.americanOdds}` : null,
  ]
    .filter(Boolean)
    .join("\n");

/** Runs one tool-terminated research loop and returns the tool's input, or null. */
export const runTool = async <T,>(
  system: string,
  tool: Anthropic.Beta.BetaTool,
  prompt: string,
  options: { webSearches: number; effort: "low" | "medium" }
): Promise<T | null> => {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  const tools: Anthropic.Beta.BetaToolUnion[] = [tool];
  if (options.webSearches > 0) tools.unshift({ type: "web_search_20250305", name: "web_search", max_uses: options.webSearches });

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: options.effort },
      system,
      tools,
      messages,
    });
    if (response.stop_reason === "refusal") return null;

    const call = response.content.find(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === tool.name
    );
    if (call) return call.input as T;

    messages.push({ role: "assistant", content: response.content });
    // A paused server-tool turn resumes as-is; otherwise ask for the submission.
    if (response.stop_reason !== "pause_turn") {
      messages.push({ role: "user", content: `Call ${tool.name} with your final answer now.` });
    }
  }
  return null;
};

const placeholder = (leg: BetLeg): LegAnalysis => ({
  rating: "NEUTRAL",
  probability: leg.price ? leg.price / 100 : 0.5,
  hitConfidence: 1,
  reason: "Research for this leg failed — rated on price alone.",
  last10: { hits: 0, games: 0, detail: "No data" },
  matchup: { rank: 0, outOf: 0, label: "No data" },
  injuries: [],
  opponentTier: { note: "", trapGame: false, playUpSpot: false },
  researched: false,
});

export const researchLeg = async (leg: BetLeg): Promise<LegAnalysis> => {
  try {
    const raw = await runTool<Omit<LegAnalysis, "researched">>(LEG_SYSTEM, SUBMIT_LEG, `${describeLeg(leg)}\nToday's date: ${new Date().toDateString()}`, {
      webSearches: 3,
      effort: "low",
    });
    if (!raw) return placeholder(leg);
    const games = int(raw.last10.games, 0, 20);
    const outOf = int(raw.matchup.outOf, 1, 64);
    return {
      // A favorite in a proven trap game is a bum pick however good its overall record.
      rating: raw.opponentTier.trapGame ? "BUM PICK" : raw.rating,
      probability: clamp(raw.probability, 0.01, 0.99),
      hitConfidence: int(raw.hitConfidence, 1, 10),
      reason: raw.reason,
      last10: { ...raw.last10, games, hits: int(raw.last10.hits, 0, games) },
      matchup: { ...raw.matchup, outOf, rank: int(raw.matchup.rank, 1, outOf) },
      injuries: raw.injuries.slice(0, 5),
      opponentTier: raw.opponentTier,
      researched: true,
    };
  } catch {
    return placeholder(leg);
  }
};
