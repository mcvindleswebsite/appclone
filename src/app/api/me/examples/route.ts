import { cleanTurns, extractSource } from "@/lib/me/extract";
import { meRoute, readImages, str } from "@/lib/me/handler";
import { addExamples, addSource, deleteExamples, deleteSource, newId, readExamples } from "@/lib/me/store";
import { rebuildStyle } from "@/lib/me/style";
import { SITUATIONS, type MeSource, type Situation, type StyleExample } from "@/types/me";

export const dynamic = "force-dynamic";
// Reading screenshots (in parallel), then rebuilding the style guide over every example.
export const maxDuration = 180;

const MAX_TEXT = 20_000;

export async function GET(request: Request) {
  return meRoute(request, async () => Response.json({ examples: (await readExamples()).reverse() }));
}

const myMessages = (examples: StyleExample[]) => examples.reduce((n, e) => n + e.turns.filter((t) => t.who === "me").length, 0);

/**
 * Adds examples. Body: `images` and/or `text` (each screenshot is saved and read on its own,
 * then the style guide is rebuilt unless `rebuild` is false), or `sent`: a reply he sent, with
 * the conversation before it, saved as is.
 */
export async function POST(request: Request) {
  return meRoute(request, async () => {
    const body = (await request.json().catch(() => null)) as {
      images?: unknown;
      text?: unknown;
      rebuild?: unknown;
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

    const now = Date.now();
    const sources: MeSource[] = [
      ...images.map((image, i) => ({ id: newId(), image, createdAt: now + i * 100 })),
      ...(text ? [{ id: newId(), text, createdAt: now + images.length * 100 }] : []),
    ];
    const read = await Promise.all(
      sources.map(async (source) => {
        const found = await extractSource(source);
        // Keep the original only when it held a conversation, so a rescan can read it again.
        if (found.length) await addSource(source);
        return found;
      })
    );
    const examples = read.flat();
    if (!examples.length) return Response.json({ error: "Couldn't find any of your messages in that" }, { status: 422 });
    await addExamples(examples);
    const profile = body?.rebuild === false ? null : await rebuildStyle();
    return Response.json({ added: examples.length, messages: myMessages(examples), examples, profile });
  });
}

export async function DELETE(request: Request) {
  return meRoute(request, async () => {
    const params = new URL(request.url).searchParams;
    const examples = await readExamples();
    // ?unsaved=1: forget conversations added before screenshots were kept (they can't be rescanned).
    if (params.get("unsaved")) {
      const ids = examples.filter((e) => !e.sourceId && (e.source === "screenshot" || e.source === "text")).map((e) => e.id);
      await deleteExamples(ids);
      return Response.json({ removed: ids });
    }
    const id = params.get("id")?.slice(0, 64);
    if (!id) return Response.json({ error: "Missing id" }, { status: 400 });
    const sourceId = examples.find((e) => e.id === id)?.sourceId;
    await deleteExamples([id]);
    // Drop the screenshot too once nothing read from it is left, so a rescan doesn't bring it back.
    if (sourceId && !examples.some((e) => e.id !== id && e.sourceId === sourceId)) await deleteSource(sourceId);
    return Response.json({ ok: true });
  });
}
