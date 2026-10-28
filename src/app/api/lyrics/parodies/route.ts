import { checkLyricsAccess, isLyricsAdmin } from "@/lib/lyrics/access";
import { PARODIES_KEY, readParodies, sanitizeParody } from "@/lib/lyrics/store";
import { redis } from "@/lib/bet/store";

export const dynamic = "force-dynamic";

/** ~200KB of JSON: a long song with every line rewritten fits easily. */
const MAX_BODY_CHARS = 200_000;

/** Published parodies for everyone; drafts too for the admin. */
export async function GET(request: Request) {
  try {
    const parodies = await readParodies();
    if (!parodies) return Response.json({ parodies: [], storage: false });
    if (isLyricsAdmin(request)) return Response.json({ parodies, storage: true });
    // The description is notes for the AI; visitors don't get it.
    const published = parodies
      .filter((p) => p.published)
      .map((p) => {
        const visible = { ...p };
        delete visible.brief;
        return visible;
      });
    return Response.json({ parodies: published, storage: true });
  } catch {
    return Response.json({ error: "Couldn't load parodies" }, { status: 502 });
  }
}

/** Creates or replaces one parody. */
export async function PUT(request: Request) {
  const denied = checkLyricsAccess(request);
  if (denied) return denied;
  const text = await request.text();
  if (text.length > MAX_BODY_CHARS) return Response.json({ error: "Parody too large" }, { status: 413 });

  let parody;
  try {
    parody = sanitizeParody(JSON.parse(text));
  } catch {
    parody = null;
  }
  if (!parody) return Response.json({ error: "Invalid parody" }, { status: 400 });

  try {
    const reply = await redis(["HSET", PARODIES_KEY, parody.id, JSON.stringify(parody)]);
    if (!reply) return Response.json({ error: "Storage not configured" }, { status: 503 });
    return Response.json({ parody });
  } catch {
    return Response.json({ error: "Couldn't save" }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const denied = checkLyricsAccess(request);
  if (denied) return denied;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[\w-]{1,64}$/.test(id)) return Response.json({ error: "Invalid id" }, { status: 400 });
  try {
    const reply = await redis(["HDEL", PARODIES_KEY, id]);
    if (!reply) return Response.json({ error: "Storage not configured" }, { status: 503 });
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Couldn't delete" }, { status: 502 });
  }
}
