/** A song picked from the iTunes catalog (`id` is its trackId), played through a YouTube video. */
export interface SongMeta {
  id: string;
  title: string;
  artist: string;
  album: string;
  /** High-res album artwork URL. */
  artwork: string;
  durationMs: number;
  /** 30-second iTunes preview, played when no YouTube video is linked. */
  previewUrl: string | null;
  /** The YouTube video that plays the full track; line times follow this video. */
  youtubeId: string | null;
}

export interface LyricLine {
  id: string;
  original: string;
  /** The parody text; empty means the line hasn't been rewritten yet. */
  parody: string;
  /** Seconds into the track (before the parody's global offset), or null when unsynced. */
  time: number | null;
}

export interface LyricChunk {
  id: string;
  /** "Verse 1", "Chorus", "Bridge", ... */
  label: string;
  lines: LyricLine[];
}

export interface Parody {
  id: string;
  title: string;
  song: SongMeta;
  chunks: LyricChunk[];
  /** Global sync offset in seconds, added to every line time. */
  offset: number;
  published: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LyricsSource {
  chunks: LyricChunk[];
  /** True when the timestamps came from LRCLIB synced lyrics. */
  synced: boolean;
  instrumental: boolean;
}

export interface VideoCandidate {
  id: string;
  title: string;
  channel: string;
  thumbnail: string;
  durationSec: number;
}

export interface ParodyAssistRequest {
  song: Pick<SongMeta, "title" | "artist">;
  label: string;
  lines: Pick<LyricLine, "original" | "parody">[];
  direction: string;
  /** Parody text of the other chunks, so the theme carries across the song. */
  context: string;
}

export interface ParodyAssistResponse {
  analysis: { theme: string; rhymeScheme: string; syllables: number[] };
  lines: string[];
}

export const MAX_CHUNKS = 60;
export const MAX_LINES_PER_CHUNK = 40;
export const MAX_LINE_CHARS = 300;
