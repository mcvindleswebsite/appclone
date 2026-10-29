import { Radio } from "lucide-react";

import { cn } from "@/lib/utils";

/** How long after kickoff the link stays up: a match plus stoppage, extra time, and penalties. */
const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

/** True for a soccer game that hasn't finished yet (upcoming or live). */
export const fotmobLinkable = (kickoffIso: string | undefined, now = Date.now()) => {
  const at = new Date(kickoffIso ?? "").getTime();
  return Number.isFinite(at) && now < at + LIVE_WINDOW_MS;
};

/** A small "Game" button that opens the match on FotMob (live score, lineups, stats) in a new tab. */
export function FotmobLink({ matchup, kickoff, className }: { matchup: string; kickoff: string; className?: string }) {
  if (!matchup || !fotmobLinkable(kickoff)) return null;
  const href = `/api/bet/fotmob?${new URLSearchParams({ m: matchup, t: kickoff })}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`${matchup} on FotMob: live score, lineups, and stats`}
      className={cn(
        "font-kalshi-bold inline-flex shrink-0 items-center gap-1 rounded-full border border-[#1E2638] bg-[#1E2638] px-2 py-0.5 text-[10px] text-[#F5F7F4] hover:border-(--accent)/50 hover:text-(--accent)",
        className
      )}
    >
      <Radio className="size-3" /> Game
    </a>
  );
}
