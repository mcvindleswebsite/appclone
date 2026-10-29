import { checkLyricsAccess, lyricsRole } from "@/lib/lyrics/access";

export const dynamic = "force-dynamic";

/** Checks a /lyrics passcode sent in x-lyrics-key and says which login it is. */
export async function POST(request: Request) {
  const denied = await checkLyricsAccess(request, ["admin", "editor"]);
  if (denied) return denied;
  return Response.json({ ok: true, role: await lyricsRole(request) });
}
