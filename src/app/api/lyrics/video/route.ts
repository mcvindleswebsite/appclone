import { checkLyricsAccess } from "@/lib/lyrics/access";
import { findVideos } from "@/lib/lyrics/youtube";

export const dynamic = "force-dynamic";

/** YouTube videos for a song, best length match first. 503 without YOUTUBE_API_KEY (paste a link instead). */
export async function GET(request: Request) {
  const denied = await checkLyricsAccess(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const title = (params.get("title") ?? "").slice(0, 200);
  const artist = (params.get("artist") ?? "").slice(0, 200);
  const duration = Math.max(0, Number(params.get("duration")) || 0);
  if (!title) return Response.json({ error: "Missing title" }, { status: 400 });
  try {
    const videos = await findVideos(title, artist, duration);
    if (!videos) return Response.json({ error: "YouTube search isn't set up — paste a video link" }, { status: 503 });
    return Response.json({ videos });
  } catch {
    return Response.json({ error: "YouTube search failed" }, { status: 502 });
  }
}
