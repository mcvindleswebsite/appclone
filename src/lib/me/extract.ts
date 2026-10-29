import { askJson, imageBlocks } from "@/lib/me/claude";
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
 * Reads one screenshot or paste into conversations. One source per call, so the model gives
 * each screenshot its full attention instead of skimming a batch.
 */
export const extractSource = async (source: MeSource): Promise<StyleExample[]> => {
  const read = await askJson<{ conversations: { situation: Situation; turns: ChatTurn[] }[] }>({
    stable: EXTRACT_SYSTEM,
    content: source.image
      ? [...imageBlocks([source.image]), { type: "text", text: "Transcribe every message in this screenshot." }]
      : [{ type: "text", text: `Pasted text:\n${source.text ?? ""}` }],
    schema: EXTRACT_SCHEMA,
    effort: "medium",
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
