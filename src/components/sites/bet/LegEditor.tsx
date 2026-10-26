"use client";

import { Plus, X } from "lucide-react";

import { formatAmerican } from "@/lib/bet/engine";
import { detectSport, emptyLeg } from "@/lib/bet/parse-slip";
import { cn } from "@/lib/utils";
import { MAX_LEGS, type BetLeg, type BetSlip } from "@/types/bet";

import { T } from "./theme";

export function LegEditor({ slip, onChange }: { slip: BetSlip; onChange: (slip: BetSlip) => void }) {
  const setLeg = (index: number, patch: Partial<BetLeg>) =>
    onChange({ ...slip, legs: slip.legs.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)) });
  /** Text edits also re-detect the leg's sport, since there's no sport picker. */
  const setText = (index: number, patch: Partial<Pick<BetLeg, "market" | "pick" | "matchup">>) => {
    const leg = { ...slip.legs[index], ...patch };
    const detected = detectSport(`${leg.matchup} ${leg.market} ${leg.pick}`);
    setLeg(index, { ...patch, sport: detected === "Other" ? leg.sport : detected });
  };
  const removeLeg = (index: number) => onChange({ ...slip, legs: slip.legs.filter((_, i) => i !== index) });
  const addLeg = () => onChange({ ...slip, legs: [...slip.legs, emptyLeg(slip.legs.at(-1)?.sport)] });
  const multi = slip.legs.length > 1;

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2">
        {slip.legs.map((leg, i) => (
          <li key={i} className={cn(T.inset, "flex flex-col gap-2 p-3")}>
            <div className="flex h-6 items-center gap-2">
              <span className="font-kalshi-bold flex size-6 shrink-0 items-center justify-center rounded-md bg-[#1E2638] text-[11px]">
                {i + 1}
              </span>
              <span className={cn(T.label, "flex-1")}>
                Leg {i + 1}
                {(leg.market || leg.pick || leg.matchup) && leg.sport !== "Other" && (
                  <span className="text-[#F5F7F4]/35"> · {leg.sport}</span>
                )}
              </span>
              {(leg.price !== null || leg.americanOdds !== null) && (
                <span
                  title="From the Kalshi link or screenshot — the price the AI's estimate is measured against"
                  className="rounded-md bg-[#1E2638] px-2 py-0.5 text-[11px] tabular-nums text-[#F5F7F4]/70"
                >
                  Market {leg.price !== null ? `${leg.price}%` : formatAmerican(leg.americanOdds!)}
                </span>
              )}
              {multi && (
                <button
                  type="button"
                  aria-label={`Remove leg ${i + 1}`}
                  onClick={() => removeLeg(i)}
                  // 44px tap target that doesn't grow the 24px row.
                  className="-my-2.5 -mr-2 flex size-11 items-center justify-center rounded-md text-[#F5F7F4]/35 hover:bg-[#FF3B30]/10 hover:text-[#FF3B30] sm:my-0 sm:mr-0 sm:size-7"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            {/* Three inputs: selection on its own row, then pick and game (stacked on phones).
                Prices aren't typed in: the AI estimates every leg's odds itself, and a market
                price only comes from a Kalshi link or screenshot. */}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                value={leg.market}
                onChange={(e) => setText(i, { market: e.target.value })}
                placeholder="Selection (Bournemouth to win)"
                aria-label={`Leg ${i + 1} market or selection`}
                className={cn(T.input, "sm:col-span-2")}
              />
              <input
                value={leg.pick}
                onChange={(e) => setText(i, { pick: e.target.value })}
                placeholder="Pick / Player"
                aria-label={`Leg ${i + 1} pick or player`}
                className={T.input}
              />
              <input
                value={leg.matchup}
                onChange={(e) => setText(i, { matchup: e.target.value })}
                placeholder="Matchup / Game"
                aria-label={`Leg ${i + 1} matchup or game`}
                className={T.input}
              />
            </div>
          </li>
        ))}
      </ol>

      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <button
          type="button"
          disabled={slip.legs.length >= MAX_LEGS}
          onClick={addLeg}
          className="col-span-2 flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-[#1E2638] px-3 text-sm font-semibold hover:bg-(--accent-deep) disabled:opacity-40 sm:min-h-9 sm:text-xs"
        >
          <Plus className="size-4 sm:size-3.5" /> Add leg ({slip.legs.length}/{MAX_LEGS})
        </button>
        {multi && (slip.comboPrice !== null || slip.comboOdds !== null) && (
          <span className="col-span-2 self-center text-xs text-[#F5F7F4]/60">
            Combo market: {slip.comboPrice !== null ? `${slip.comboPrice}%` : formatAmerican(slip.comboOdds!)}
          </span>
        )}
      </div>
    </div>
  );
}
