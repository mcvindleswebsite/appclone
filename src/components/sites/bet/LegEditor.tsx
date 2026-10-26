"use client";

import { Plus, X } from "lucide-react";

import { emptyLeg, SPORTS } from "@/lib/bet/parse-slip";
import { cn } from "@/lib/utils";
import { MAX_LEGS, type BetLeg, type BetSlip } from "@/types/bet";

import { T } from "./theme";

const numberOrNull = (value: string, min: number, max: number) => {
  const n = Number(value.replace(/[^\d+-]/g, ""));
  return value.trim() && Number.isFinite(n) && n >= min && n <= max ? n : null;
};

const oddsOrNull = (value: string) => {
  const n = Number(value.replace(/\s/g, ""));
  return Number.isFinite(n) && Math.abs(n) >= 100 ? n : null;
};

export function LegEditor({ slip, onChange }: { slip: BetSlip; onChange: (slip: BetSlip) => void }) {
  const setLeg = (index: number, patch: Partial<BetLeg>) =>
    onChange({ ...slip, legs: slip.legs.map((leg, i) => (i === index ? { ...leg, ...patch } : leg)) });
  const removeLeg = (index: number) => onChange({ ...slip, legs: slip.legs.filter((_, i) => i !== index) });
  const addLeg = () => onChange({ ...slip, legs: [...slip.legs, emptyLeg(slip.legs.at(-1)?.sport)] });
  const multi = slip.legs.length > 1;

  return (
    <div className="flex flex-col gap-3">
      <ol className="flex flex-col gap-2">
        {slip.legs.map((leg, i) => (
          <li key={i} className={cn(T.inset, "flex flex-col gap-2 p-3")}>
            <div className="flex items-center gap-2">
              <span className="font-kalshi-bold flex size-6 shrink-0 items-center justify-center rounded-md bg-[#1E2638] text-[11px]">
                {i + 1}
              </span>
              <input
                value={leg.market}
                onChange={(e) => setLeg(i, { market: e.target.value })}
                placeholder="Market / stat line — e.g. Kevin Durant: 25+ points"
                aria-label={`Leg ${i + 1} market`}
                className={cn(T.input, "py-1.5")}
              />
              {multi && (
                <button
                  type="button"
                  aria-label={`Remove leg ${i + 1}`}
                  onClick={() => removeLeg(i)}
                  className="rounded-md p-1.5 text-[#F5F7F4]/35 hover:bg-[#FF3B30]/10 hover:text-[#FF3B30]"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_5rem_5.5rem_6rem]">
              <input
                value={leg.pick}
                onChange={(e) => setLeg(i, { pick: e.target.value })}
                placeholder="Pick (player / team)"
                aria-label={`Leg ${i + 1} pick`}
                className={cn(T.input, "py-1.5 text-xs")}
              />
              <input
                value={leg.matchup}
                onChange={(e) => setLeg(i, { matchup: e.target.value })}
                placeholder="Matchup"
                aria-label={`Leg ${i + 1} matchup`}
                className={cn(T.input, "py-1.5 text-xs")}
              />
              <input
                inputMode="numeric"
                value={leg.price ?? ""}
                onChange={(e) => setLeg(i, { price: numberOrNull(e.target.value, 1, 99) })}
                placeholder="Price ¢"
                aria-label={`Leg ${i + 1} Kalshi price in cents`}
                className={cn(T.input, "py-1.5 text-xs tabular-nums")}
              />
              <input
                defaultValue={leg.americanOdds ? `${leg.americanOdds > 0 ? "+" : ""}${leg.americanOdds}` : ""}
                key={`${i}-${leg.americanOdds ?? ""}`}
                onBlur={(e) => setLeg(i, { americanOdds: oddsOrNull(e.target.value) })}
                placeholder="Odds"
                aria-label={`Leg ${i + 1} sportsbook odds`}
                className={cn(T.input, "py-1.5 text-xs tabular-nums")}
              />
              <select
                value={leg.sport}
                onChange={(e) => setLeg(i, { sport: e.target.value })}
                aria-label={`Leg ${i + 1} sport`}
                className={cn(T.input, "py-1.5 text-xs")}
              >
                {SPORTS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          </li>
        ))}
      </ol>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={slip.legs.length >= MAX_LEGS}
          onClick={addLeg}
          className="flex items-center gap-1.5 rounded-lg bg-[#1E2638] px-3 py-2 text-xs font-semibold hover:bg-(--accent-deep) disabled:opacity-40"
        >
          <Plus className="size-3.5" /> Add leg ({slip.legs.length}/{MAX_LEGS})
        </button>
        {multi && (
          <>
            <input
              inputMode="numeric"
              value={slip.comboPrice ?? ""}
              onChange={(e) => onChange({ ...slip, comboPrice: numberOrNull(e.target.value, 1, 99) })}
              placeholder="Combo price ¢"
              aria-label="Kalshi combo price in cents"
              className={cn(T.input, "w-32 py-1.5 text-xs tabular-nums")}
            />
            <input
              defaultValue={slip.comboOdds ? `${slip.comboOdds > 0 ? "+" : ""}${slip.comboOdds}` : ""}
              key={`combo-${slip.comboOdds ?? ""}`}
              onBlur={(e) => onChange({ ...slip, comboOdds: oddsOrNull(e.target.value) })}
              placeholder="or parlay odds"
              aria-label="Sportsbook parlay odds"
              className={cn(T.input, "w-32 py-1.5 text-xs tabular-nums")}
            />
          </>
        )}
      </div>
    </div>
  );
}
