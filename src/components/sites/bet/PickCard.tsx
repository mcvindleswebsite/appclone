"use client";

import { Loader2 } from "lucide-react";

import type { Evaluation } from "@/lib/bet/engine";
import { cn } from "@/lib/utils";
import type { AiSynthesis, BetSlip, InjuryFactor } from "@/types/bet";

import { T } from "./theme";

const EFFECT_STYLES: Record<InjuryFactor["effect"], string> = {
  helps: "border-[#00DD94]/40 bg-[#014737] text-[#00DD94]",
  hurts: "border-[#FF3B30]/40 bg-[#FF3B30]/10 text-[#FF3B30]",
  neutral: "border-[#1E2638] bg-[#050D0A] text-[#F5F7F4]/70",
};

function Metric({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(T.inset, "flex flex-col gap-1.5 p-3", className)}>
      <p className={T.label}>{label}</p>
      {children}
    </div>
  );
}

/** Ten pips, filled for each game that hit the line. */
function HitPips({ hits, games }: { hits: number; games: number }) {
  return (
    <div className="flex gap-1" aria-hidden>
      {Array.from({ length: games }, (_, i) => (
        <span key={i} className={cn("h-1.5 flex-1 rounded-full", i < hits ? "bg-[#00DD94]" : "bg-[#1E2638]")} />
      ))}
    </div>
  );
}

export function PickCard({
  slip,
  ai,
  evaluation,
  researching,
  hasKey,
}: {
  slip: BetSlip;
  ai: AiSynthesis | null;
  evaluation: Evaluation;
  researching: boolean;
  hasKey: boolean;
}) {
  const hasSlip = !!(slip.matchup || slip.marketTitle);
  const best = evaluation.side
    ? evaluation.sides[evaluation.side]
    : [evaluation.sides.YES, evaluation.sides.NO].sort((a, b) => b.edge - a.edge)[0];

  return (
    <div className={cn(T.card, "flex flex-col gap-4 p-5")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={T.label}>Pick</p>
          <p className="font-kalshi-bold mt-1 truncate text-lg">{slip.pick || slip.marketTitle || "No slip yet"}</p>
          {hasSlip && (
            <p className={cn("truncate text-xs", T.muted)}>
              {slip.marketTitle || slip.matchup} · YES {slip.yesPrice}¢
            </p>
          )}
        </div>
        {ai && (
          <div className="flex shrink-0 gap-1.5 text-[11px]">
            <span className="font-kalshi-bold rounded-full bg-[#014737] px-2.5 py-1 text-[#00DD94]">
              Confidence {ai.hitConfidence}/10
            </span>
            <span
              className={cn(
                "font-kalshi-bold rounded-full px-2.5 py-1",
                ai.riskRating >= 4 ? "bg-[#FF3B30]/15 text-[#FF3B30]" : "bg-[#1E2638] text-[#F5F7F4]"
              )}
            >
              Risk {ai.riskRating}/5
            </span>
          </div>
        )}
      </div>

      {researching ? (
        <div className={cn(T.inset, "flex items-center gap-3 p-4 text-sm")}>
          <Loader2 className="size-4 shrink-0 animate-spin text-[#00DD94]" />
          <span className="text-[#F5F7F4]/85">Researching last 10 games, matchup, and injuries…</span>
        </div>
      ) : !ai ? (
        <p className={cn(T.inset, "p-4 text-sm", T.muted)}>
          {!hasSlip
            ? "Import a Kalshi link or scan a slip — research runs automatically."
            : hasKey
              ? "Research hasn't run for this slip yet."
              : "Add your access key (key icon, top right) to auto-research this pick."}
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Metric label="Last 10 Hit Rate">
              <p className="font-kalshi-condensed text-3xl tabular-nums">
                {ai.last10.hits}/{ai.last10.games}
              </p>
              <HitPips hits={ai.last10.hits} games={ai.last10.games} />
              <p className={cn("text-[11px] leading-snug", T.muted)}>{ai.last10.detail}</p>
            </Metric>

            <Metric label="Matchup Rank">
              <p className="font-kalshi-condensed text-3xl tabular-nums">
                #{ai.matchup.rank}
                <span className={cn("font-kalshi-light ml-1 text-sm", T.muted)}>of {ai.matchup.outOf}</span>
              </p>
              {/* 1 = toughest matchup, so a high rank is a soft spot for the pick. */}
              <p
                className={cn(
                  "font-kalshi-bold text-[11px]",
                  ai.matchup.rank / ai.matchup.outOf > 0.66
                    ? T.yes
                    : ai.matchup.rank / ai.matchup.outOf < 0.34
                      ? T.no
                      : "text-[#F5F7F4]"
                )}
              >
                {ai.matchup.rank / ai.matchup.outOf > 0.66 ? "Soft" : ai.matchup.rank / ai.matchup.outOf < 0.34 ? "Tough" : "Neutral"}{" "}
                matchup
              </p>
              <p className={cn("text-[11px] leading-snug", T.muted)}>{ai.matchup.label}</p>
            </Metric>

            <Metric label="Injury Factors" className="col-span-2 sm:col-span-1">
              {ai.injuries.length === 0 ? (
                <p className={cn("text-xs", T.muted)}>No material injuries or usage shifts.</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {ai.injuries.map((injury) => (
                    <li
                      key={injury.note}
                      className={cn("rounded-md border px-2 py-0.5 text-[11px]", EFFECT_STYLES[injury.effect])}
                    >
                      {injury.note}
                    </li>
                  ))}
                </ul>
              )}
            </Metric>

            <Metric label="+EV Edge" className="col-span-2 sm:col-span-1">
              <p className={cn("font-kalshi-condensed text-3xl tabular-nums", best.edge > 0 ? T.yes : T.no)}>
                {best.roi >= 0 ? "+" : ""}
                {(best.roi * 100).toFixed(1)}%
              </p>
              <p className={cn("text-[11px] leading-snug", T.muted)}>
                {best.side} @ {Math.round(best.price * 100)}¢ · {best.edge >= 0 ? "+" : ""}
                {(best.edge * 100).toFixed(1)} pts after fees
              </p>
            </Metric>
          </div>

          <p className="text-sm leading-relaxed text-[#F5F7F4]/85">{ai.reasoning}</p>
        </>
      )}
    </div>
  );
}
