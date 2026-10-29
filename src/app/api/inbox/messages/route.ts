import { mailRoute, messageRef } from "@/lib/inbox/handler";
import { listMessages } from "@/lib/inbox/mail";

export const dynamic = "force-dynamic";

/** One page of a mailbox: ?box=INBOX&page=0. */
export async function GET(request: Request) {
  return mailRoute(request, async () => {
    const page = Number(new URL(request.url).searchParams.get("page") ?? 0);
    return Response.json(await listMessages(messageRef(request).box, Number.isInteger(page) && page >= 0 ? page : 0));
  });
}
