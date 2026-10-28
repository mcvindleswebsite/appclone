import { developerToken } from "@/lib/lyrics/apple-music";

export const dynamic = "force-dynamic";

/**
 * The MusicKit developer token. It's public by design (MusicKit JS runs in the browser), so
 * every visitor can sign in to Apple Music and play full tracks.
 */
export async function GET() {
  try {
    const token = developerToken();
    if (!token) return Response.json({ error: "Apple Music not configured" }, { status: 503 });
    return Response.json({ token });
  } catch {
    return Response.json({ error: "Apple Music key is invalid" }, { status: 500 });
  }
}
