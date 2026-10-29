import { ImapFlow, type MessageAddressObject } from "imapflow";
import { simpleParser, type AddressObject } from "mailparser";
import { createTransport } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";

import type { MailAddress, MailboxInfo, MessageDetail, MessageList, MessageSummary, SendRequest } from "@/types/inbox";

/**
 * The mailbox behind the inbox: Namecheap Private Email over IMAP (read) and SMTP (send).
 * Each request opens its own short connection, so nothing stays connected between requests.
 * MAIL_PASSWORD is the mailbox password; the address defaults to the inbox login's.
 */

const USER = process.env.MAIL_USER || process.env.INBOX_EMAIL || "vincent@mcvindle.com";
const IMAP_HOST = process.env.MAIL_IMAP_HOST || "mail.privateemail.com";
const SMTP_HOST = process.env.MAIL_SMTP_HOST || "mail.privateemail.com";
const FROM_NAME = process.env.MAIL_FROM_NAME || "Vincent Velasco";
export const PAGE_SIZE = 50;

export const mailConfigured = () => !!process.env.MAIL_PASSWORD;

const withImap = async <T>(run: (client: ImapFlow) => Promise<T>): Promise<T> => {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: USER, pass: process.env.MAIL_PASSWORD ?? "" },
    logger: false,
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
};

const address = (a: MessageAddressObject): MailAddress => ({ name: a.name ?? "", address: a.address ?? "" });

const parsedAddresses = (field: AddressObject | AddressObject[] | undefined): MailAddress[] =>
  (Array.isArray(field) ? field : field ? [field] : []).flatMap((group) =>
    group.value.map((a) => ({ name: a.name ?? "", address: a.address ?? "" }))
  );

const ORDER = ["\\Inbox", "\\Drafts", "\\Sent", "\\Junk", "\\Trash", "\\Archive"];
const rank = (m: MailboxInfo) => (m.specialUse && ORDER.includes(m.specialUse) ? ORDER.indexOf(m.specialUse) : ORDER.length);

export const listMailboxes = () =>
  withImap(async (client): Promise<MailboxInfo[]> => {
    const boxes = await client.list({ statusQuery: { unseen: true } });
    return boxes
      .filter((b) => !b.flags.has("\\Noselect"))
      .map((b) => {
        const inbox = b.path.toUpperCase() === "INBOX";
        return {
          path: b.path,
          name: inbox ? "Inbox" : b.name,
          specialUse: inbox ? "\\Inbox" : (b.specialUse ?? null),
          unseen: b.status?.unseen ?? 0,
        };
      })
      .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
  });

/** One page of a mailbox, newest first, by sequence number. */
export const listMessages = (box: string, page: number) =>
  withImap(async (client): Promise<MessageList> => {
    const lock = await client.getMailboxLock(box, { readOnly: true });
    try {
      const total = client.mailbox ? client.mailbox.exists : 0;
      const top = total - page * PAGE_SIZE;
      if (top < 1) return { box, total, page, messages: [] };
      const range = `${Math.max(1, top - PAGE_SIZE + 1)}:${top}`;
      const messages: MessageSummary[] = [];
      for await (const m of client.fetch(range, { uid: true, envelope: true, flags: true, internalDate: true })) {
        const e = m.envelope;
        messages.push({
          uid: m.uid,
          from: e?.from?.[0] ? address(e.from[0]) : null,
          to: (e?.to ?? []).map(address),
          subject: e?.subject ?? "",
          date: new Date(e?.date ?? m.internalDate ?? Date.now()).toISOString(),
          seen: m.flags?.has("\\Seen") ?? false,
          flagged: m.flags?.has("\\Flagged") ?? false,
        });
      }
      return { box, total, page, messages: messages.reverse() };
    } finally {
      lock.release();
    }
  });

/** The full message, parsed; opening it marks it read. */
export const readMessage = (box: string, uid: number) =>
  withImap(async (client): Promise<MessageDetail | null> => {
    const lock = await client.getMailboxLock(box);
    try {
      const m = await client.fetchOne(String(uid), { uid: true, source: true, flags: true }, { uid: true });
      if (!m || !m.source) return null;
      const parsed = await simpleParser(m.source);
      if (!m.flags?.has("\\Seen")) await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
      const references = parsed.references ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]) : [];
      return {
        uid,
        from: parsedAddresses(parsed.from)[0] ?? null,
        to: parsedAddresses(parsed.to),
        cc: parsedAddresses(parsed.cc),
        replyTo: parsedAddresses(parsed.replyTo),
        subject: parsed.subject ?? "",
        date: (parsed.date ?? new Date()).toISOString(),
        seen: true,
        flagged: m.flags?.has("\\Flagged") ?? false,
        html: typeof parsed.html === "string" ? parsed.html : null,
        text: parsed.text ?? "",
        messageId: parsed.messageId ?? null,
        references,
        attachments: parsed.attachments.map((a) => ({ filename: a.filename ?? "attachment", size: a.size })),
      };
    } finally {
      lock.release();
    }
  });

/** Moves a message to Trash, or deletes it for good when it's already there. */
export const trashMessage = (box: string, uid: number) =>
  withImap(async (client) => {
    const trash = (await client.list()).find((b) => b.specialUse === "\\Trash")?.path;
    const lock = await client.getMailboxLock(box);
    try {
      if (trash && trash !== box) await client.messageMove(String(uid), trash, { uid: true });
      else await client.messageDelete(String(uid), { uid: true });
    } finally {
      lock.release();
    }
  });

const MAX_RECIPIENTS = 20;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const splitAddresses = (list = "") =>
  list
    .split(/[,;]/)
    .map((a) => a.trim())
    .filter(Boolean);

/** Sends from the mailbox over SMTP and files a copy in Sent (Private Email doesn't). */
export const sendMessage = async (req: SendRequest) => {
  const to = splitAddresses(req.to);
  const cc = splitAddresses(req.cc);
  const all = [...to, ...cc];
  if (!to.length || all.length > MAX_RECIPIENTS || !all.every((a) => EMAIL.test(a))) throw new Error("Check the addresses");

  const raw = await new MailComposer({
    from: { name: FROM_NAME, address: USER },
    to,
    cc,
    subject: req.subject,
    text: req.text,
    inReplyTo: req.inReplyTo,
    references: req.references,
  })
    .compile()
    .build();
  const transport = createTransport({ host: SMTP_HOST, port: 465, secure: true, auth: { user: USER, pass: process.env.MAIL_PASSWORD ?? "" } });
  await transport.sendMail({ envelope: { from: USER, to: all }, raw });
  await withImap(async (client) => {
    const sent = (await client.list()).find((b) => b.specialUse === "\\Sent")?.path;
    if (sent) await client.append(sent, raw, ["\\Seen"]);
  }).catch(() => null);
};
