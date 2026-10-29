"use client";

import { Download, Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import type { MeProfile, StyleExample } from "@/types/me";

import { meFetch } from "./images";
import { type IgThread, ownerCandidates, readInstagram, toConversations } from "./instagram";

const PER_REQUEST = 300;

/** Imports his Instagram DMs from the data download: read in the browser, no AI needed. */
export function InstagramImport({ onImported, onProfile }: { onImported: (examples: StyleExample[]) => void; onProfile: (p: MeProfile) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [threads, setThreads] = useState<IgThread[] | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [me, setMe] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const conversations = useMemo(() => (threads && me ? toConversations(threads, me) : []), [threads, me]);
  const mine = conversations.reduce((n, c) => n + c.turns.filter((t) => t.who === "me").length, 0);
  const chats = new Set(conversations.map((c) => c.id.split("_")[1])).size;

  const pick = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setNote(null);
    setThreads(null);
    try {
      const read = await readInstagram(files, setNote);
      const candidates = ownerCandidates(read);
      setThreads(read);
      setNames(candidates);
      setMe(candidates[0] ?? "");
      setNote(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't read that");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      for (let i = 0; i < conversations.length; i += PER_REQUEST) {
        setNote(`Saving ${Math.min(i + PER_REQUEST, conversations.length)} of ${conversations.length} conversations…`);
        await meFetch("/api/me/import", { method: "POST", json: { conversations: conversations.slice(i, i + PER_REQUEST), replace: i === 0 } });
      }
      onImported(conversations.map((c) => ({ ...c, source: "instagram", situation: "other" })));
      setNote("Updating your style…");
      onProfile((await meFetch<{ profile: MeProfile }>("/api/me/style", { method: "POST" })).profile);
      setNote(`Learned ${mine} of your messages from ${chats} Instagram chats.`);
      setThreads(null);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't save that");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-3xl border border-black/10 p-5">
      <div>
        <p className="font-serif text-xl font-bold">Instagram DMs</p>
        <p className="text-[13px] text-black/50">
          Settings → Accounts Center → Your information and permissions → Download your information. Pick Messages only, format JSON,
          then choose the zip here. Photos in it are skipped.
        </p>
      </div>

      {threads ? (
        <div className="flex flex-col gap-3">
          <label className="flex items-center gap-2 text-[14px]">
            <span className="text-black/50">You are</span>
            <select value={me} onChange={(event) => setMe(event.target.value)} className="min-w-0 flex-1 rounded-full bg-black/[0.04] px-3 py-1.5 outline-none">
              {names.slice(0, 8).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <p className="text-[14px]">
            {threads.length} chats found. It&apos;ll learn <b>{mine}</b> of your messages from {chats} of them, newest first.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={() => setThreads(null)} disabled={busy} className="flex-1 rounded-full border border-black py-3 text-[14px] font-semibold">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy || !conversations.length}
              className="flex flex-1 items-center justify-center gap-2 rounded-full bg-black py-3 text-[14px] font-semibold text-white disabled:opacity-30"
            >
              {busy && <Loader2 className="size-4 animate-spin" />} Import
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy}
          className="flex items-center justify-center gap-2 rounded-full border border-black py-3 text-[14px] font-semibold disabled:opacity-30"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Choose the download
        </button>
      )}
      {note && <p className="text-[13px] text-black/60">{note}</p>}
      <input
        ref={input}
        type="file"
        accept=".zip,.json,application/zip,application/json"
        multiple
        hidden
        onChange={(event) => {
          void pick([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
