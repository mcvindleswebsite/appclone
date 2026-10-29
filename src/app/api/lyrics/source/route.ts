import { checkLyricsAccess } from "@/lib/lyrics/access";
import { buildChunks } from "@/lib/lyrics/chunks";
import type { LyricsSource } from "@/types/lyrics";

export const dynamic = "force-dynamic";

interface LrclibTrack {
  duration?: number;
  instrumental?: boolean;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

const HEADERS = { "User-Agent": "Vindle Parody Studio (https://mcvindle.com/lyrics)" };

/** LRCLIB is crowd-sourced and has junk uploads (e.g. a lone "probe" line); real lyrics have a few lines. */
const usable = (r: LrclibTrack | null): r is LrclibTrack =>
  !!r && (r.plainLyrics ?? r.syncedLyrics ?? "").split("\n").filter((l) => l.trim()).length >= 4;

/**
 * Original lyrics from LRCLIB, split into labeled chunks with synced timestamps. Tries the
 * exact track first, then a search picking the closest duration that has synced lyrics.
 */
export async function GET(request: Request) {
  const denied = await checkLyricsAccess(request);
  if (denied) return denied;
  const params = new URL(request.url).searchParams;
  const track = (params.get("track") ?? "").slice(0, 200);
  const artist = (params.get("artist") ?? "").slice(0, 200);
  const album = (params.get("album") ?? "").slice(0, 200);
  const duration = Math.round(Number(params.get("duration")) || 0);
  if (!track || !artist) return Response.json({ error: "Missing track or artist" }, { status: 400 });

  try {
    let found: LrclibTrack | null = null;
    const exact = new URLSearchParams({ track_name: track, artist_name: artist, album_name: album });
    if (duration) exact.set("duration", String(duration));
    const direct = await fetch(`https://lrclib.net/api/get?${exact}`, { headers: HEADERS, cache: "no-store" });
    if (direct.ok) {
      const exactMatch = (await direct.json()) as LrclibTrack;
      if (usable(exactMatch)) found = exactMatch;
    }

    if (!found?.syncedLyrics) {
      const query = new URLSearchParams({ track_name: track, artist_name: artist });
      const search = await fetch(`https://lrclib.net/api/search?${query}`, { headers: HEADERS, cache: "no-store" });
      if (search.ok) {
        const results = ((await search.json()) as LrclibTrack[]).filter(usable);
        const near = (r: LrclibTrack) => Math.abs((r.duration ?? 0) - duration);
        const best = results.sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) || near(a) - near(b))[0];
        if (best && (!found || best.syncedLyrics)) found = best;
      }
    }

    if (!found) return Response.json({ error: "No lyrics found on LRCLIB" }, { status: 404 });
    const source: LyricsSource = {
      chunks: buildChunks(found.plainLyrics ?? null, found.syncedLyrics ?? null),
      synced: !!found.syncedLyrics,
      instrumental: !!found.instrumental,
    };
    return Response.json(source);
  } catch {
    return Response.json({ error: "LRCLIB request failed" }, { status: 502 });
  }
}
