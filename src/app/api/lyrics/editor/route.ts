import { redis } from "@/lib/bet/store";
import { adminKey, checkLyricsAccess, EDITOR_KEY } from "@/lib/lyrics/access";

export const dynamic = "force-dynamic";

/** Whether the editor login is on (admin only). */
export async function GET(request: Request) {
  const denied = await checkLyricsAccess(request);
  if (denied) return denied;
  const reply = await redis(["GET", EDITOR_KEY]).catch(() => null);
  if (!reply) return Response.json({ error: "Storage not configured" }, { status: 503 });
  return Response.json({ set: typeof reply.result === "string" && reply.result.length > 0 });
}

/** Sets the editor's password (admin only). Body: { password }. */
export async function PUT(request: Request) {
  const denied = await checkLyricsAccess(request);
  if (denied) return denied;
  const { password } = ((await request.json().catch(() => null)) ?? {}) as { password?: unknown };
  if (typeof password !== "string" || password.length < 4 || password.length > 100) {
    return Response.json({ error: "Use 4 to 100 characters" }, { status: 400 });
  }
  if (password === adminKey()) return Response.json({ error: "That is your own passcode" }, { status: 400 });
  const reply = await redis(["SET", EDITOR_KEY, password]).catch(() => null);
  if (!reply) return Response.json({ error: "Storage not configured" }, { status: 503 });
  return Response.json({ set: true });
}

/** Turns the editor login off (admin only). */
export async function DELETE(request: Request) {
  const denied = await checkLyricsAccess(request);
  if (denied) return denied;
  await redis(["DEL", EDITOR_KEY]).catch(() => null);
  return Response.json({ set: false });
}
