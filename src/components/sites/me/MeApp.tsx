"use client";

import { Heart, type LucideIcon, MessageCircle, Sparkles, User } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { MeProfile } from "@/types/me";

import { HoldGate } from "./HoldGate";
import { meFetch } from "./images";
import { Survey } from "./Survey";
import { TrainTab } from "./TrainTab";
import { WriteTab } from "./WriteTab";
import { YouTab } from "./YouTab";

type Tab = "reply" | "opener" | "train" | "you";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "reply", label: "Reply", icon: MessageCircle },
  { id: "opener", label: "Openers", icon: Heart },
  { id: "train", label: "Teach", icon: Sparkles },
  { id: "you", label: "You", icon: User },
];

/**
 * /me: a reply writer that sounds like Vincent, in a black-and-white, dating-app look. Black
 * and empty until the hold-to-unlock; the first open with no survey answers starts the survey.
 */
export function MeApp() {
  const [unlocked, setUnlocked] = useState(false);
  const [profile, setProfile] = useState<MeProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("reply");
  const [survey, setSurvey] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await meFetch<{ profile: MeProfile; examples: number }>("/api/me/profile");
      setProfile(data.profile);
      if (!Object.keys(data.profile.answers).length && !data.profile.surveyDismissed) setSurvey(true);
    } catch (e) {
      if ((e as { status?: number }).status === 401) setUnlocked(false);
      else setError(e instanceof Error ? e.message : "Couldn't load");
    }
  }, []);

  useEffect(() => {
    if (!unlocked) return;
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [unlocked, load]);

  const closeSurvey = () => {
    setSurvey(false);
    if (profile && !profile.surveyDismissed) {
      void meFetch<{ profile: MeProfile }>("/api/me/profile", { method: "PATCH", json: { surveyDismissed: true } })
        .then((d) => setProfile(d.profile))
        .catch(() => null);
    }
  };

  if (!unlocked) return <HoldGate onUnlock={() => setUnlocked(true)} />;

  return (
    // The site locks html/body to the viewport (for the iPod), so /me scrolls inside its own layer.
    <div className="fixed inset-0 overflow-y-auto overscroll-contain bg-white font-sans text-black">
      <header className="sticky top-0 z-20 border-b border-black/10 bg-white/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 max-w-md items-center px-5">
          <span className="font-serif text-[26px] font-bold tracking-tight">me</span>
        </div>
      </header>

      <main className="mx-auto max-w-md px-5 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))]">
        {error ? (
          <p className="text-[14px] text-[#d0021b]">{error}</p>
        ) : !profile ? (
          <p className="text-[14px] text-black/40">Loading…</p>
        ) : (
          <>
            {/* Every tab stays mounted, so switching doesn't lose a draft or its replies. */}
            <div hidden={tab !== "reply"}>
              <WriteTab mode="reply" />
            </div>
            <div hidden={tab !== "opener"}>
              <WriteTab mode="opener" />
            </div>
            <div hidden={tab !== "train"}>
              <TrainTab profile={profile} onProfile={setProfile} />
            </div>
            <div hidden={tab !== "you"}>
              <YouTab profile={profile} onProfile={setProfile} onSurvey={() => setSurvey(true)} />
            </div>
          </>
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-black/10 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-md">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn("flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-semibold", tab === id ? "text-black" : "text-black/35")}
            >
              <Icon className={cn("size-6", tab === id && "fill-black")} strokeWidth={tab === id ? 2.2 : 1.8} />
              {label}
            </button>
          ))}
        </div>
      </nav>

      {survey && profile && <Survey profile={profile} onProfile={setProfile} onClose={closeSurvey} />}
    </div>
  );
}
