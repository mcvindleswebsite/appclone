"use client";

import { ChevronDown, Loader2, Plus, RefreshCw, ScanLine, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { ImageInput, MeProfile, StyleExample } from "@/types/me";

import { ImagePicker } from "./ImagePicker";
import { InstagramImport } from "./InstagramImport";
import { meFetch } from "./images";

/** Rough milestones for how well it can copy him, by conversations learned from. */
const LEVELS = [
  { at: 0, label: "Needs examples", note: "Add your first screenshots — around 30 messages gets the basics." },
  { at: 30, label: "Getting your basics", note: "Caps, slang, length. Add flirting, banter, and dry-chat saves." },
  { at: 150, label: "Sounds like you", note: "Keep adding variety, especially your funniest stuff." },
  { at: 300, label: "Dialed in", note: "More helps less now. \"I sent this\" keeps it current." },
];

const situationLabel = (s: string) => s.replace("-", " ");

/** Screenshots go up a few per request, each read on its own, so no request runs long. */
const PER_REQUEST = 3;
const MAX_SCREENSHOTS = 30;

const myMessages = (examples: StyleExample[]) => examples.reduce((n, e) => n + e.turns.filter((t) => t.who === "me").length, 0);

/** Runs `run` over `items`, `width` at a time, calling `onDone` after each. */
const pool = async <T,>(items: T[], width: number, run: (item: T) => Promise<void>, onDone: () => void) => {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      await run(items[next++]);
      onDone();
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, lane));
};

