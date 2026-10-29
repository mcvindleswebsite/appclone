import Anthropic from "@anthropic-ai/sdk";

import { BET_MODEL, DEEP_MODEL } from "@/lib/bet/model";
import type { BetLeg, LegAnalysis } from "@/types/bet";

/**
 * Per-leg AI research (web search on Claude Haiku): trend and line hit rate, matchup and
 * schedule, injuries, and opponent-tier/trap-game profiling. Shared by the slip evaluator
 * and the soccer and basketball scanner, whose picks get an on-demand deep pass on DEEP_MODEL.
 */
const MAX_TURNS = 3;
/** The on-demand deep check: the stronger model, one more search than the screen, verified data. */
const DEEP = { webSearches: 3, effort: "low" as const };

const client = () => new Anthropic({ timeout: 90_000, maxRetries: 1 });

/* --------------------------------- Per leg --------------------------------- */

const LEG_SYSTEM = `You are a sharp, calibrated sports analyst rating ONE leg of a bet slip. Research it with web search, preferring sources from the last few days:

1. Recent 10-game trend and line hit rate. For a player prop, count how many of the player's last 10 games cleared this exact line. For a team market, count how many of the last 10 would have hit (wins for a moneyline, covers for a spread, overs for a total).
2. Matchup and strength of schedule. Rank the opposing defense against this stat or team (1 = the toughest matchup in the league).
3. Injuries and usage shifts: absences, minutes or role changes, and whether each helps or hurts this leg. In basketball, also check rest: back-to-backs, games in the last few nights, travel, and stars listed questionable or on load management (the injury report can change up to tip-off).
4. Opponent tier and playstyle. A team's overall record hides how it does against different kinds of opponent, so split it:
   a) Against top-tier or aggressive sides (title contenders, high-pressing or high-line teams — in soccer, sides like Man City or Chelsea; in basketball, top-of-the-standings teams and elite defenses): does this team lock in and raise its level, or get overrun?
   b) Against low-block, bottom-table, or otherwise lower-tier sides: does it keep winning comfortably, or does it have a history of dropping points and failing to break down deep, compact opponents (in basketball: playing down to bad teams, blown leads, resting starters)?
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

Grounding rules — these override everything above:
- Every number you report (records, hit rates, ranks, injuries, head-to-head results) must come from a search result you read in this research. Never fill a gap from memory, never estimate a stat, and never invent a player, injury, or result. When a stat isn't found, report it as unknown (0 games, rank 0, an empty note) rather than guessing.
- reasoningStats lists the concrete metrics your rating rests on — at least two from your research, such as the head-to-head record, recent form, league position, goals for/against, key player status, or what other books price the leg at. Each has the metric, its value, and its source (publication or site, with the date when shown). Don't list the Kalshi price; the app adds the line value itself.
- If you can't find at least two current, verifiable stats about this fixture — or what you found is stale, contradictory, or about a different match — set dataSufficient to false, rating NEUTRAL, hitConfidence 1-3, probability equal to the market price (or 0.5 with no price), and say in reason what was missing. An honest "insufficient data" is always better than a confident guess.
- hitConfidence is strict: 8-10 only when several independent, recent sources agree; 4-7 for solid but partial evidence; 1-3 for thin evidence.

Verified match data from a football (soccer) data provider may be given in <verified_data>. Treat it as fact: prefer it over search snippets when they conflict, and cite its numbers with that provider as the source (they count toward reasoningStats). It doesn't replace research — still check team news, motivation, and anything it doesn't cover.

The bettor's Bet Vault record may be given in <bettor_history>. It describes the bettor's past results, not the teams, so it is never evidence about this fixture and must not change your probability. Use it only to:
- lower hitConfidence for a market type, league, or price range where the bettor has a proven losing record, and raise it at most one point where they have a proven winning one, when your research independently supports the leg;
- set historyFlag to one sentence naming the specific pattern that applies (e.g. "Your 4+ leg parlays are 1-9; this favorite at 81¢ fits the 75¢+ legs you hit only 58% of."). Leave historyFlag empty when no pattern applies or no history is given.

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
      dataSufficient: {
        type: "boolean",
        description: "False when fewer than two current, verifiable stats about this fixture were found.",
      },
      reasoningStats: {
        type: "array",
        description: "The concrete metrics the rating rests on, each from a search result read in this research.",
        items: {
          type: "object",
          properties: {
            metric: { type: "string", description: "e.g. 'Head-to-head, last 5 meetings'." },
            value: { type: "string", description: "e.g. 'W3 D1 L1'." },
            source: { type: "string", description: "Publication or site, with the date when shown." },
          },
          required: ["metric", "value", "source"],
          additionalProperties: false,
        },
      },
      historyFlag: {
        type: "string",
        description: "One sentence on a Bet Vault pattern that applies to this leg; empty when none does.",
      },
    },
    required: [
      "rating",
      "probability",
      "hitConfidence",
      "reason",
      "last10",
      "matchup",
      "injuries",
      "opponentTier",
      "dataSufficient",
      "reasoningStats",
      "historyFlag",
    ],
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

/**
 * Runs one tool-terminated research loop and returns the tool's input, or null. Each call
 * is a fresh, stateless request: the system prompt and the single user prompt are all the
 * model sees, plus its own tool turns within this loop. No sampling parameters are sent —
 * Claude Haiku 5.5 rejects a non-default temperature, and API version 2026-10-21 rejects
 * temperature/top_p/top_k on every model — so consistency comes from low effort, a strict
 * tool schema, and the grounding rules instead. `sources` collects the URLs of every web
 * search result the model read.
 */
export const runTool = async <T,>(
  system: string,
  tool: Anthropic.Beta.BetaTool,
  prompt: string,
  options: { webSearches: number; effort: "low" | "medium"; sources?: string[]; deep?: boolean }
): Promise<T | null> => {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: prompt }];
  const tools: Anthropic.Beta.BetaToolUnion[] = [tool];
  if (options.webSearches > 0) {
    // Sonnet takes the dynamic-filtering search; Haiku the basic one.
    tools.unshift(
      options.deep
        ? { type: "web_search_20260209", name: "web_search", max_uses: options.webSearches }
        : { type: "web_search_20250305", name: "web_search", max_uses: options.webSearches }
    );
  }

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client().beta.messages.create({
      model: options.deep ? DEEP_MODEL : BET_MODEL,
      max_tokens: 16000,
      output_config: { effort: options.effort },
      system,
      tools,
      messages,
      // Sonnet only: a policy decline re-runs on a fallback model inside the same call.
      ...(options.deep ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    });
    if (response.stop_reason === "refusal") return null;

    for (const block of response.content) {
      // A search error comes back as an object, a success as a list of results.
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        options.sources?.push(...block.content.map((r) => r.url));
      }
    }

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
  dataSufficient: false,
  reasoningStats: [],
  historyFlag: "",
  researched: false,
});

/** Fewer cited stats than this and the leg is treated as insufficient data. */
const MIN_STATS = 2;
/** Confidence ceiling for a leg the research couldn't ground. */
const THIN_CONFIDENCE = 3;

/**
 * Researches one leg in a fresh, stateless call. `history` is the bettor's Bet Vault profile
 * (from describeVaultProfile), passed as structured context on every call rather than kept in
 * any conversation. `deep` runs the finalist pass on DEEP_MODEL; `facts` is verified match
 * data (API-Football) that grounds the leg even if search turns up little.
 */
export const researchLeg = async (
  leg: BetLeg,
  history?: string,
  options: { deep?: boolean; facts?: string } = {}
): Promise<LegAnalysis> => {
  try {
    const sources: string[] = [];
    const prompt = [
      describeLeg(leg),
      `Today's date: ${new Date().toDateString()}`,
      options.facts ? `\n<verified_data source="API-Football">\n${options.facts}\n</verified_data>` : null,
      history ? `\n<bettor_history>\n${history}\n</bettor_history>` : null,
    ]
      .filter(Boolean)
      .join("\n");
    const raw = await runTool<Omit<LegAnalysis, "researched">>(LEG_SYSTEM, SUBMIT_LEG, prompt, {
      ...(options.deep ? DEEP : { webSearches: 2, effort: "low" as const }),
      deep: options.deep,
      sources,
    });
    if (options.facts) sources.push("api-football");
    if (!raw) return placeholder(leg);
    const games = int(raw.last10.games, 0, 20);
    const outOf = int(raw.matchup.outOf, 1, 64);
    const reasoningStats = (raw.reasoningStats ?? [])
      .filter((s) => s.metric.trim() && s.value.trim())
      .slice(0, 8)
      .map((s) => ({ metric: s.metric.slice(0, 80), value: s.value.slice(0, 80), source: s.source.slice(0, 80) }));
    // Grounding is checked here, not taken on trust: no search results read, or too few
    // cited stats, means the model had nothing verifiable to rate the leg on.
    const grounded = raw.dataSufficient !== false && sources.length > 0 && reasoningStats.length >= MIN_STATS;
    if (!grounded) {
      return {
        ...placeholder(leg),
        reason: `Insufficient data: ${raw.dataSufficient === false ? raw.reason : "too few verifiable stats were found for this fixture"} — rated on price alone.`,
        hitConfidence: Math.min(THIN_CONFIDENCE, int(raw.hitConfidence, 1, 10)),
        reasoningStats,
        historyFlag: raw.historyFlag ?? "",
        researched: true,
      };
    }
    return {
      // A favorite in a proven trap game is a bum pick however good its overall record.
      rating: raw.opponentTier.trapGame ? "BUM PICK" : raw.rating,
      probability: clamp(raw.probability, 0.01, 0.99),
      hitConfidence: int(raw.hitConfidence, 1, 10),
      dataSufficient: true,
      reasoningStats,
      historyFlag: (raw.historyFlag ?? "").slice(0, 300),
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
