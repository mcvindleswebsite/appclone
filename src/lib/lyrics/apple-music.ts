import { createPrivateKey, sign } from "node:crypto";

import type { SongMeta } from "@/types/lyrics";

/** Apple allows up to 6 months; a shorter life limits a leaked token. */
const TOKEN_SECONDS = 30 * 24 * 60 * 60;
let cached: { token: string; expires: number } | null = null;

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/**
 * The MusicKit developer token: an ES256 JWT signed with the MusicKit private key (.p8) from
 * the Apple Developer account. Null when APPLE_MUSIC_TEAM_ID / _KEY_ID / _PRIVATE_KEY aren't set.
 */
export const developerToken = (): string | null => {
  const teamId = process.env.APPLE_MUSIC_TEAM_ID;
  const keyId = process.env.APPLE_MUSIC_KEY_ID;
  // Vercel env vars often store the .p8 with literal "\n" for its line breaks.
  const pem = process.env.APPLE_MUSIC_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!teamId || !keyId || !pem) return null;

  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expires - now > 24 * 60 * 60) return cached.token;

  const header = base64url(JSON.stringify({ alg: "ES256", kid: keyId }));
  const payload = base64url(JSON.stringify({ iss: teamId, iat: now, exp: now + TOKEN_SECONDS }));
  // JWTs need the raw r||s signature, not Node's default DER encoding.
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), {
    key: createPrivateKey(pem),
    dsaEncoding: "ieee-p1363",
  });
  cached = { token: `${header}.${payload}.${base64url(signature)}`, expires: now + TOKEN_SECONDS };
  return cached.token;
};

interface AppleSong {
  id: string;
  attributes?: {
    name?: string;
    artistName?: string;
    albumName?: string;
    durationInMillis?: number;
    artwork?: { url?: string };
    previews?: { url?: string }[];
  };
}

interface ItunesSong {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  trackTimeMillis?: number;
  artworkUrl100?: string;
  previewUrl?: string;
}

/** Searches the Apple Music catalog, or the keyless iTunes Search API when MusicKit isn't configured. */
export const searchSongs = async (term: string): Promise<SongMeta[]> => {
  const token = developerToken();
  if (token) {
    const url = `https://api.music.apple.com/v1/catalog/us/search?types=songs&limit=15&term=${encodeURIComponent(term)}`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    if (response.ok) {
      const data = (await response.json()) as { results?: { songs?: { data?: AppleSong[] } } };
      return (data.results?.songs?.data ?? []).map((s) => ({
        id: s.id,
        title: s.attributes?.name ?? "",
        artist: s.attributes?.artistName ?? "",
        album: s.attributes?.albumName ?? "",
        artwork: (s.attributes?.artwork?.url ?? "").replace("{w}x{h}", "1200x1200"),
        durationMs: s.attributes?.durationInMillis ?? 0,
        previewUrl: s.attributes?.previews?.[0]?.url ?? null,
      }));
    }
  }

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
    }));
};
