"use client";

import { ChevronDown, PiggyBank } from "lucide-react";
import { useEffect, useState } from "react";

import { formatMoney } from "@/lib/bet/pnl";
import { cn } from "@/lib/utils";
import type { PaperParlay, PaperSummary } from "@/types/bet";

import { T } from "./theme";

const OUTCOME_TONE: Record<PaperParlay["outcome"], string> = {
  WIN: "text-[#00DD94]",
  LOSS: "text-[#FF3B30]",
  PENDING: "text-[#F5F7F4]/60",
  VOID: "text-[#F5F7F4]/60",
};

const signedPct = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(1)}%`;

/** How the calibration is moving the AI's odds, in plain words. */
const learning = (s: PaperSummary) => {
  const c = s.calibration;
  if (!c.legs) return "Learning: no settled legs yet — it starts adjusting the AI's odds as results come in.";
  const shift = c.overall - 1;
  const read = `AI expected ${c.expected.toFixed(1)} of ${c.legs} legs to hit, ${c.hit} did`;
  return Math.abs(shift) < 0.01
    ? `Learning: ${read} — odds unchanged so far.`
    : `Learning: ${read} — ${shift < 0 ? "trimming" : "raising"} its odds ${Math.round(Math.abs(shift) * 100)}%.`;
};

/**
 * The paper bankroll's counter: fake money the daily run bets on parlays, compounding.
 * Tapping it shows recent parlays and what the calibration has learned.
 */
export function PaperBankroll({ accessKey }: { accessKey: string }) {
  const [data, setData] = useState<PaperSummary | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!accessKey) return;
    let cancelled = false;
    fetch("/api/bet/paper", { method: "POST", headers: { "x-bet-key": accessKey } })
      .then((response) => (response.ok ? (response.json() as Promise<PaperSummary>) : null))
      .then((summary) => {
        if (!cancelled) setData(summary);
      })
      .catch(() => {
        // No counter when the store is unreachable.
      });
    return () => {
      cancelled = true;
    };
  }, [accessKey]);

  if (!data) return null;
  const change = data.balance / data.start - 1;
  const today = data.parlays.filter((p) => p.day === data.lastRun).length;

  return (
    <div className={cn(T.card, "p-4")}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 text-left">
        <PiggyBank className="size-5 shrink-0 text-(--accent)" />
        <div className="min-w-0 flex-1">
          <p className={T.label}>Paper Bankroll</p>
          <p className="font-kalshi-condensed text-2xl tabular-nums">
            {formatMoney(data.balance)}{" "}
            <span className={cn("text-base", change >= 0 ? "text-[#00DD94]" : "text-[#FF3B30]")}>
              {data.startedAt ? signedPct(change) : ""}
            </span>
          </p>
          <p className={cn("truncate text-[11px]", T.muted)}>
            {data.startedAt
              ? `${data.wins}-${data.losses} · ${formatMoney(data.pending)} riding${today ? ` · ${today} today` : ""}${data.lastNote ? ` · ${data.lastNote}` : ""}`
              : `Starts with ${formatMoney(data.start)} at the next daily run (09:15 UTC)`}
          </p>
        </div>
        <ChevronDown className={cn("size-4 shrink-0 text-[#F5F7F4]/60 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="mt-3 flex flex-col gap-2 border-t border-[#1E2638] pt-3 text-xs">
          <p className={T.muted}>
            Once a day it bets 10% of the balance on the AI Picks parlays it expects to profit, split across them. Wins grow the next
            day&apos;s stake; losses shrink it. {learning(data)}
          </p>
          {data.parlays.length === 0 ? (
            <p className={T.muted}>No parlays yet.</p>
          ) : (
            data.parlays.map((p) => (
              <div key={p.id} className={cn(T.inset, "flex items-start gap-3 p-2.5")}>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">
                    {p.day} · {p.legs.length} legs @ {p.decimal.toFixed(2)}x
                    <span className={T.muted}> · {Math.round(p.probability * 100)}% to hit</span>
                  </p>
                  <p className={cn("truncate", T.muted)}>
                    {p.legs.map((l) => `${l.pick}${l.result === "WIN" ? " ✓" : l.result === "LOSS" ? " ✗" : ""}`).join(" · ")}
                  </p>
                </div>
                <div className="shrink-0 text-right tabular-nums">
                  <p>{formatMoney(p.stake)}</p>
                  <p className={OUTCOME_TONE[p.outcome]}>
                    {p.outcome === "PENDING" ? "Pending" : p.outcome === "VOID" ? "Void" : formatMoney((p.payout ?? 0) - p.stake, true)}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
