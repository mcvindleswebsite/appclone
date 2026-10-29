import { extractSource } from "@/lib/me/extract";
import { meRoute, str } from "@/lib/me/handler";
import { addExamples, deleteExamples, readExamples, readSource, sourceIds } from "@/lib/me/store";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** What a rescan can cover: saved sources, and how many older conversations have none. */
export async function GET(request: Request) {
  return meRoute(request, async () => {
    const [ids, examples] = await Promise.all([sourceIds(), readExamples()]);
    const unsaved = examples.filter((e) => !e.sourceId && (e.source === "screenshot" || e.source === "text")).length;
    return Response.json({ sources: ids, unsaved });
  });
}

/**
 * Reads one saved screenshot or paste again and replaces what was learned from it. The page
 * calls this once per source (so no single request runs long), then rebuilds the style guide.
 */
export async function POST(request: Request) {
  return meRoute(request, async () => {
    const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
    const id = str(body?.id, 64);
    const source = id ? await readSource(id) : null;
    if (!source) return Response.json({ error: "Not found" }, { status: 404 });

    const fresh = await extractSource(source);
    const old = (await readExamples()).filter((e) => e.sourceId === id);
    // A misread that finds nothing keeps the old transcript rather than losing it.
    if (!fresh.length) return Response.json({ examples: old, removed: [] });
    await deleteExamples(old.map((e) => e.id));
    await addExamples(fresh);
    return Response.json({ examples: fresh, removed: old.map((e) => e.id) });
  });
}
