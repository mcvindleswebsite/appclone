const ID = /^[\w-]{11}$/;

/** The 11-character video id from a YouTube / YouTube Music URL or a bare id. Null if none. */
export const parseYouTubeId = (input: string): string | null => {
  const text = input.trim();
  if (ID.test(text)) return text;
  try {
    const url = new URL(text);
    const host = url.hostname.replace(/^(www|m|music)\./, "");
    if (host === "youtu.be") return ID.test(url.pathname.slice(1)) ? url.pathname.slice(1) : null;
    if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
    const v = url.searchParams.get("v");
    if (v && ID.test(v)) return v;
    const fromPath = url.pathname.match(/^\/(?:embed|shorts|live|v)\/([\w-]{11})/);
    return fromPath ? fromPath[1] : null;
  } catch {
    return null;
  }
};

export const isYouTubeId = (value: unknown): value is string => typeof value === "string" && ID.test(value);
