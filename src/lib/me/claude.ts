import Anthropic from "@anthropic-ai/sdk";

import type { ImageInput } from "@/types/me";

/**
 * /me writes on Claude Opus 5.5: copying someone's voice is judgment-heavy writing. Server-side
 * fallback is on there, so a policy decline re-runs on another model instead of failing.
 * Transcribing screenshots is plain reading, so it runs on Claude Haiku 5.5 at a fraction of the
 * cost (Haiku rejects `fallbacks`, so it goes without). No temperature: current models reject
 * sampling parameters.
 */
export const ME_MODEL = "claude-opus-5-5";
export const READ_MODEL = "claude-haiku-5-5";
type Model = typeof ME_MODEL | typeof READ_MODEL;

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
    ...(model === ME_MODEL ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
    output_config: { effort, ...(schema ? { format: { type: "json_schema", schema } } : {}) },
    system,
    messages: [{ role: "user", content }],
  });
  if (response.stop_reason === "refusal") throw new Declined("Declined");
  return response.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
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
}): Promise<T> => {
  const system: Anthropic.Beta.BetaTextBlockParam[] = [
    { type: "text", text: opts.stable, cache_control: { type: "ephemeral", ttl: "1h" } },
    ...(opts.volatile ? [{ type: "text" as const, text: opts.volatile }] : []),
  ];
  return JSON.parse(await call(system, opts.content, opts.effort, opts.schema, opts.model)) as T;
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
