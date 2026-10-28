import type { VideoCandidate } from "@/types/lyrics";

/** "PT3M33S" → 213. */
const isoSeconds = (iso: string) => {
  const m = iso.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  return m ? Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) : 0;
};

/**
 * Embeddable YouTube uploads of a song, closest to the track's length first, so the video's
 * timing lines up with the synced lyrics (music videos with long intros sort last). Uses the
 * YouTube Data API: a free key from Google Cloud, 100 searches a day on the default quota.
 * Null when YOUTUBE_API_KEY isn't set.
 */
export const findVideos = async (title: string, artist: string, durationSec: number): Promise<VideoCandidate[] | null> => {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return null;

  const search = new URLSearchParams({
    part: "snippet",
    type: "video",
    videoEmbeddable: "true",
    videoCategoryId: "10",
    maxResults: "8",
    q: `${artist} ${title} audio`,
    key,
  });
  const found = await fetch(`https://www.googleapis.com/youtube/v3/search?${search}`, { cache: "no-store" });
  if (!found.ok) throw new Error(`YouTube search ${found.status}`);
  const ids = ((await found.json()) as { items?: { id?: { videoId?: string } }[] }).items?.flatMap((i) => (i.id?.videoId ? [i.id.videoId] : [])) ?? [];
  if (!ids.length) return [];

  const details = new URLSearchParams({ part: "snippet,contentDetails", id: ids.join(","), key });
  const videos = await fetch(`https://www.googleapis.com/youtube/v3/videos?${details}`, { cache: "no-store" });
  if (!videos.ok) throw new Error(`YouTube videos ${videos.status}`);
  const items =
    ((await videos.json()) as {
      items?: {
        id: string;
        snippet?: { title?: string; channelTitle?: string; thumbnails?: { medium?: { url?: string } } };
        contentDetails?: { duration?: string };
      }[];
    }).items ?? [];

  return items
    .map((v) => ({
      id: v.id,
      title: v.snippet?.title ?? "",
      channel: v.snippet?.channelTitle ?? "",
      thumbnail: v.snippet?.thumbnails?.medium?.url ?? "",
      durationSec: isoSeconds(v.contentDetails?.duration ?? ""),
    }))
    .sort((a, b) => Math.abs(a.durationSec - durationSec) - Math.abs(b.durationSec - durationSec));
};
