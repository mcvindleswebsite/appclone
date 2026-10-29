"use client";

import { ChevronDown, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { ImageInput, MeProfile, StyleExample } from "@/types/me";

import { ImagePicker } from "./ImagePicker";
import { meFetch } from "./images";

/** Rough milestones for how well it can copy him, by conversations learned from. */
const LEVELS = [
  { at: 0, label: "Needs examples", note: "Add your first screenshots — around 30 messages gets the basics." },
  { at: 30, label: "Getting your basics", note: "Caps, slang, length. Add flirting, banter, and dry-chat saves." },
  { at: 150, label: "Sounds like you", note: "Keep adding variety, especially your funniest stuff." },
  { at: 300, label: "Dialed in", note: "More helps less now. \"I sent this\" keeps it current." },
];

const situationLabel = (s: string) => s.replace("-", " ");

export function TrainTab({ profile, onProfile }: { profile: MeProfile; onProfile: (p: MeProfile) => void }) {
  const [examples, setExamples] = useState<StyleExample[] | null>(null);
  const [images, setImages] = useState<ImageInput[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"add" | "style" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showStyle, setShowStyle] = useState(false);
  const [banned, setBanned] = useState("");

  const load = useCallback(async () => {
    try {
      setExamples((await meFetch<{ examples: StyleExample[] }>("/api/me/examples")).examples);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't load examples");
    }
  }, []);
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  const messages = (examples ?? []).reduce((n, e) => n + e.turns.filter((t) => t.who === "me").length, 0);
  const level = [...LEVELS].reverse().find((l) => messages >= l.at) ?? LEVELS[0];
  const next = LEVELS.find((l) => l.at > messages);

  const add = async () => {
    setBusy("add");
    setNote(null);
    try {
      const data = await meFetch<{ added: number; examples: StyleExample[]; profile: MeProfile }>("/api/me/examples", {
        method: "POST",
        json: { images, text },
      });
      setExamples((prev) => [...[...data.examples].reverse(), ...(prev ?? [])]);
      onProfile(data.profile);
      setImages([]);
      setText("");
      setNote(`Learned ${data.added} conversation${data.added === 1 ? "" : "s"} and updated your style.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't add that");
    } finally {
      setBusy(null);
    }
  };

  const rebuild = async () => {
    setBusy("style");
    try {
      onProfile((await meFetch<{ profile: MeProfile }>("/api/me/style", { method: "POST" })).profile);
      setShowStyle(true);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't rebuild");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setExamples((prev) => prev?.filter((e) => e.id !== id) ?? null);
    await meFetch(`/api/me/examples?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => void load());
  };

  const saveBanned = async (list: string[]) => {
    try {
      onProfile((await meFetch<{ profile: MeProfile }>("/api/me/profile", { method: "PATCH", json: { banned: list } })).profile);
    } catch {
      // The chip list stays as it was.
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-[32px] leading-tight font-bold">Teach it you</h1>
        <p className="mt-1 text-[15px] text-black/60">Screenshots of your real chats. The more kinds of conversations, the better.</p>
      </div>

      <div className="rounded-3xl bg-black p-5 text-white">
        <p className="text-[12px] font-semibold tracking-[0.12em] text-white/50 uppercase">{level.label}</p>
        <p className="mt-1 font-serif text-[40px] leading-none font-bold">
          {examples ? messages : "—"} <span className="text-[17px] font-normal text-white/60">of your messages</span>
        </p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/20">
          <div className="h-full bg-white" style={{ width: `${Math.min(100, (messages / 300) * 100)}%` }} />
        </div>
        <p className="mt-3 text-[13px] text-white/70">
          {level.note}
          {next ? ` Next: ${next.at}.` : ""}
        </p>
      </div>

      <div className="flex flex-col gap-3 rounded-3xl border border-black/10 p-4">
        <ImagePicker images={images} onChange={setImages} label="Your chats" />
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="…or paste messages you've sent"
          rows={3}
          className="w-full resize-none rounded-2xl bg-black/[0.04] p-3 text-[15px] outline-none"
        />
        <button
          type="button"
          onClick={() => void add()}
          disabled={!!busy || (!images.length && !text.trim())}
          className="flex items-center justify-center gap-2 rounded-full bg-black py-3.5 text-[15px] font-semibold text-white disabled:opacity-30"
        >
          {busy === "add" && <Loader2 className="size-4 animate-spin" />}
          {busy === "add" ? "Reading…" : "Teach it"}
        </button>
        {note && <p className="text-[13px] text-black/60">{note}</p>}
      </div>

      <div className="rounded-3xl border border-black/10">
        <button type="button" onClick={() => setShowStyle((s) => !s)} className="flex w-full items-center gap-3 p-5 text-left">
          <div className="flex-1">
            <p className="font-serif text-xl font-bold">How you text</p>
            <p className="text-[13px] text-black/50">
              {profile.styleBuiltAt ? `Built from ${profile.styleExamples} conversations` : "Builds once you add examples"}
            </p>
          </div>
          <ChevronDown className={cn("size-5 transition-transform", showStyle && "rotate-180")} />
        </button>
        {showStyle && (
          <div className="border-t border-black/10 p-5">
            <p className="text-[14px] leading-relaxed whitespace-pre-wrap">{profile.style ?? "Nothing yet."}</p>
            <button
              type="button"
              onClick={() => void rebuild()}
              disabled={!!busy || !examples?.length}
              className="mt-4 flex items-center gap-1.5 rounded-full border border-black px-4 py-2 text-[13px] font-semibold disabled:opacity-30"
            >
              <RefreshCw className={cn("size-3.5", busy === "style" && "animate-spin")} /> Rebuild
            </button>
          </div>
        )}
      </div>

      <div className="rounded-3xl border border-black/10 p-5">
        <p className="font-serif text-xl font-bold">Never say</p>
        <p className="text-[13px] text-black/50">Anything that sounds fake. AI tells like &ldquo;I&apos;d love to&rdquo; and em dashes are already banned.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          {profile.banned.map((b) => (
            <span key={b} className="flex items-center gap-1 rounded-full bg-black/[0.06] py-1 pr-1.5 pl-3 text-[13px]">
              {b}
              <button type="button" aria-label={`Allow ${b}`} onClick={() => void saveBanned(profile.banned.filter((x) => x !== b))}>
                <X className="size-3.5 text-black/50" />
              </button>
            </span>
          ))}
        </div>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (banned.trim()) void saveBanned([...profile.banned, banned.trim()]);
            setBanned("");
          }}
        >
          <input
            value={banned}
            onChange={(event) => setBanned(event.target.value)}
            placeholder="a word or phrase"
            className="flex-1 rounded-full bg-black/[0.04] px-4 py-2 text-[14px] outline-none"
          />
          <button type="submit" aria-label="Add" className="grid size-9 place-items-center rounded-full bg-black text-white">
            <Plus className="size-4" />
          </button>
        </form>
      </div>

      <div className="flex flex-col gap-2">
        <p className="px-1 text-[12px] font-semibold tracking-[0.12em] text-black/50 uppercase">
          {examples?.length ?? 0} conversations learned
        </p>
        {examples?.map((e) => (
          <div key={e.id} className="flex items-start gap-3 rounded-2xl border border-black/10 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-black/40 uppercase">
                {situationLabel(e.situation)}
                {e.source === "sent" ? " · sent" : ""}
              </p>
              {e.turns.slice(0, 3).map((t, i) => (
                <p key={i} className={cn("truncate text-[14px]", t.who === "them" && "text-black/45")}>
                  {t.who === "me" ? "" : "them: "}
                  {t.text}
                </p>
              ))}
            </div>
            <button type="button" aria-label="Forget this" onClick={() => void remove(e.id)} className="p-1 text-black/40 hover:text-black">
              <Trash2 className="size-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
