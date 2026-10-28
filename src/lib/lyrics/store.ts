import { redis } from "@/lib/bet/store";
import { isRecording } from "@/lib/lyrics/recording";
import { isYouTubeId } from "@/lib/lyrics/youtube-id";
import { MAX_BRIEF_CHARS, MAX_CHUNKS, MAX_LINE_CHARS, MAX_LINES_PER_CHUNK, type LyricChunk, type Parody, type SongMeta } from "@/types/lyrics";

export const PARODIES_KEY = "vindle_lyrics_parodies";

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const httpsUrl = (v: unknown) => {
  const s = str(v, 2000);
  return s.startsWith("https://") ? s : "";
};

/** Rebuilds a parody from untrusted JSON, keeping only known fields within size limits. Null if unusable. */
export const sanitizeParody = (value: unknown): Parody | null => {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  const s = (p.song ?? {}) as Record<string, unknown>;
  const id = str(p.id, 64);
  const songId = str(s.id, 32);
  if (!/^[\w-]+$/.test(id) || !/^\d+$/.test(songId) || !Array.isArray(p.chunks)) return null;

  const song: SongMeta = {
    id: songId,
    title: str(s.title, 200),
    artist: str(s.artist, 200),
    album: str(s.album, 200),
    artwork: httpsUrl(s.artwork),
    durationMs: Math.max(0, num(s.durationMs, 0)),
    previewUrl: httpsUrl(s.previewUrl) || null,
    youtubeId: isYouTubeId(s.youtubeId) ? s.youtubeId : null,
  };
  const chunks: LyricChunk[] = p.chunks.slice(0, MAX_CHUNKS).flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const c = raw as Record<string, unknown>;
    const lines = Array.isArray(c.lines) ? c.lines.slice(0, MAX_LINES_PER_CHUNK) : [];
    return [
      {
        id: str(c.id, 32) || Math.random().toString(36).slice(2, 10),
        label: str(c.label, 40) || "Verse",
        lines: lines.flatMap((rawLine) => {
          if (!rawLine || typeof rawLine !== "object") return [];
          const l = rawLine as Record<string, unknown>;
          const time = typeof l.time === "number" && Number.isFinite(l.time) && l.time >= 0 ? l.time : null;
          return [
            {
              id: str(l.id, 32) || Math.random().toString(36).slice(2, 10),
              original: str(l.original, MAX_LINE_CHARS),
              parody: str(l.parody, MAX_LINE_CHARS),
              time,
            },
          ];
        }),
      },
    ];
  });

  const now = Date.now();
  return {
    id,
    title: str(p.title, 200) || `${song.title} (Parody)`,
    song,
    chunks,
    brief: str(p.brief, MAX_BRIEF_CHARS),
    offset: Math.min(30, Math.max(-30, num(p.offset, 0))),
    recording: isRecording(p.recording) ? { kind: p.recording.kind, id: p.recording.id } : null,
    recordingOffset: Math.min(60, Math.max(-60, num(p.recordingOffset, 0))),
    published: p.published === true,
    createdAt: num(p.createdAt, now),
    updatedAt: now,
  };
};

/** Every stored parody, newest first, or null when the store isn't configured. */
export const readParodies = async (): Promise<Parody[] | null> => {
  const reply = await redis(["HGETALL", PARODIES_KEY]);
  if (!reply) return null;
  const flat = (reply.result as string[] | null) ?? [];
  const parodies: Parody[] = [];
  for (let i = 1; i < flat.length; i += 2) {
    try {
      const parsed = JSON.parse(flat[i]) as Parody;
      if (parsed?.id && parsed.song && Array.isArray(parsed.chunks)) parodies.push(parsed);
    } catch {
      // Skip a corrupt entry rather than failing the whole list.
    }
  }
  return parodies.sort((a, b) => b.updatedAt - a.updatedAt);
};
