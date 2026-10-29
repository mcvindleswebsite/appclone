"use client";

import {
  Archive,
  ChevronLeft,
  FileText,
  Folder,
  Forward,
  Inbox as InboxIcon,
  Loader2,
  type LucideIcon,
  OctagonAlert,
  Paperclip,
  RefreshCw,
  Reply,
  Send,
  SquarePen,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { MailAddress, MailboxInfo, MessageDetail, MessageList, MessageSummary } from "@/types/inbox";

import { ComposeSheet, EMPTY_DRAFT, type Draft } from "./ComposeSheet";

const ACCOUNT = "vincent@mcvindle.com";
const POLL_MS = 60_000;

const BOX_ICON: Record<string, LucideIcon> = {
  "\\Inbox": InboxIcon,
  "\\Drafts": FileText,
  "\\Sent": Send,
  "\\Junk": OctagonAlert,
  "\\Trash": Trash2,
  "\\Archive": Archive,
};

const DAY = 24 * 60 * 60 * 1000;

/** Apple Mail's list dates: a time today, "Yesterday", a weekday this week, else the date. */
const listDate = (iso: string) => {
  const d = new Date(iso);
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const t = d.getTime();
  if (t >= midnight.getTime()) return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (t >= midnight.getTime() - DAY) return "Yesterday";
  if (t >= midnight.getTime() - 6 * DAY) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
};

const fullDate = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });

const who = (a: MailAddress | null) => (a ? a.name || a.address : "Unknown sender");
const initials = (a: MailAddress | null) =>
  who(a)
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/** HTML mail runs in a sandboxed frame: no scripts, no requests but images, styles, and fonts. */
const srcDoc = (html: string) => `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src * data:; style-src 'unsafe-inline' *; font-src * data:">
<base target="_blank"><style>body{margin:0;padding:20px 24px;font:14px/1.45 -apple-system,BlinkMacSystemFont,"Helvetica Neue",sans-serif;color:#1d1d1f;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style>
</head><body>${html}</body></html>`;

const quote = (m: MessageDetail) => `\n\nOn ${fullDate(m.date)}, ${who(m.from)} wrote:\n${m.text.replace(/^/gm, "> ")}`;

