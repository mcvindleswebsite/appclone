"use client";

import { ChevronLeft, X } from "lucide-react";
import { useState } from "react";

import { SURVEY } from "@/data/me-survey";
import type { MeProfile } from "@/types/me";

import { meFetch } from "./images";

/**
 * The 100-question survey, one prompt card at a time. Every answer saves as you go and any
 * question can be skipped; it opens at the first unanswered one.
 */
export function Survey({ profile, onProfile, onClose }: { profile: MeProfile; onProfile: (p: MeProfile) => void; onClose: () => void }) {
  const firstOpen = SURVEY.findIndex((q) => !profile.answers[q.id]);
  const [index, setIndex] = useState(firstOpen === -1 ? 0 : firstOpen);
  const [draft, setDraft] = useState(profile.answers[SURVEY[index].id] ?? "");
  const [saving, setSaving] = useState(false);
  const q = SURVEY[index];
  const done = Object.keys(profile.answers).length;

  const go = async (next: number, save = true) => {
    const answer = draft.trim();
    if (save && answer !== (profile.answers[q.id] ?? "")) {
      setSaving(true);
      try {
        const { profile: saved } = await meFetch<{ profile: MeProfile }>("/api/me/profile", { method: "PATCH", json: { answers: { [q.id]: answer } } });
        onProfile(saved);
      } catch {
        // Keep going; the answer is still in the box if they come back.
      } finally {
        setSaving(false);
      }
    }
    if (next >= SURVEY.length) return onClose();
    setIndex(next);
    setDraft(profile.answers[SURVEY[next].id] ?? "");
  };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-white text-black">
      <div className="h-1 bg-black/10">
        <div className="h-full bg-black transition-[width]" style={{ width: `${((index + 1) / SURVEY.length) * 100}%` }} />
      </div>
      <header className="flex items-center justify-between px-5 pt-4 pb-2 text-[13px] text-black/50">
        <button type="button" onClick={() => index > 0 && void go(index - 1)} aria-label="Back" className="p-1 disabled:opacity-0" disabled={index === 0}>
          <ChevronLeft className="size-5 text-black" />
        </button>
        <span>
          {index + 1} of {SURVEY.length} · {done} answered
        </span>
        <button type="button" onClick={() => void go(index).then(onClose)} aria-label="Close" className="p-1">
          <X className="size-5 text-black" />
        </button>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-md flex-1 flex-col overflow-y-auto px-5 pt-6">
        <p className="text-[12px] font-semibold tracking-[0.12em] text-black/50 uppercase">{q.section}</p>
        <h2 className="mt-2 font-serif text-[28px] leading-tight font-bold">{q.question}</h2>
        <textarea
          key={q.id}
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Type how you'd actually say it"
          rows={4}
          className="mt-6 w-full resize-none rounded-2xl border border-black/15 p-4 text-[16px] outline-none focus:border-black"
        />
        <p className="mt-2 text-[12px] text-black/40">Skip anything. It only brings this up when a conversation is already on it.</p>
      </div>

      <footer className="mx-auto flex w-full max-w-md gap-3 px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <button type="button" onClick={() => void go(index + 1, false)} className="flex-1 rounded-full border border-black py-3.5 text-[15px] font-semibold">
          Skip
        </button>
        <button type="button" onClick={() => void go(index + 1)} disabled={saving} className="flex-1 rounded-full bg-black py-3.5 text-[15px] font-semibold text-white disabled:opacity-40">
          {index === SURVEY.length - 1 ? "Done" : "Next"}
        </button>
      </footer>
    </div>
  );
}
