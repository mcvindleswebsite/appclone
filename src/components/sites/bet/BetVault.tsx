"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { RISK_PROFILES } from "@/lib/bet/engine";
import { buildInsights } from "@/lib/bet/history";
import { cn } from "@/lib/utils";
import type { BetRecord, Outcome } from "@/types/bet";

import { T } from "./theme";

const FILTERS = ["ALL", "PENDING", "WIN", "LOSS"] as const;

const OUTCOME_STYLES: Record<Outcome, string> = {
  WIN: "bg-[#00D26A] text-[#0A0D14]",
  LOSS: "bg-[#FF3B30] text-white",
  PENDING: "bg-[#2A3446] text-white",
};

const verdictColor = (verdict: string) =>
  verdict.startsWith("BUY YES") ? T.yes : verdict.startsWith("BUY NO") ? T.no : T.muted;

export function BetVault({
  records,
  onOutcome,
  onDelete,
}: {
  records: BetRecord[];
  onOutcome: (id: string, outcome: Outcome) => void;
  onDelete: (id: string) => void;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const insights = buildInsights(records);
  const settled = insights.record.wins + insights.record.losses;
  const shown = filter === "ALL" ? records : records.filter((r) => r.outcome === filter);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "Picks Logged", value: insights.total },
          { label: "Record", value: `${insights.record.wins}-${insights.record.losses}` },
          { label: "Hit Rate", value: settled ? `${Math.round((insights.record.wins / settled) * 100)}%` : "—" },
          { label: "Pending", value: insights.record.pending },
        ].map((stat) => (
          <div key={stat.label} className={cn(T.card, "p-4")}>
            <p className={T.label}>{stat.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{stat.value}</p>
          </div>
        ))}
      </div>

      {insights.sports.length > 0 && (
        <div className={cn(T.card, "flex flex-wrap gap-2 p-4")}>
          <span className={cn(T.label, "mr-2 self-center")}>Memory</span>
          {insights.sports.map((s) => (
            <span key={s.sport} className="rounded-full bg-[#1E2635] px-3 py-1 text-xs">
              {s.sport} <span className={T.muted}>· {s.count} picks · {s.wins}-{s.losses}</span>
            </span>
          ))}
          {insights.byRisk
            .filter((r) => r.wins + r.losses > 0)
            .map((r) => (
              <span key={r.risk} className="rounded-full bg-[#1E2635] px-3 py-1 text-xs">
                Risk {r.risk} <span className={T.muted}>· {r.wins}-{r.losses}</span>
              </span>
            ))}
        </div>
      )}

      <div className="flex gap-1 rounded-full bg-[#121824] p-1 self-start">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
              filter === f ? "bg-white text-[#0A0D14]" : "text-[#8A94A6] hover:text-white"
            )}
          >
            {f === "ALL" ? "All" : f[0] + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <div className={cn(T.card, "p-10 text-center text-sm", T.muted)}>
          {records.length === 0 ? "No picks yet — evaluate a slip and it lands here." : "Nothing in this filter."}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((r) => (
            <li key={r.id} className={cn(T.card, "flex flex-col gap-3 p-4 md:flex-row md:items-start")}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-[11px]">
                  <span className="rounded bg-[#1E2635] px-2 py-0.5 font-semibold">{r.slip.sport}</span>
                  <span className={T.muted}>
                    {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                  <span className={T.muted}>
                    · Risk {r.risk} {RISK_PROFILES[r.risk].label}
                  </span>
                  {r.ai && <span className="rounded bg-[#00D26A]/10 px-1.5 py-0.5 text-[#00D26A]">AI</span>}
                </div>
                <p className="mt-1.5 truncate font-semibold">{r.slip.matchup || r.slip.marketTitle}</p>
                <p className={cn("truncate text-xs", T.muted)}>
                  {r.slip.marketTitle} · YES {r.slip.pick} @ {r.slip.yesPrice}¢
                </p>
                <p className="mt-2 text-xs leading-relaxed text-[#C5CCD8]">{r.summary}</p>
              </div>

              <div className="flex shrink-0 flex-row items-center justify-between gap-3 md:flex-col md:items-end">
                <div className="text-right">
                  <p className={cn("text-sm font-bold", verdictColor(r.verdict))}>{r.verdict}</p>
                  <p className={cn("text-[11px] tabular-nums", T.muted)}>
                    {Math.round(r.probability * 100)}% · {r.edge >= 0 ? "+" : ""}
                    {(r.edge * 100).toFixed(1)} pts
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {(["WIN", "LOSS", "PENDING"] as Outcome[]).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => onOutcome(r.id, o)}
                      className={cn(
                        "rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors",
                        r.outcome === o ? OUTCOME_STYLES[o] : "bg-[#0E131D] text-[#4A5468] hover:text-white"
                      )}
                    >
                      {o}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label="Delete pick"
                    onClick={() => onDelete(r.id)}
                    className="ml-1 rounded-md p-1.5 text-[#4A5468] hover:bg-[#FF3B30]/10 hover:text-[#FF3B30]"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
