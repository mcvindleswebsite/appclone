import { askJson, Declined, imageBlocks, ME_MODEL, READ_MODEL } from "@/lib/me/claude";
import { EXTRACT_SCHEMA, EXTRACT_SYSTEM } from "@/lib/me/prompts";
import { newId } from "@/lib/me/store";
import type { ChatTurn, MeSource, Situation, StyleExample } from "@/types/me";

/** A long screenshot can hold well over a hundred bubbles. */
const MAX_TURNS = 300;

export const cleanTurns = (value: unknown): ChatTurn[] =>
  (Array.isArray(value) ? value : [])
    .filter((t): t is ChatTurn => !!t && (t.who === "me" || t.who === "them") && typeof t.text === "string" && !!t.text.trim())
    .slice(0, MAX_TURNS)
    .map((t) => ({ who: t.who, text: t.text.slice(0, 2000) }));

/**
 * Reads one screenshot or paste into conversations, on the cheap model. One source per call,
 * so the model gives each screenshot its full attention instead of skimming a batch. If Haiku
 * declines a screenshot, Opus (with its own fallback) reads that one instead.
 */
export const extractSource = async (source: MeSource): Promise<StyleExample[]> => {
  const ask = (model: typeof READ_MODEL | typeof ME_MODEL) =>
    askJson<{ conversations: { situation: Situation; turns: ChatTurn[] }[] }>({
      stable: EXTRACT_SYSTEM,
      content: source.image
        ? [...imageBlocks([source.image]), { type: "text", text: "Transcribe every message in this screenshot." }]
        : [{ type: "text", text: `Pasted text:\n${source.text ?? ""}` }],
      schema: EXTRACT_SCHEMA,
      effort: "medium",
      model,
    });
  const read = await ask(READ_MODEL).catch((error: unknown) => {
    if (error instanceof Declined) return ask(ME_MODEL);
    throw error;
  });
  return read.conversations
    .map((c, i) => ({
      id: newId(),
      source: source.image ? ("screenshot" as const) : ("text" as const),
      situation: c.situation,
      turns: cleanTurns(c.turns),
      createdAt: source.createdAt + i,
      sourceId: source.id,
    }))
    .filter((e) => e.turns.some((t) => t.who === "me"));
};
