import { checkLyricsAccess } from "@/lib/lyrics/access";
import { searchSongs } from "@/lib/lyrics/itunes";

export const dynamic = "force-dynamic";

/** Song search for the editor, from the iTunes catalog. */
export async function GET(request: Request) {
  const denied = await checkLyricsAccess(request);
  if (denied) return denied;
  const term = (new URL(request.url).searchParams.get("q") ?? "").trim().slice(0, 120);
  if (!term) return Response.json({ songs: [] });
  try {
    return Response.json({ songs: await searchSongs(term) });
  } catch {
    return Response.json({ error: "Search failed" }, { status: 502 });
  }
}
