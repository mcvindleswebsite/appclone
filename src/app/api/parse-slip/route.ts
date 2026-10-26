import Anthropic from "@anthropic-ai/sdk";

import { checkAccess } from "@/lib/bet/access";
import { BET_MODEL } from "@/lib/bet/model";
import { detectSport } from "@/lib/bet/parse-slip";
import { MAX_LEGS, type BetLeg, type BetSlip } from "@/types/bet";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];
/** ~4MB of base64, under Vercel's request body limit. */
const MAX_IMAGE_CHARS = 4_000_000;

const SYSTEM = `You read screenshots of sports bet slips — mostly Kalshi combos and markets, sometimes sportsbook parlays — and transcribe every leg exactly as shown. You never evaluate the bets.

Kalshi combo slips stack one block per leg, top to bottom, and the block repeats:
  Matchup header      e.g. "Bournemouth vs Leeds" (sometimes with a time or league)
  Selection           e.g. "Bournemouth to win", "Over 2.5 goals", "Bukayo Saka anytime goalscorer"
  Implied %           e.g. "46%" — the market's chance for that selection, often right-aligned on the selection's line

Read every block in order until the slip ends — a slip can have 1 to 12 legs, and stopping after the first block is the main mistake to avoid. A game can have several selections (a same-game parlay); each selection is its own leg with that game's matchup.

For each leg:
- matchup: the game, as "Team A vs Team B".
- market: the selection text as written ("Bournemouth to win").
- pick: who or what the selection is on — the team or player ("Bournemouth", "Bukayo Saka"); for totals and both-teams-to-score, repeat the selection.
- impliedPercent: the percentage shown for that selection as a number (46 for "46%"), or a ¢ price as cents. null if none is shown.
- americanOdds: sportsbook odds shown for the leg (e.g. -115, +120), else null.

Also report the whole slip's own chance or price if shown ("8% chance" → 8, "Yes 8¢" → 8) as comboPercent, and sportsbook parlay odds as comboOdds. Ignore Cost, Payout, buttons, and navigation.

If the image isn't a bet slip, return no legs. Call submit_slip exactly once.`;

const SUBMIT: Anthropic.Beta.BetaTool = {
  name: "submit_slip",
  description: "Submit every leg read from the screenshot, top to bottom.",
  strict: true,
  input_schema: {
    type: "object",
    properties: {
      legs: {
        type: "array",
        items: {
          type: "object",
          properties: {
            matchup: { type: "string" },
            market: { type: "string" },
            pick: { type: "string" },
            impliedPercent: { type: ["number", "null"] },
            americanOdds: { type: ["integer", "null"] },
          },
          required: ["matchup", "market", "pick", "impliedPercent", "americanOdds"],
          additionalProperties: false,
        },
      },
      comboPercent: { type: ["number", "null"] },
      comboOdds: { type: ["integer", "null"] },
    },
    required: ["legs", "comboPercent", "comboOdds"],
    additionalProperties: false,
  },
};

interface Submission {
  legs: { matchup: string; market: string; pick: string; impliedPercent: number | null; americanOdds: number | null }[];
  comboPercent: number | null;
  comboOdds: number | null;
}

/** A market's % chance is the price its contract trades at: 46% → 46¢. */
const toCents = (n: number | null) => (n !== null && Number.isFinite(n) && n > 0 && n < 100 ? Math.min(99, Math.max(1, Math.round(n))) : null);
const toOdds = (n: number | null) => (n !== null && Number.isFinite(n) && Math.abs(n) >= 100 ? Math.round(n) : null);

/**
 * Reads a bet slip screenshot with Claude vision and returns its legs. The browser falls
 * back to on-device Tesseract OCR when this isn't available.
 */
export async function POST(request: Request) {
  const denied = checkAccess(request);
  if (denied) return denied;
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "AI not configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { image?: unknown; mediaType?: unknown } | null;
  const image = typeof body?.image === "string" ? body.image : "";
  const mediaType = MEDIA_TYPES.find((t) => t === body?.mediaType) as MediaType | undefined;
  if (!image || !mediaType || image.length > MAX_IMAGE_CHARS) {
    return Response.json({ error: "Send a JPEG, PNG, or WebP screenshot under 3MB" }, { status: 400 });
  }

  const client = new Anthropic({ timeout: 50_000, maxRetries: 1 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    {
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: image } },
        { type: "text", text: "Transcribe every leg on this slip." },
      ],
    },
  ];

  try {
    for (let turn = 0; turn < 2; turn++) {
      const response = await client.beta.messages.create({
        model: BET_MODEL,
        max_tokens: 8000,
        output_config: { effort: "low" },
        system: SYSTEM,
        tools: [SUBMIT],
        messages,
      });
      if (response.stop_reason === "refusal") break;

      const call = response.content.find(
        (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === SUBMIT.name
      );
      if (call) {
        const raw = call.input as Submission;
        const legs: BetLeg[] = raw.legs.slice(0, MAX_LEGS).map((l) => ({
          sport: detectSport(`${l.matchup} ${l.market} ${l.pick}`),
          matchup: l.matchup.trim(),
          market: l.market.trim(),
          pick: l.pick.trim(),
          price: toCents(l.impliedPercent),
          americanOdds: toOdds(l.americanOdds),
        }));
        const slip: BetSlip = {
          legs,
          comboPrice: legs.length > 1 ? toCents(raw.comboPercent) : null,
          comboOdds: legs.length > 1 ? toOdds(raw.comboOdds) : null,
        };
        return Response.json(slip);
      }
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: "Call submit_slip with every leg now." });
    }
    return Response.json({ error: "Couldn't read that screenshot" }, { status: 502 });
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return Response.json({ error: "Rate limited" }, { status: 429 });
    if (error instanceof Anthropic.APIError) return Response.json({ error: `AI error ${error.status ?? ""}`.trim() }, { status: 502 });
    return Response.json({ error: "Vision request failed" }, { status: 502 });
  }
}
