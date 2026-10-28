import type { SongMeta } from "@/types/lyrics";

interface ItunesSong {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  previewUrl?: string;
}

/** Searches the iTunes catalog (keyless) for songs, with high-res artwork. */
export const searchSongs = async (term: string): Promise<SongMeta[]> => {
  const url = `https://itunes.apple.com/search?media=music&entity=song&limit=15&term=${encodeURIComponent(term)}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`iTunes ${response.status}`);
  const data = (await response.json()) as { results?: ItunesSong[] };
  return (data.results ?? [])
    .filter((s) => s.trackId)
    .map((s) => ({
      id: String(s.trackId),
      title: s.trackName ?? "",
      artist: s.artistName ?? "",
      album: s.collectionName ?? "",
      artwork: (s.artworkUrl100 ?? "").replace("100x100bb", "1200x1200bb"),
      durationMs: s.trackTimeMillis ?? 0,
      previewUrl: s.previewUrl ?? null,
      youtubeId: null,
    }));
};
