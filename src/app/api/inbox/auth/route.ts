import { hasSession, login, logout } from "@/lib/inbox/auth";

export const dynamic = "force-dynamic";

/** Whether this browser already has an inbox session. */
export async function GET(request: Request) {
  return Response.json({ ok: await hasSession(request) });
}

/** Logs in with the address and password. */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
  try {
    return await login(request, body?.email, body?.password);
  } catch {
    return Response.json({ error: "Storage error — check the Upstash connection" }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  return logout(request);
}
