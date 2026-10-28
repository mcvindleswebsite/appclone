import { isYouTubeId, parseYouTubeId } from "@/lib/lyrics/youtube-id";
import type { Recording } from "@/types/lyrics";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The parody recording from a pasted YouTube link, a BandLab post link
 * (bandlab.com/post/<id>), a BandLab embed link, or BandLab's whole <iframe> embed code.
 */
export const parseRecording = (input: string): Recording | null => {
  const youtube = parseYouTubeId(input);
  if (youtube) return { kind: "youtube", id: youtube };

  // BandLab's Embed option gives an <iframe>; use its src.
  const text = input.match(/src=["']([^"']+)["']/)?.[1] ?? input.trim();
  try {
    const url = new URL(text);
    if (url.hostname.replace(/^www\./, "") !== "bandlab.com") return null;
    const id = url.searchParams.get("id") ?? url.pathname.match(/^\/post\/([^/?#]+)/)?.[1] ?? "";
    return UUID.test(id) ? { kind: "bandlab", id: id.toLowerCase() } : null;
  } catch {
    return null;
  }
};

export const isRecording = (value: unknown): value is Recording => {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<Recording>;
  return (r.kind === "youtube" && isYouTubeId(r.id)) || (r.kind === "bandlab" && typeof r.id === "string" && UUID.test(r.id));
};

export const bandlabEmbedUrl = (id: string) => `https://www.bandlab.com/embed/?id=${id}&blur=false`;
