import { askJson, imageBlocks } from "@/lib/me/claude";
import { meRoute, readImages, str } from "@/lib/me/handler";
import { WRITE_SCHEMA, writeStable, writeTask, writeVolatile, type WriteMode } from "@/lib/me/prompts";
import { readExamples, readProfile } from "@/lib/me/store";
import type { ReplyResult } from "@/types/me";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** Writes three options in his voice. Body: `mode` (reply | opener), `images`, `text`, `note`. */
export async function POST(request: Request) {
  return meRoute(request, async () => {
    const body = (await request.json().catch(() => null)) as { mode?: unknown; images?: unknown; text?: unknown; note?: unknown } | null;
    const mode: WriteMode = body?.mode === "opener" ? "opener" : "reply";
    const images = readImages(body?.images);
    const text = str(body?.text, 20_000);
    if (!images) return Response.json({ error: "Up to 6 screenshots, each under about 1MB" }, { status: 400 });
    if (!images.length && !text) return Response.json({ error: "Add a screenshot or paste the chat" }, { status: 400 });

    const [examples, profile] = await Promise.all([readExamples(), readProfile()]);
    const result = await askJson<ReplyResult>({
      stable: writeStable(examples, profile),
      volatile: writeVolatile(profile),
      content: [
        ...imageBlocks(images),
        { type: "text", text: `${text ? `Pasted:\n${text}\n\n` : ""}${writeTask(mode, str(body?.note, 500))}` },
      ],
      schema: WRITE_SCHEMA,
      effort: "high",
    });
    return Response.json({ ...result, options: result.options.slice(0, 3) });
  });
}
