import { cleanTurns } from "@/lib/me/extract";
import { meRoute } from "@/lib/me/handler";
import { addExamples, deleteExamples, readExamples } from "@/lib/me/store";
import type { StyleExample } from "@/types/me";

export const dynamic = "force-dynamic";

/** Conversations per request; the page sends a big download in several. */
const MAX_PER_REQUEST = 400;
const ID = /^ig_[a-z0-9_]{1,60}$/;

/**
 * Saves conversations the page read out of his Instagram data download. No AI here: the
 * download already says who sent what. Body: `conversations` ({id, turns, createdAt}), and
 * `replace: true` on the first request to drop the previous import.
 */
export async function POST(request: Request) {
  return meRoute(request, async () => {
    const body = (await request.json().catch(() => null)) as { conversations?: unknown; replace?: unknown } | null;
    const list = Array.isArray(body?.conversations) ? (body.conversations as Partial<StyleExample>[]) : null;
    if (!list || list.length > MAX_PER_REQUEST) return Response.json({ error: "Bad import" }, { status: 400 });

    const examples: StyleExample[] = list
      .filter((c) => typeof c.id === "string" && ID.test(c.id) && typeof c.createdAt === "number")
      .map((c) => ({ id: c.id!, source: "instagram" as const, situation: "other" as const, turns: cleanTurns(c.turns), createdAt: c.createdAt! }))
      .filter((e) => e.turns.some((t) => t.who === "me"));

    let removed: string[] = [];
    if (body?.replace === true) {
      removed = (await readExamples()).filter((e) => e.source === "instagram").map((e) => e.id);
      await deleteExamples(removed);
    }
    await addExamples(examples);
    return Response.json({ added: examples.length, removed });
  });
}
