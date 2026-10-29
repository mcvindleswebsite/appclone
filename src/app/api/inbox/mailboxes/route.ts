import { mailRoute } from "@/lib/inbox/handler";
import { listMailboxes } from "@/lib/inbox/mail";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return mailRoute(request, async () => Response.json({ mailboxes: await listMailboxes() }));
}
