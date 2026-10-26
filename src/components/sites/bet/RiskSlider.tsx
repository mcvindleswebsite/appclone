"use client";

import { RISK_PROFILES } from "@/lib/bet/engine";
import { cn } from "@/lib/utils";
import type { RiskLevel } from "@/types/bet";

import { T } from "./theme";

const LEVELS: RiskLevel[] = [1, 2, 3, 4, 5];

/** Shades from Kalshi green (safety) to red (variance). */
const TICK_COLORS: Record<RiskLevel, string> = {
  1: "#00D26A",
  2: "#7BD84A",
  3: "#F5C542",
  4: "#FF8A3D",
  5: "#FF3B30",
};

export function RiskSlider({ value, onChange }: { value: RiskLevel; onChange: (risk: RiskLevel) => void }) {
  const profile = RISK_PROFILES[value];
  const pct = ((value - 1) / 4) * 100;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <span className={T.label}>Risk Tolerance</span>
        <span className="text-sm font-semibold" style={{ color: TICK_COLORS[value] }}>
          {value} · {profile.label}
        </span>
      </div>

      <div className="relative px-2 pt-2 pb-7">
        <div className="relative h-1.5 rounded-full bg-[#1E2635]">
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all"
            style={{ width: `${pct}%`, background: `linear-gradient(90deg, #00D26A, ${TICK_COLORS[value]})` }}
          />
          {LEVELS.map((level) => {
            const left = ((level - 1) / 4) * 100;
            const active = level === value;
            return (
              <button
                key={level}
                type="button"
                aria-label={`Risk ${level}: ${RISK_PROFILES[level].label}`}
                aria-pressed={active}
                onClick={() => onChange(level)}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 p-2"
                style={{ left: `${left}%` }}
              >
                <span
                  className={cn(
                    "block rounded-full border-2 transition-all",
                    active ? "size-5 border-white" : "size-3 border-[#0A0D14] hover:scale-125"
                  )}
                  style={{ background: level <= value ? TICK_COLORS[level] : "#2A3446" }}
                />
                <span
                  className={cn(
                    "absolute top-8 left-1/2 -translate-x-1/2 text-[11px] font-semibold tabular-nums",
                    active ? "text-white" : "text-[#4A5468]"
                  )}
                >
                  {level}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className={cn("flex justify-between text-[11px]", T.muted)}>
        <span>Max Safety</span>
        <span>High Variance / Degen</span>
      </div>
      <p className={cn("text-xs leading-relaxed", T.muted)}>
        Needs ≥{(profile.minEdge * 100).toFixed(1)} pts edge after fees, ≥{Math.round(profile.minProb * 100)}% to hit,{" "}
        {profile.minPaths}+ path{profile.minPaths > 1 ? "s" : ""} to victory · stakes {Math.round(profile.kelly * 100)}% Kelly.
        Every level stays +EV.
      </p>
    </div>
  );
}
