import { mailRoute } from "@/lib/inbox/handler";
import { sendMessage } from "@/lib/inbox/mail";
import type { SendRequest } from "@/types/inbox";

export const dynamic = "force-dynamic";

const MAX_BODY = 100_000;

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export async function POST(request: Request) {
  return mailRoute(request, async () => {
    const body = (await request.json().catch(() => null)) as Partial<Record<keyof SendRequest, unknown>> | null;
    const references = Array.isArray(body?.references) ? body.references.filter((r): r is string => typeof r === "string").slice(0, 50) : undefined;
    await sendMessage({
      to: str(body?.to, 2000),
      cc: str(body?.cc, 2000),
      subject: str(body?.subject, 500),
      text: str(body?.text, MAX_BODY),
      inReplyTo: str(body?.inReplyTo, 500) || undefined,
      references,
    });
    return Response.json({ ok: true });
  });
}