export function TrainTab({ profile, onProfile }: { profile: MeProfile; onProfile: (p: MeProfile) => void }) {
  const [examples, setExamples] = useState<StyleExample[] | null>(null);
  const [images, setImages] = useState<ImageInput[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"add" | "style" | "rescan" | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  /** Conversations from before screenshots were kept; set after a rescan finds some. */
  const [unsaved, setUnsaved] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const [showStyle, setShowStyle] = useState(false);
  const [banned, setBanned] = useState("");
  /** An Instagram import can be thousands of conversations; the list grows in pages. */
  const [shown, setShown] = useState(40);

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

  const messages = myMessages(examples ?? []);
  const level = [...LEVELS].reverse().find((l) => messages >= l.at) ?? LEVELS[0];
  const next = LEVELS.find((l) => l.at > messages);

  const add = async () => {
    setBusy("add");
    setNote(null);
    const total = images.length;
    const batches: { images: ImageInput[]; text: string }[] = [];
    for (let i = 0; i < Math.max(total, 1); i += PER_REQUEST) batches.push({ images: images.slice(i, i + PER_REQUEST), text: "" });
    batches[0].text = text;
    let done = 0;
    let added: StyleExample[] = [];
    let failed: string | null = null;
    if (total) setProgress(`Reading 0 of ${total} screenshots…`);
    try {
      await pool(
        batches,
        2,
        async (batch) => {
          try {
            const data = await meFetch<{ examples: StyleExample[] }>("/api/me/examples", {
              method: "POST",
              json: { ...batch, rebuild: false },
            });
            added = [...added, ...data.examples];
          } catch (e) {
            failed = e instanceof Error ? e.message : "Couldn't read some of them";
          }
          done += batch.images.length;
        },
        () => {
          if (total) setProgress(`Reading ${done} of ${total} screenshots…`);
        }
      );
      if (added.length) {
        setExamples((prev) => [...[...added].sort((a, b) => b.createdAt - a.createdAt), ...(prev ?? [])]);
        setImages([]);
        setText("");
        setProgress("Updating your style…");
        onProfile((await meFetch<{ profile: MeProfile }>("/api/me/style", { method: "POST" })).profile);
      }
      const learned = `Learned ${myMessages(added)} of your messages from ${added.length} conversation${added.length === 1 ? "" : "s"}.`;
      setNote(added.length ? (failed ? `${learned} Some didn't go through: ${failed}` : learned) : (failed ?? "Couldn't add that"));
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't add that");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const rescan = async () => {
    setBusy("rescan");
    setNote(null);
    try {
      const { sources, unsaved: older } = await meFetch<{ sources: string[]; unsaved: number }>("/api/me/rescan");
      setUnsaved(older);
      if (!sources.length) {
        setNote(older ? "None of these were saved as screenshots, so there's nothing to rescan yet." : "Nothing to rescan yet.");
        return;
      }
      let done = 0;
      let failed = 0;
      setProgress(`Rescanning 0 of ${sources.length}…`);
      await pool(
        sources,
        3,
        async (id) => {
          await meFetch("/api/me/rescan", { method: "POST", json: { id } }).catch(() => failed++);
          done++;
        },
        () => setProgress(`Rescanning ${done} of ${sources.length}…`)
      );
      setProgress("Updating your style…");
      const [list, style] = await Promise.all([
        meFetch<{ examples: StyleExample[] }>("/api/me/examples"),
        meFetch<{ profile: MeProfile }>("/api/me/style", { method: "POST" }),
      ]);
      setExamples(list.examples);
      onProfile(style.profile);
      setNote(
        `Rescanned ${sources.length - failed} of ${sources.length}: ${myMessages(list.examples)} of your messages now.` +
          (failed ? " Run it again for the rest." : "")
      );
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't rescan");
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const forgetUnsaved = async () => {
    try {
      const { removed } = await meFetch<{ removed: string[] }>("/api/me/examples?unsaved=1", { method: "DELETE" });
      setExamples((prev) => prev?.filter((e) => !removed.includes(e.id)) ?? null);
      setUnsaved(0);
      setNote(`Forgot ${removed.length}. Add those screenshots again and they'll be read properly.`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "Couldn't do that");
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
        <ImagePicker images={images} onChange={setImages} label="Your chats" max={MAX_SCREENSHOTS} />
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
          {busy === "add" ? (progress ?? "Reading…") : "Teach it"}
        </button>
        {busy === "rescan" && progress && <p className="text-[13px] text-black/60">{progress}</p>}
        {note && <p className="text-[13px] text-black/60">{note}</p>}
        {unsaved > 0 && !busy && (
          <div className="rounded-2xl bg-black/[0.04] p-3 text-[13px]">
            <p className="text-black/70">
              {unsaved} conversation{unsaved === 1 ? " was" : "s were"} added before screenshots were saved, so{" "}
              {unsaved === 1 ? "it" : "they"} can&apos;t be rescanned. Forget {unsaved === 1 ? "it" : "them"}, then add those screenshots
              again.
            </p>
            <button type="button" onClick={() => void forgetUnsaved()} className="mt-2 rounded-full bg-black px-4 py-1.5 font-semibold text-white">
              Forget {unsaved} older
            </button>
          </div>
        )}
      </div>

      <InstagramImport
        onProfile={onProfile}
        onImported={(imported) =>
          setExamples((prev) => [...imported, ...(prev ?? []).filter((e) => e.source !== "instagram")].sort((a, b) => b.createdAt - a.createdAt))
        }
      />

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
        <div className="flex items-center justify-between px-1">
          <p className="text-[12px] font-semibold tracking-[0.12em] text-black/50 uppercase">
            {examples?.length ?? 0} conversations · {messages} messages
          </p>
          <button
            type="button"
            onClick={() => void rescan()}
            disabled={!!busy || !examples?.length}
            className="flex items-center gap-1.5 rounded-full border border-black px-3 py-1 text-[12px] font-semibold disabled:opacity-30"
          >
            {busy === "rescan" ? <Loader2 className="size-3.5 animate-spin" /> : <ScanLine className="size-3.5" />} Rescan
          </button>
        </div>
        {examples?.slice(0, shown).map((e) => (
          <div key={e.id} className="flex items-start gap-3 rounded-2xl border border-black/10 p-3">
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-semibold tracking-[0.08em] text-black/40 uppercase">
                {e.source === "instagram" ? "instagram" : situationLabel(e.situation)}
                {e.source === "sent" ? " · sent" : ` · ${e.turns.filter((t) => t.who === "me").length} yours`}
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
        {examples && examples.length > shown && (
          <button type="button" onClick={() => setShown((n) => n + 40)} className="rounded-full border border-black/15 py-2.5 text-[13px] font-semibold">
            Show more ({examples.length - shown} left)
          </button>
        )}
      </div>
    </div>
  );
}
