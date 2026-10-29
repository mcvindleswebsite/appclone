import { requireSession } from "@/lib/inbox/auth";
import { mailConfigured } from "@/lib/inbox/mail";

/** Runs a mailbox request for a logged-in caller, mapping a missing setup or a failed connection to JSON errors. */
export const mailRoute = async (request: Request, run: () => Promise<Response>) => {
  const denied = await requireSession(request);
  if (denied) return denied;
  if (!mailConfigured()) return Response.json({ error: "Mailbox not connected — set MAIL_PASSWORD on Vercel" }, { status: 503 });
  try {
    return await run();
  } catch (error) {
    const message = error instanceof Error && error.message === "Check the addresses" ? error.message : "The mail server didn't respond — try again";
    return Response.json({ error: message }, { status: 502 });
  }
};

/** The mailbox path and message UID from the query string. */
export const messageRef = (request: Request) => {
  const params = new URL(request.url).searchParams;
  const box = params.get("box") || "INBOX";
  const uid = Number(params.get("uid"));
  return { box: box.slice(0, 200), uid: Number.isInteger(uid) && uid > 0 ? uid : null };
};
