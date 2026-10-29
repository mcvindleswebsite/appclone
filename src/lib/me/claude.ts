import Anthropic from "@anthropic-ai/sdk";

import { addSpend } from "@/lib/me/store";
import type { ImageInput } from "@/types/me";

/**
 * /me writes on Claude Opus 5.5 ("best"): copying someone's voice is judgment-heavy writing.
 * "Quick" writes on Claude Sonnet 5.5 at about half the price. Both have server-side fallback,
 * so a policy decline re-runs on another model instead of failing. Transcribing screenshots is
 * plain reading, so it runs on Claude Haiku 5.5 (which rejects `fallbacks`, so it goes without).
 * No temperature: current models reject sampling parameters.
 */
export const ME_MODEL = "claude-opus-5-5";
export const QUICK_MODEL = "claude-sonnet-5-5";
export const READ_MODEL = "claude-haiku-5-5";
export type Model = typeof ME_MODEL | typeof QUICK_MODEL | typeof READ_MODEL;

/** Dollars per million tokens. Cache writes are priced off `input` (2x for the 1-hour TTL). */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  [ME_MODEL]: { input: 4, output: 20, cacheRead: 0.2 },
  [QUICK_MODEL]: { input: 2, output: 10, cacheRead: 0.2 },
  [READ_MODEL]: { input: 0.1, output: 0.5, cacheRead: 0.01 },
};
/** Haiku 5.5 costs 5x for prompts over 100K tokens. */
const HAIKU_LONG = { input: 0.5, output: 2.5, cacheRead: 0.05 };

/** What one response cost, from the usage the API reports. */
const costOf = (model: string, usage: Anthropic.Beta.BetaUsage) => {
  const fresh = usage.input_tokens;
  const read = usage.cache_read_input_tokens ?? 0;
  const hour = usage.cache_creation?.ephemeral_1h_input_tokens ?? usage.cache_creation_input_tokens ?? 0;
  const fiveMin = usage.cache_creation?.ephemeral_5m_input_tokens ?? 0;
  const prompt = fresh + read + hour + fiveMin;
  const price = model === READ_MODEL && prompt > 100_000 ? HAIKU_LONG : (PRICES[model] ?? PRICES[ME_MODEL]);
  const millions = fresh * price.input + read * price.cacheRead + hour * price.input * 2 + fiveMin * price.input * 1.25 + usage.output_tokens * price.output;
  return millions / 1_000_000;
};

let cached: Anthropic | null = null;
const client = () => (cached ??= new Anthropic());

export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

export const imageBlocks = (images: ImageInput[]): Anthropic.Beta.BetaImageBlockParam[] =>
  images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.media_type, data: image.data } }));

export class Declined extends Error {}

const call = async (
  system: Anthropic.Beta.BetaTextBlockParam[],
  content: Anthropic.Beta.BetaContentBlockParam[],
  effort: "low" | "medium" | "high",
  schema?: Record<string, unknown>,
  model: Model = ME_MODEL
) => {
  const response = await client().beta.messages.create({
    model,
    max_tokens: 16000,
    ...(model !== READ_MODEL ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    output_config: { effort, ...(schema ? { format: { type: "json_schema", schema } } : {}) },
    system,
    messages: [{ role: "user", content }],
  });
  // Priced by the model that actually answered (a fallback can switch it), and billed even on a decline.
  const cost = costOf(PRICES[response.model] ? response.model : model, response.usage);
  await addSpend(cost).catch(() => null);
  if (response.stop_reason === "refusal") throw new Declined("Declined");
  const text = response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text, cost };
};

/**
 * One call with a JSON-schema response. `stable` is the long, rarely changing part of the
 * system prompt (examples, style guide) and is cached; `volatile` follows the cache point.
 */
export const askJson = async <T>(opts: {
  stable: string;
  volatile?: string;
  content: Anthropic.Beta.BetaContentBlockParam[];
  schema: Record<string, unknown>;
  effort: "low" | "medium" | "high";
  model?: Model;
}): Promise<{ data: T; cost: number }> => {
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: opts.stable, cache_control: { type: "ephemeral", ttl: "1h" } },
    ...(opts.volatile ? [{ type: "text" as const, text: opts.volatile }] : []),
  ];
  const { text, cost } = await call(system, opts.content, opts.effort, opts.schema, opts.model);
  return { data: JSON.parse(text) as T, cost };
};

export const askText = (system: string, content: Anthropic.Beta.BetaContentBlockParam[], effort: "low" | "medium" | "high") =>
  call([{ type: "text", text: system }], content, effort);

/** Maps SDK failures to a JSON error response. */
export const aiError = (error: unknown) => {
  if (error instanceof Declined) return Response.json({ error: "The AI declined that one" }, { status: 422 });
  if (error instanceof Anthropic.RateLimitError) return Response.json({ error: "Rate limited — try again shortly" }, { status: 429 });
  if (error instanceof Anthropic.APIError) return Response.json({ error: `AI error ${error.status ?? ""}`.trim() }, { status: 502 });
  return null;
};
