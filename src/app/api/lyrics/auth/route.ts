import { checkLyricsAccess } from "@/lib/lyrics/access";

export const dynamic = "force-dynamic";

/** Checks the /lyrics admin passcode sent in x-lyrics-key. */
export async function POST(request: Request) {
  const denied = checkLyricsAccess(request);
  if (denied) return denied;
  return Response.json({ ok: true });
}
