"use client";

import { Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { SURVEY } from "@/data/me-survey";
import type { MeProfile } from "@/types/me";

import { meFetch } from "./images";
import { dollars } from "./WriteTab";

const ago = (at: number) => {
  const hours = Math.floor((Date.now() - at) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

/** About you: the survey and today's notes. Both are background it only uses when a chat is on them. */
export function YouTab({
  profile,
  onProfile,
  onSurvey,
  active,
}: {
  profile: MeProfile;
  onProfile: (p: MeProfile) => void;
  onSurvey: () => void;
  /** The tab is showing: refresh the spend total. */
  active: boolean;
}) {
  const [today, setToday] = useState("");
  const [spend, setSpend] = useState<{ total: number; calls: number } | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void meFetch<{ total: number; calls: number }>("/api/me/spend")
      .then((s) => live && setSpend(s))
      .catch(() => null);
    return () => {
      live = false;
    };
  }, [active]);
  const [busy, setBusy] = useState(false);
  const answered = Object.keys(profile.answers).length;

  const patch = async (json: Record<string, unknown>) => {
    setBusy(true);
    try {
      onProfile((await meFetch<{ profile: MeProfile }>("/api/me/profile", { method: "PATCH", json })).profile);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-serif text-[32px] leading-tight font-bold">About you</h1>
        <p className="mt-1 text-[15px] text-black/60">
          Background, not talking points. It only uses this when the other person asks or the chat is already on it, and it never
          brings up your day on its own.
        </p>
      </div>

      <div className="rounded-3xl border border-black/10 p-5">
        <p className="text-[12px] font-semibold tracking-[0.12em] text-black/50 uppercase">What did you do today?</p>
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!today.trim()) return;
            void patch({ addToday: today }).then(() => setToday(""));
          }}
        >
          <input
            value={today}
            onChange={(event) => setToday(event.target.value)}
            placeholder="gym, then wings with the boys"
            className="flex-1 rounded-full bg-black/[0.04] px-4 py-2.5 text-[15px] outline-none"
          />
          <button type="submit" disabled={busy || !today.trim()} aria-label="Add" className="grid size-10 place-items-center rounded-full bg-black text-white disabled:opacity-30">
            <Plus className="size-4" />
          </button>
        </form>
        <div className="mt-3 flex flex-col gap-1.5">
          {profile.today.map((n) => (
            <div key={n.id} className="flex items-center gap-2 text-[14px]">
              <span className="min-w-0 flex-1">{n.text}</span>
              <span className="shrink-0 text-[12px] text-black/40">{ago(n.at)}</span>
              <button type="button" aria-label="Remove" onClick={() => void patch({ removeToday: n.id })} className="text-black/40">
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12px] text-black/40">Notes reach the AI for two days, then drop off.</p>
      </div>

      <button type="button" onClick={onSurvey} className="rounded-3xl bg-black p-5 text-left text-white">
        <p className="text-[12px] font-semibold tracking-[0.12em] text-white/50 uppercase">The survey</p>
        <p className="mt-1 font-serif text-[28px] leading-tight font-bold">
          {answered === 0 ? "Teach it your life" : answered >= SURVEY.length ? "All answered" : "Keep going"}
        </p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/20">
          <div className="h-full bg-white" style={{ width: `${(answered / SURVEY.length) * 100}%` }} />
        </div>
        <p className="mt-3 text-[13px] text-white/70">
          {answered} of {SURVEY.length} answered · {answered >= SURVEY.length ? "tap to edit" : "tap to continue"}
        </p>
      </button>

      <div className="rounded-3xl border border-black/10 p-5">
        <p className="text-[12px] font-semibold tracking-[0.12em] text-black/50 uppercase">AI cost this month</p>
        <p className="mt-1 font-serif text-[40px] leading-none font-bold">{spend ? dollars(spend.total) : "—"}</p>
        <p className="mt-2 text-[13px] text-black/50">
          {spend ? `${spend.calls} AI call${spend.calls === 1 ? "" : "s"} from /me. ` : ""}Worked out from each call&apos;s token count, so
          it&apos;s close to your bill but not exact. Counting started with this update. /bet isn&apos;t included.
        </p>
      </div>
    </div>
  );
}
