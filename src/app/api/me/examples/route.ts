import { askJson, imageBlocks } from "@/lib/me/claude";
import { meRoute, readImages, str } from "@/lib/me/handler";
import { EXTRACT_SCHEMA, EXTRACT_SYSTEM } from "@/lib/me/prompts";
import { addExamples, deleteExample, newId, readExamples } from "@/lib/me/store";
import { rebuildStyle } from "@/lib/me/style";
import { SITUATIONS, type ChatTurn, type Situation, type StyleExample } from "@/types/me";

export const dynamic = "force-dynamic";
// Reading screenshots, then rebuilding the style guide over every example.
export const maxDuration = 180;

const MAX_TEXT = 20_000;
const MAX_TURNS = 60;

export async function GET(request: Request) {
  return meRoute(request, async () => Response.json({ examples: (await readExamples()).reverse() }));
}

const cleanTurns = (value: unknown): ChatTurn[] =>
  (Array.isArray(value) ? value : [])
    .filter((t): t is ChatTurn => !!t && (t.who === "me" || t.who === "them") && typeof t.text === "string" && !!t.text.trim())
    .slice(0, MAX_TURNS)
    .map((t) => ({ who: t.who, text: t.text.slice(0, 2000) }));

/**
 * Adds examples. Body: `images` and/or `text` (read into transcripts by the AI, then the style
 * guide is rebuilt), or `sent`: a reply he sent, with the conversation before it, saved as is.
 */
export async function POST(request: Request) {
  return meRoute(request, async () => {
    const body = (await request.json().catch(() => null)) as {
      images?: unknown;
      text?: unknown;
      sent?: { turns?: unknown; situation?: unknown };
    } | null;

    if (body?.sent) {
      const turns = cleanTurns(body.sent.turns);
      if (!turns.some((t) => t.who === "me")) return Response.json({ error: "Nothing to save" }, { status: 400 });
      const situation = SITUATIONS.includes(body.sent.situation as Situation) ? (body.sent.situation as Situation) : "other";
      await addExamples([{ id: newId(), source: "sent", situation, turns, createdAt: Date.now() }]);
      return Response.json({ added: 1 });
    }

    const images = readImages(body?.images);
    const text = str(body?.text, MAX_TEXT);
    if (!images) return Response.json({ error: "Up to 6 screenshots, each under about 1MB" }, { status: 400 });
    if (!images.length && !text) return Response.json({ error: "Add a screenshot or paste some text" }, { status: 400 });

    const read = await askJson<{ conversations: { situation: Situation; turns: ChatTurn[] }[] }>({
      stable: EXTRACT_SYSTEM,
      content: [...imageBlocks(images), { type: "text", text: text ? `Pasted text:\n${text}` : "Transcribe these." }],
      schema: EXTRACT_SCHEMA,
      effort: "low",
    });
    const now = Date.now();
    const source = images.length ? "screenshot" : "text";
    const examples: StyleExample[] = read.conversations
      .map((c, i) => ({ id: newId(), source, situation: c.situation, turns: cleanTurns(c.turns), createdAt: now + i }) as const)
      .filter((e) => e.turns.some((t) => t.who === "me"));
    if (!examples.length) return Response.json({ error: "Couldn't find any of your messages in that" }, { status: 422 });
    await addExamples(examples);
    const profile = await rebuildStyle();
    return Response.json({ added: examples.length, examples, profile });
  });
}

export async function DELETE(request: Request) {
  return meRoute(request, async () => {
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
    await deleteExample(id.slice(0, 64));
    return Response.json({ ok: true });
  });
}
