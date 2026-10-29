import type { BandlabTrack } from "@/types/lyrics";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BandlabPost {
  revision?: {
    mixdown?: { file?: string; duration?: number; status?: string };
    song?: { name?: string; picture?: { url?: string } };
  };
}

const isHost = (url: string | undefined, host: string) => {
  try {
    return !!url && new URL(url).protocol === "https:" && new URL(url).hostname === host;
  } catch {
    return false;
  }
};

/**
 * GET ?id=<BandLab post id>: the post's audio file, length, and cover, read from BandLab's
 * public post JSON (keyless, the same data its own site loads). Lets /lyrics play a BandLab
 * recording with its own play button and seek to any verse. Public: visitors play it too.
 * 404 when BandLab doesn't serve the post this way; the page then falls back to BandLab's embed.
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return Response.json({ error: "Invalid id" }, { status: 400 });
  try {
    const response = await fetch(`https://www.bandlab.com/api/v1.3/posts/${id}`, {
      headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0" },
      next: { revalidate: 3600 },
    });
    if (!response.ok) return Response.json({ error: "Not found" }, { status: 404 });
    const post = (await response.json()) as BandlabPost;
    const mixdown = post.revision?.mixdown;
    if (!isHost(mixdown?.file, "static.bandlab.com")) return Response.json({ error: "No audio" }, { status: 404 });
    const picture = post.revision?.song?.picture?.url;
    // BandLab's placeholder art ends in /default/; only a real cover replaces the album art.
    const cover = picture && isHost(picture, "bl-prod-images.azureedge.net") && !/\/default\/?$/.test(picture) ? picture : null;
    const track: BandlabTrack = {
      audio: mixdown!.file!,
      durationSec: typeof mixdown?.duration === "number" ? mixdown.duration : 0,
      cover,
      title: post.revision?.song?.name?.trim().slice(0, 200) ?? "",
    };
    return Response.json(track, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
  } catch {
    return Response.json({ error: "BandLab didn't respond" }, { status: 502 });
  }
}
