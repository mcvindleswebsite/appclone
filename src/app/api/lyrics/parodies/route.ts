import { redis } from "@/lib/bet/store";
import { checkLyricsAccess, lyricsRole } from "@/lib/lyrics/access";
import { PARODIES_KEY, readParodies, sanitizeParody } from "@/lib/lyrics/store";
import type { Parody } from "@/types/lyrics";

export const dynamic = "force-dynamic";

/** ~200KB of JSON: a long song with every line rewritten fits easily. */
const MAX_BODY_CHARS = 200_000;

/** The description is notes for the AI; only the admin gets it. */
const withoutBrief = (p: Parody) => {
  const visible = { ...p };
  delete visible.brief;
  return visible;
};

/** Published parodies for everyone; drafts too for the admin and the editor. */
export async function GET(request: Request) {
  try {
    const parodies = await readParodies();
    if (!parodies) return Response.json({ parodies: [], storage: false });
    const role = await lyricsRole(request);
    if (role === "admin") return Response.json({ parodies, storage: true });
    if (role === "editor") return Response.json({ parodies: parodies.map(withoutBrief), storage: true });
    return Response.json({ parodies: parodies.filter((p) => p.published).map(withoutBrief), storage: true });
  } catch {
    return Response.json({ error: "Couldn't load parodies" }, { status: 502 });
  }
}

/**
 * The editor's save: only parody line text changes, on lines that already exist. Everything
 * else (title, timing, publishing, recording, the AI description) stays as the admin left it.
 */
const editorMerge = (stored: Parody, incoming: Parody): Parody => {
  const lines = new Map(incoming.chunks.flatMap((c) => c.lines.map((l) => [l.id, l.parody] as const)));
  return {
    ...stored,
    chunks: stored.chunks.map((c) => ({ ...c, lines: c.lines.map((l) => ({ ...l, parody: lines.get(l.id) ?? l.parody })) })),
    updatedAt: Date.now(),
  };
};

/** Creates or replaces one parody (admin), or saves its parody lines (editor). */
export async function PUT(request: Request) {
  const denied = await checkLyricsAccess(request, ["admin", "editor"]);
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
    const admin = (await lyricsRole(request)) === "admin";
    if (!admin) {
      const raw = (await redis(["HGET", PARODIES_KEY, parody.id]))?.result;
      const stored = typeof raw === "string" ? sanitizeParody(JSON.parse(raw)) : null;
      if (!stored) return Response.json({ error: "Parody not found" }, { status: 404 });
      parody = editorMerge(stored, parody);
    }
    const reply = await redis(["HSET", PARODIES_KEY, parody.id, JSON.stringify(parody)]);
    if (!reply) return Response.json({ error: "Storage not configured" }, { status: 503 });
    return Response.json({ parody: admin ? parody : withoutBrief(parody) });
  } catch {
    return Response.json({ error: "Couldn't save" }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const denied = await checkLyricsAccess(request);
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
