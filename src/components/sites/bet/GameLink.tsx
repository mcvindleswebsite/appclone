import { Radio } from "lucide-react";

import { espnPathFor } from "@/lib/bet/espn";
import { cn } from "@/lib/utils";
import type { BetLeg } from "@/types/bet";

/** How long after kickoff the link stays up: a game plus overtime, extra time, or penalties. */
const LIVE_WINDOW_MS = 3.5 * 60 * 60 * 1000;

/** True for a game that hasn't finished yet (upcoming or live). */
export const gameLinkable = (kickoffIso: string | undefined, now = Date.now()) => {
  const at = new Date(kickoffIso ?? "").getTime();
  return Number.isFinite(at) && now < at + LIVE_WINDOW_MS;
};

/** Where the button goes: ESPN for US sports (by Kalshi series), FotMob for soccer, nothing otherwise. */
const siteFor = (leg: Pick<BetLeg, "sport" | "ticker">) =>
  leg.ticker && espnPathFor(leg.ticker) ? "ESPN" : leg.sport === "Soccer" ? "FotMob" : null;

/** A small "Game" button that opens the game's live page (score, box score, lineups) in a new tab. */
export function GameLink({
  leg,
  kickoff,
  className,
}: {
  leg: Pick<BetLeg, "sport" | "ticker" | "matchup">;
  kickoff: string;
  className?: string;
}) {
  const site = siteFor(leg);
  if (!site || !leg.matchup || !gameLinkable(kickoff)) return null;
  const href = `/api/bet/game?${new URLSearchParams({ m: leg.matchup, t: kickoff, k: leg.ticker ?? "" })}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      title={`${leg.matchup} live on ${site}`}
      className={cn(
        "font-kalshi-bold inline-flex shrink-0 items-center gap-1 rounded-full border border-[#1E2638] bg-[#1E2638] px-2 py-0.5 text-[10px] text-[#F5F7F4] hover:border-(--accent)/50 hover:text-(--accent)",
        className
      )}
    >
      <Radio className="size-3" /> Game
    </a>
  );
}
