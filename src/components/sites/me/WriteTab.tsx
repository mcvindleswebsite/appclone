"use client";

import { Check, Copy, Loader2, Pencil, Send } from "lucide-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { ImageInput, Quality, ReplyOption, ReplyResult } from "@/types/me";

import { ImagePicker } from "./ImagePicker";
import { meFetch } from "./images";

const COPY = {
  reply: {
    title: "Reply for me",
    blurb: "Drop in the chat. It writes your next text, in your voice.",
    picker: "Chat screenshots",
    paste: "…or paste the chat",
    note: "Anything you want from it? (ask them out, keep it short)",
    go: "Write my reply",
  },
  opener: {
    title: "Openers",
    blurb: "Drop in their profile. It picks the best prompt or photo and writes the comment.",
    picker: "Profile screenshots",
    paste: "…or paste their prompts",
    note: "Anything you want from it? (be bold, keep it lowkey)",
    go: "Write openers",
  },
} as const;

const QUALITY_KEY = "vindle_me_quality";

/** Dollars, to the cent, or "<$0.01". */
export const dollars = (n: number) => (n < 0.01 ? "<$0.01" : `$${n.toFixed(2)}`);

/** One option, shown as the bubbles it'd send, with copy, edit, and "I sent this" (which teaches it). */
function OptionCard({ option, mode }: { option: ReplyOption; mode: "reply" | "opener" }) {
  const [text, setText] = useState(option.text);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const bubbles = text.split("\n").filter((l) => l.trim());

  const copy = async () => {
    await navigator.clipboard.writeText(bubbles.join("\n")).catch(() => null);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const sent = async () => {
    setSaved("saving");
    try {
      await meFetch("/api/me/examples", {
        method: "POST",
        json: { sent: { situation: mode === "opener" ? "opener" : "other", turns: bubbles.map((b) => ({ who: "me", text: b })) } },
      });
      setSaved("saved");
    } catch {
      setSaved("idle");
    }
  };

  return (
    <div className="rounded-3xl border border-black/10 bg-white p-5 shadow-[0_1px_8px_rgba(0,0,0,0.05)]">
      {option.target && <p className="mb-3 text-[12px] font-semibold tracking-[0.1em] text-black/50 uppercase">On: {option.target}</p>}
      {editing ? (
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={Math.max(2, bubbles.length + 1)}
          autoFocus
          className="w-full resize-none rounded-2xl border border-black p-3 text-[15px] outline-none"
        />
      ) : (
        <div className="flex flex-col items-end gap-1">
          {bubbles.map((b, i) => (
            <p key={i} className="max-w-[85%] rounded-[20px] bg-black px-4 py-2 text-[15px] leading-snug text-white">
              {b}
            </p>
          ))}
        </div>
      )}
      <p className="mt-3 text-[13px] text-black/50">{option.why}</p>
      <div className="mt-4 flex gap-2">
        <button type="button" onClick={() => void copy()} className="flex items-center gap-1.5 rounded-full bg-black px-4 py-2 text-[13px] font-semibold text-white">
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied ? "Copied" : "Copy"}
        </button>
        <button type="button" onClick={() => setEditing((e) => !e)} className="flex items-center gap-1.5 rounded-full border border-black px-4 py-2 text-[13px] font-semibold">
          <Pencil className="size-3.5" /> {editing ? "Done" : "Edit"}
        </button>
        <button
          type="button"
          onClick={() => void sent()}
          disabled={saved !== "idle"}
          className="ml-auto flex items-center gap-1.5 rounded-full px-3 py-2 text-[13px] font-semibold text-black/60 disabled:text-black"
        >
          {saved === "saving" ? <Loader2 className="size-3.5 animate-spin" /> : saved === "saved" ? <Check className="size-3.5" /> : <Send className="size-3.5" />}
          {saved === "saved" ? "Learned" : "I sent this"}
        </button>
      </div>
    </div>
  );
}

/** Reply for me / Openers: screenshots in, three options out. */
export function WriteTab({ mode }: { mode: "reply" | "opener" }) {
  const copy = COPY[mode];
  const [images, setImages] = useState<ImageInput[]>([]);
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReplyResult | null>(null);
  const [quality, setQuality] = useState<Quality>("best");

  // Remembers the last pick on this device (read after mount, so the server render matches).
  useEffect(() => {
    const saved = localStorage.getItem(QUALITY_KEY);
    if (saved === "quick" || saved === "best") setTimeout(() => setQuality(saved), 0);
  }, []);
  const pickQuality = (q: Quality) => {
    setQuality(q);
    localStorage.setItem(QUALITY_KEY, q);
  };

  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await meFetch<ReplyResult>("/api/me/write", { method: "POST", json: { mode, images, text, note, quality } }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-[32px] leading-tight font-bold">{copy.title}</h1>
        <p className="mt-1 text-[15px] text-black/60">{copy.blurb}</p>
      </div>

      <div className="flex flex-col gap-3 rounded-3xl border border-black/10 p-4">
        <ImagePicker images={images} onChange={setImages} label={copy.picker} />
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={copy.paste}
          rows={2}
          className="w-full resize-none rounded-2xl bg-black/[0.04] p-3 text-[15px] outline-none"
        />
        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={copy.note}
          className="w-full rounded-2xl bg-black/[0.04] px-3 py-2.5 text-[14px] outline-none"
        />
        <div className="flex rounded-full bg-black/[0.06] p-1 text-[13px] font-semibold">
          {(
            [
              ["quick", "Quick", "Sonnet · about half the price"],
              ["best", "Best", "Opus · sounds most like you"],
            ] as const
          ).map(([id, label, hint]) => (
            <button
              key={id}
              type="button"
              onClick={() => pickQuality(id)}
              className={cn("flex-1 rounded-full px-3 py-1.5 leading-tight", quality === id ? "bg-black text-white" : "text-black/50")}
            >
              {label}
              <span className={cn("block text-[10px] font-normal", quality === id ? "text-white/60" : "text-black/40")}>{hint}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void write()}
          disabled={busy || (!images.length && !text.trim())}
          className="flex items-center justify-center gap-2 rounded-full bg-black py-3.5 text-[15px] font-semibold text-white disabled:opacity-30"
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          {busy ? "Writing…" : copy.go}
        </button>
        {error && <p className="text-[13px] text-[#d0021b]">{error}</p>}
      </div>

      {result && (
        <div className={cn("flex flex-col gap-3", busy && "opacity-40")}>
          <p className="px-1 text-[13px] text-black/50 italic">Read: {result.read}</p>
          {result.cost !== undefined && (
            <p className="px-1 text-[12px] text-black/40">
              {result.quality === "quick" ? "Quick" : "Best"} · cost {dollars(result.cost)}
            </p>
          )}
          {result.usedFacts.length > 0 && (
            <p className="px-1 text-[13px] text-black/60">
              Leans on: <span className="font-semibold text-black">{result.usedFacts.join(" · ")}</span>
            </p>
          )}
          {result.options.map((option, i) => (
            <OptionCard key={`${i}-${option.text}`} option={option} mode={mode} />
          ))}
        </div>
      )}
    </div>
  );
}