const replyDraft = (m: MessageDetail): Draft => ({
  to: (m.replyTo[0] ?? m.from)?.address ?? "",
  cc: "",
  subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`,
  text: quote(m),
  inReplyTo: m.messageId ?? undefined,
  references: [...m.references, ...(m.messageId ? [m.messageId] : [])],
});

const forwardDraft = (m: MessageDetail): Draft => ({
  ...EMPTY_DRAFT,
  subject: /^fwd?:/i.test(m.subject) ? m.subject : `Fwd: ${m.subject}`,
  text: `\n\nBegin forwarded message:\n\nFrom: ${who(m.from)} <${m.from?.address ?? ""}>\nSubject: ${m.subject}\nDate: ${fullDate(m.date)}\nTo: ${m.to
    .map((a) => a.address)
    .join(", ")}\n\n${m.text}`,
});

const getJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(url, init);
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw Object.assign(new Error(data.error ?? "Something went wrong"), { status: response.status });
  return data;
};

type Pane = "boxes" | "list" | "reader";

/**
 * The full-screen inbox, laid out like Apple Mail: mailboxes, the message list, and the
 * reader. On a phone it's one column at a time. The red light locks it and zooms back.
 */
export function Inbox({ onLock }: { onLock: () => void }) {
  const [boxes, setBoxes] = useState<MailboxInfo[]>([]);
  const [box, setBox] = useState("INBOX");
  const [list, setList] = useState<MessageList | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [message, setMessage] = useState<MessageDetail | null>(null);
  const [reading, setReading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pane, setPane] = useState<Pane>("list");

  const fail = useCallback(
    (e: unknown) => {
      if ((e as { status?: number }).status === 401) return onLock();
      setError(e instanceof Error ? e.message : "Something went wrong");
    },
    [onLock]
  );

  const refresh = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const [b, l] = await Promise.all([
          getJson<{ mailboxes: MailboxInfo[] }>("/api/inbox/mailboxes"),
          getJson<MessageList>(`/api/inbox/messages?box=${encodeURIComponent(box)}`),
        ]);
        setBoxes(b.mailboxes);
        // A quiet refresh keeps any older pages already loaded.
        setList((prev) =>
          quiet && prev?.box === l.box && prev.page > 0
            ? { ...l, page: prev.page, messages: [...l.messages, ...prev.messages.filter((m) => !l.messages.some((n) => n.uid === m.uid))] }
            : l
        );
        setError(null);
      } catch (e) {
        fail(e);
      } finally {
        setLoading(false);
      }
    },
    [box, fail]
  );

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh(true);
    }, POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refresh]);

  const loadMore = async () => {
    if (!list) return;
    setLoading(true);
    try {
      const next = await getJson<MessageList>(`/api/inbox/messages?box=${encodeURIComponent(box)}&page=${list.page + 1}`);
      setList({ ...next, messages: [...list.messages, ...next.messages] });
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  };

  const openMessage = async (m: MessageSummary) => {
    setSelected(m.uid);
    setPane("reader");
    setReading(true);
    setMessage(null);
    try {
      const detail = await getJson<MessageDetail>(`/api/inbox/message?box=${encodeURIComponent(box)}&uid=${m.uid}`);
      setMessage(detail);
      if (!m.seen) {
        setList((l) => (l ? { ...l, messages: l.messages.map((x) => (x.uid === m.uid ? { ...x, seen: true } : x)) } : l));
        setBoxes((bs) => bs.map((b) => (b.path === box ? { ...b, unseen: Math.max(0, b.unseen - 1) } : b)));
      }
    } catch (e) {
      fail(e);
    } finally {
      setReading(false);
    }
  };

  const trash = async () => {
    if (!message) return;
    const uid = message.uid;
    try {
      await getJson(`/api/inbox/message?box=${encodeURIComponent(box)}&uid=${uid}`, { method: "DELETE" });
      setList((l) => (l ? { ...l, total: l.total - 1, messages: l.messages.filter((m) => m.uid !== uid) } : l));
      setMessage(null);
      setSelected(null);
      setPane("list");
    } catch (e) {
      fail(e);
    }
  };

  const chooseBox = (path: string) => {
    if (path !== box) {
      setBox(path);
      setList(null);
      setMessage(null);
      setSelected(null);
    }
    setPane("list");
  };

  const current = boxes.find((b) => b.path === box);
  const unread = list?.messages.filter((m) => !m.seen).length ?? 0;
  const iconButton = "grid size-8 place-items-center rounded-md text-(--ib-muted) hover:bg-(--ib-hover) hover:text-(--ib-text) disabled:opacity-40";

  return (
    <div className="relative flex h-full">
      {/* Mailboxes */}
      <aside className={cn("w-full shrink-0 flex-col bg-(--ib-sidebar) md:flex md:w-56", pane === "boxes" ? "flex" : "hidden")}>
        <div className="flex items-center gap-2 px-4 pt-4 pb-3">
          <button type="button" onClick={onLock} aria-label="Lock and close" className="size-3 rounded-full bg-[#ff5f57]" />
          <span className="size-3 rounded-full bg-[#febc2e]" />
          <span className="size-3 rounded-full bg-[#28c840]" />
        </div>
        <p className="px-4 pb-1 text-[11px] font-semibold text-(--ib-muted)">Mailboxes</p>
        <nav className="flex-1 overflow-y-auto px-2">
          {boxes.map((b) => {
            const Icon = (b.specialUse && BOX_ICON[b.specialUse]) || Folder;
            const active = b.path === box;
            return (
              <button
                key={b.path}
                type="button"
                onClick={() => chooseBox(b.path)}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px]",
                  active ? "bg-(--ib-sidebar-active)" : "hover:bg-(--ib-sidebar-hover)"
                )}
              >
                <Icon className="size-4 shrink-0 text-(--ib-accent)" />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                {b.unseen > 0 && <span className="text-[12px] text-(--ib-muted) tabular-nums">{b.unseen}</span>}
              </button>
            );
          })}
        </nav>
        <p className="truncate border-t border-(--ib-line) px-4 py-3 text-[11px] text-(--ib-muted)">{ACCOUNT}</p>
      </aside>

      {/* Message list */}
      <section
        className={cn(
          "w-full shrink-0 flex-col border-r border-(--ib-line) md:flex md:w-[340px] lg:w-[380px]",
          pane === "list" ? "flex" : "hidden"
        )}
      >
        <header className="flex items-end gap-2 border-b border-(--ib-line) px-4 pt-4 pb-2.5">
          <button type="button" onClick={() => setPane("boxes")} aria-label="Mailboxes" className={cn(iconButton, "md:hidden")}>
            <ChevronLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-bold">{current?.name ?? (box === "INBOX" ? "Inbox" : box)}</h1>
            <p className="text-[11px] text-(--ib-muted)">
              {list ? `${list.total.toLocaleString("en-US")} messages${unread ? `, ${unread} unread` : ""}` : "Loading…"}
            </p>
          </div>
          <button type="button" onClick={() => void refresh()} disabled={loading} aria-label="Get mail" className={iconButton}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </button>
          <button type="button" onClick={() => setDraft(EMPTY_DRAFT)} aria-label="New message" className={iconButton}>
            <SquarePen className="size-4" />
          </button>
        </header>
        {error && <p className="border-b border-(--ib-line) px-4 py-2 text-[12px] text-[#ff3b30]">{error}</p>}
        <div className="flex-1 overflow-y-auto">
          {list?.messages.map((m) => {
            const active = m.uid === selected;
            return (
              <button
                key={m.uid}
                type="button"
                onClick={() => void openMessage(m)}
                className={cn(
                  "relative flex w-full gap-2 py-2.5 pr-4 pl-6 text-left",
                  active ? "bg-(--ib-selected) text-white" : "hover:bg-(--ib-hover)"
                )}
              >
                {!m.seen && <span className={cn("absolute top-[15px] left-2 size-2.5 rounded-full", active ? "bg-white" : "bg-(--ib-accent)")} />}
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-2">
                    <span className={cn("min-w-0 flex-1 truncate text-[14px]", !m.seen && "font-semibold")}>
                      {current?.specialUse === "\\Sent" ? `To: ${who(m.to[0] ?? null)}` : who(m.from)}
                    </span>
                    <span className={cn("shrink-0 text-[12px]", active ? "text-white/80" : "text-(--ib-muted)")}>{listDate(m.date)}</span>
                  </span>
                  <span className={cn("block truncate text-[13px]", active ? "text-white/90" : "")}>{m.subject || "(No Subject)"}</span>
                </span>
              </button>
            );
          })}
          {list && list.messages.length === 0 && <p className="p-8 text-center text-[13px] text-(--ib-muted)">No Messages</p>}
          {list && list.messages.length < list.total && (
            <button type="button" onClick={() => void loadMore()} disabled={loading} className="w-full py-3 text-[13px] text-(--ib-accent)">
              {loading ? "Loading…" : "Load More Messages"}
            </button>
          )}
        </div>
      </section>

      {/* Reader */}
      <section className={cn("min-w-0 flex-1 flex-col md:flex", pane === "reader" ? "flex" : "hidden")}>
        <header className="flex items-center gap-1 border-b border-(--ib-line) px-3 py-2">
          <button type="button" onClick={() => setPane("list")} aria-label="Back" className={cn(iconButton, "md:hidden")}>
            <ChevronLeft className="size-5" />
          </button>
          <div className="flex-1" />
          <button type="button" onClick={() => message && setDraft(replyDraft(message))} disabled={!message} aria-label="Reply" className={iconButton}>
            <Reply className="size-4" />
          </button>
          <button type="button" onClick={() => message && setDraft(forwardDraft(message))} disabled={!message} aria-label="Forward" className={iconButton}>
            <Forward className="size-4" />
          </button>
          <button type="button" onClick={() => void trash()} disabled={!message} aria-label="Move to Trash" className={iconButton}>
            <Trash2 className="size-4" />
          </button>
        </header>
        {reading ? (
          <div className="grid flex-1 place-items-center">
            <Loader2 className="size-5 animate-spin text-(--ib-muted)" />
          </div>
        ) : message ? (
          <>
            <div className="flex gap-3 border-b border-(--ib-line) px-6 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-linear-to-b from-[#a1a1a6] to-[#86868b] text-[14px] font-semibold text-white">
                {initials(message.from)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline gap-3">
                  <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{who(message.from)}</p>
                  <p className="shrink-0 text-[12px] text-(--ib-muted)">{fullDate(message.date)}</p>
                </div>
                <p className="truncate text-[15px] font-semibold">{message.subject || "(No Subject)"}</p>
                <p className="truncate text-[12px] text-(--ib-muted)">
                  To: {message.to.map((a) => a.name || a.address).join(", ")}
                  {message.cc.length ? ` · Cc: ${message.cc.map((a) => a.name || a.address).join(", ")}` : ""}
                </p>
              </div>
            </div>
            {message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 border-b border-(--ib-line) px-6 py-2">
                {message.attachments.map((a, i) => (
                  <span key={`${a.filename}-${i}`} className="flex items-center gap-1 rounded-md bg-(--ib-hover) px-2 py-1 text-[12px]">
                    <Paperclip className="size-3" /> {a.filename}
                    <span className="text-(--ib-muted)">{Math.max(1, Math.round(a.size / 1024))} KB</span>
                  </span>
                ))}
              </div>
            )}
            {message.html ? (
              <iframe
                title={message.subject || "Message"}
                srcDoc={srcDoc(message.html)}
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                className="w-full flex-1 border-0 bg-white"
              />
            ) : (
              <div className="flex-1 overflow-y-auto px-6 py-5 text-[14px] leading-relaxed whitespace-pre-wrap">{message.text}</div>
            )}
          </>
        ) : (
          <div className="grid flex-1 place-items-center text-[15px] text-(--ib-muted)">No Message Selected</div>
        )}
      </section>

      {draft && (
        <ComposeSheet
          initial={draft}
          onClose={() => setDraft(null)}
          onSent={() => {
            setDraft(null);
            void refresh(true);
          }}
        />
      )}
    </div>
  );
}
