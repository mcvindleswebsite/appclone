"use client";

import { Loader2, Send } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { SendRequest } from "@/types/inbox";

export type Draft = Omit<SendRequest, "cc"> & { cc: string };

export const EMPTY_DRAFT: Draft = { to: "", cc: "", subject: "", text: "" };

/** Apple Mail's New Message sheet: To, Cc, Subject, body; Send files a copy in Sent. */
export function ComposeSheet({ initial, onClose, onSent }: { initial: Draft; onClose: () => void; onSent: () => void }) {
  const [draft, setDraft] = useState(initial);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (field: keyof Draft) => (event: { target: { value: string } }) => setDraft((d) => ({ ...d, [field]: event.target.value }));

  const send = async () => {
    if (!draft.to.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch("/api/inbox/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Couldn't send");
      }
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't send");
      setSending(false);
    }
  };

  const field = "w-full bg-transparent py-2 text-[14px] outline-none";

  return (
    <div className="absolute inset-0 z-10 flex items-start justify-center bg-black/25 p-4 pt-[8vh]" onPointerDown={onClose}>
      <div
        className="flex h-[min(80vh,640px)] w-full max-w-[640px] flex-col overflow-hidden rounded-xl bg-(--ib-sheet) shadow-[0_24px_70px_rgba(0,0,0,0.35)]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-(--ib-line) px-4 py-2.5">
          <button type="button" onClick={onClose} className="text-[14px] text-(--ib-accent)">
            Cancel
          </button>
          <p className="text-[14px] font-semibold">{draft.subject || "New Message"}</p>
          <button
            type="button"
            onClick={() => void send()}
            disabled={!draft.to.trim() || sending}
            aria-label="Send"
            className="grid size-8 place-items-center rounded-full bg-(--ib-accent) text-white disabled:opacity-40"
          >
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </button>
        </div>
        <div className="px-4">
          {(["to", "cc", "subject"] as const).map((name) => (
            <label key={name} className="flex items-center gap-2 border-b border-(--ib-line)">
              <span className="w-14 shrink-0 text-[14px] text-(--ib-muted)">{name === "subject" ? "Subject:" : name === "to" ? "To:" : "Cc:"}</span>
              <input value={draft[name]} onChange={set(name)} autoFocus={name === "to" && !draft.to} className={field} />
            </label>
          ))}
        </div>
        <textarea
          value={draft.text}
          onChange={set("text")}
          autoFocus={!!draft.to}
          className={cn(field, "flex-1 resize-none px-4 py-3 leading-relaxed")}
        />
        {error && <p className="border-t border-(--ib-line) px-4 py-2 text-[12px] text-[#ff3b30]">{error}</p>}
      </div>
    </div>
  );
}
