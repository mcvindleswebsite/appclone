import Anthropic from "@anthropic-ai/sdk";

import { checkAccess } from "@/lib/bet/access";
import { americanToDecimal, kalshiDecimal, legDecimal } from "@/lib/bet/engine";
import { historyContext } from "@/lib/bet/history";
import { BET_MODEL } from "@/lib/bet/model";
import { readVault } from "@/lib/bet/store";
import {
  MAX_LEGS,
  type BetLeg,
  type BetSlip,
  type Correlation,
  type HistoryContext,
  type LegAnalysis,
  type LegRating,
  type RiskLevel,
  type SlipAnalysis,
} from "@/types/bet";

export const dynamic = "force-dynamic";
// Legs are researched in parallel, so a 12-leg slip takes about as long as one leg.
export const maxDuration = 120;

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

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(n) ? n : min));
const int = (n: number, min: number, max: number) => clamp(Math.round(n), min, max);

const describeLeg = (leg: BetLeg, n?: number) =>
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

/** Runs one tool-terminated research loop and returns the tool's input, or null. */
const runTool = async <T,>(
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

const researchLeg = async (leg: BetLeg): Promise<LegAnalysis> => {
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
    const [legs, history] = await Promise.all([Promise.all(slip.legs.map(researchLeg)), loadHistory(body.history)]);
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
      model: MODEL,
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
