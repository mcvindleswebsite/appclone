import { mailRoute, messageRef } from "@/lib/inbox/handler";
import { readMessage, trashMessage } from "@/lib/inbox/mail";

export const dynamic = "force-dynamic";

const missing = () => Response.json({ error: "Message not found" }, { status: 404 });

/** One message: ?box=INBOX&uid=123. Opening it marks it read. */
export async function GET(request: Request) {
  return mailRoute(request, async () => {
    const { box, uid } = messageRef(request);
    const message = uid ? await readMessage(box, uid) : null;
    return message ? Response.json(message) : missing();
  });
}

/** Moves a message to Trash (or deletes it from Trash). */
export async function DELETE(request: Request) {
  return mailRoute(request, async () => {
    const { box, uid } = messageRef(request);
    if (!uid) return missing();
    await trashMessage(box, uid);
    return Response.json({ ok: true });
  });
}
