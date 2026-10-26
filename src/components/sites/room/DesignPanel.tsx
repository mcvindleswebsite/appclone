"use client";

import { Check, ChevronDown, CircleCheck, Eye, EyeOff, Plus, Sparkles, TriangleAlert, Undo2, WandSparkles } from "lucide-react";

import { cn } from "@/lib/utils";

import type { Analysis, ItemReport, Suggestion, SuggestionId } from "./designEngine";
import { COLORS } from "./roomData";

const ACCENT = "#00DD94";

function verdict(score: number) {
  if (score >= 85) return "Designer-ready";
  if (score >= 70) return "Solid layout";
  if (score >= 50) return "Needs a few fixes";
  return "Crowded layout";
}

function ScoreRing({ score }: { score: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className="size-16 shrink-0 -rotate-90">
      <circle cx="32" cy="32" r={r} fill="none" stroke="#1E2638" strokeWidth="6" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke={score >= 50 ? ACCENT : "#FF3B30"}
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={`${(c * score) / 100} ${c}`}
        className="transition-[stroke-dasharray] duration-500"
      />
    </svg>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-16 text-[#F5F7F4]/55">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#1E2638]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${value}%`, background: value >= 60 ? ACCENT : value >= 35 ? "#F2B630" : "#FF3B30" }}
        />
      </div>
      <span className="w-7 text-right font-mono text-[#F5F7F4]/70">{value}</span>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-[10px] font-semibold tracking-[0.14em] text-[#F5F7F4]/40 uppercase">{children}</h3>;
}

function ReportLines({ report }: { report: ItemReport }) {
  return (
    <ul className="flex flex-col gap-1">
      {report.issues.map((i) => (
        <li key={i.message} className="flex items-start gap-1.5 text-[12px] text-[#F5F7F4]/85">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[#FF3B30]" />
          {i.message}
        </li>
      ))}
      {report.wins.map((w) => (
        <li key={w} className="flex items-start gap-1.5 text-[12px] text-[#F5F7F4]/85">
          <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-[#00DD94]" />
          {w}
        </li>
      ))}
      {!report.issues.length && !report.wins.length && (
        <li className="text-[12px] text-[#F5F7F4]/50">No issues. Move it against a wall or into a corner to score harmony.</li>
      )}
    </ul>
  );
}

export function DesignPanel({
  open,
  onOpenChange,
  analysis,
  selected,
  suggestions,
  added,
  onToggleAddition,
  onOptimize,
  optimizing,
  lastMoved,
  onUndo,
  showZones,
  onToggleZones,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  analysis: Analysis;
  selected: ItemReport | null;
  suggestions: Suggestion[];
  added: Record<SuggestionId, boolean>;
  onToggleAddition: (id: SuggestionId) => void;
  onOptimize: () => void;
  optimizing: boolean;
  lastMoved: number | null;
  onUndo: (() => void) | null;
  showZones: boolean;
  onToggleZones: () => void;
}) {
  const reports = Object.values(analysis.reports);
  const problems = reports.filter((r) => r.status === "bad");
  const good = reports.filter((r) => r.status === "good").length;
  const { palette } = analysis;

  return (
    <aside className="absolute top-3 right-3 z-10 w-[min(340px,calc(100vw-1.5rem))] sm:top-6 sm:right-6">
      <div className="overflow-hidden rounded-2xl border border-[#1E2638] bg-[#050D0A]/92 text-[#F5F7F4] shadow-2xl shadow-black/60 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => onOpenChange(!open)}
          className="flex w-full items-center gap-2 px-4 py-3 text-left"
          aria-expanded={open}
        >
          <Sparkles className="size-4 text-[#00DD94]" />
          <span className="text-sm font-semibold tracking-tight">AI Design Assistant</span>
          <span className="ml-auto rounded-full bg-[#00DD94]/12 px-2 py-0.5 font-mono text-[11px] text-[#00DD94]">
            {analysis.score}
          </span>
          <ChevronDown className={cn("size-4 text-[#F5F7F4]/50 transition-transform", open && "rotate-180")} />
        </button>

        {open && (
          <div className="max-h-[calc(100dvh-10rem)] overflow-y-auto border-t border-[#1E2638] px-4 pt-3 pb-4">
            <div className="flex items-center gap-3">
              <div className="relative">
                <ScoreRing score={analysis.score} />
                <span className="absolute inset-0 grid place-items-center font-mono text-lg font-semibold">
                  {analysis.score}
                </span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{verdict(analysis.score)}</p>
                <p className="text-[11px] text-[#F5F7F4]/50">
                  {good} of {reports.length} pieces in harmony · {problems.length} flagged
                </p>
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-1.5">
              <Meter label="Clearance" value={analysis.metrics.clearance} />
              <Meter label="Daylight" value={analysis.metrics.light} />
              <Meter label="Balance" value={analysis.metrics.balance} />
              <Meter label="Palette" value={analysis.metrics.palette} />
              <Meter label="Harmony" value={analysis.metrics.harmony} />
            </div>

            <button
              type="button"
              onClick={onOptimize}
              disabled={optimizing}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#00DD94] py-2.5 text-sm font-semibold text-[#050D0A] transition hover:brightness-110 disabled:opacity-60"
            >
              <WandSparkles className={cn("size-4", optimizing && "animate-pulse")} />
              {optimizing ? "Optimizing…" : "Auto-Optimize Layout"}
            </button>
            {lastMoved !== null && (
              <div className="mt-2 flex items-center justify-between text-[11px] text-[#F5F7F4]/55">
                <span>{lastMoved ? `Moved ${lastMoved} piece${lastMoved === 1 ? "" : "s"}` : "Already optimal"}</span>
                {onUndo && (
                  <button type="button" onClick={onUndo} className="flex items-center gap-1 text-[#00DD94] hover:underline">
                    <Undo2 className="size-3" /> Undo
                  </button>
                )}
              </div>
            )}

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <SectionTitle>{selected ? selected.label : "Live feedback"}</SectionTitle>
                <button
                  type="button"
                  onClick={onToggleZones}
                  className="-mt-2 flex items-center gap-1 text-[11px] text-[#F5F7F4]/55 hover:text-[#F5F7F4]"
                >
                  {showZones ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  {showZones ? "Hide zones" : "Show zones"}
                </button>
              </div>
              {selected ? (
                <ReportLines report={selected} />
              ) : problems.length ? (
                <ul className="flex flex-col gap-1.5">
                  {problems.slice(0, 5).map((r) => (
                    <li key={r.id} className="text-[12px] leading-snug">
                      <span className="font-semibold text-[#FF3B30]">{r.label}</span>
                      <span className="text-[#F5F7F4]/70"> · {r.issues[0].message}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="flex items-center gap-1.5 text-[12px] text-[#F5F7F4]/80">
                  <CircleCheck className="size-3.5 text-[#00DD94]" />
                  Every piece has clearance, doors and daylight are free.
                </p>
              )}
            </div>

            <div className="mt-5">
              <SectionTitle>60 · 30 · 10 palette</SectionTitle>
              <div className="flex h-2.5 overflow-hidden rounded-full">
                <div style={{ width: `${palette.base}%`, background: COLORS.wall }} />
                <div style={{ width: `${palette.secondary}%`, background: COLORS.cherryWood }} />
                <div style={{ width: `${palette.accent}%`, background: COLORS.bocaGold }} />
              </div>
              <div className="mt-1.5 grid grid-cols-3 text-[11px]">
                {(
                  [
                    ["Base", palette.base, 60],
                    ["Secondary", palette.secondary, 30],
                    ["Accent", palette.accent, 10],
                  ] as const
                ).map(([label, value, target]) => (
                  <div key={label}>
                    <span className="text-[#F5F7F4]/55">{label} </span>
                    <span className={cn("font-mono", Math.abs(value - target) <= 4 ? "text-[#00DD94]" : "text-[#F5F7F4]")}>
                      {value}%
                    </span>
                    <span className="text-[#F5F7F4]/35"> /{target}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-5">
              <SectionTitle>Suggested additions</SectionTitle>
              <ul className="flex flex-col gap-2">
                {suggestions.map((s) => {
                  const on = added[s.id];
                  return (
                    <li
                      key={s.id}
                      className={cn(
                        "rounded-xl border p-3 transition-colors",
                        on ? "border-[#00DD94]/40 bg-[#00DD94]/[0.06]" : "border-[#1E2638] bg-white/[0.02]",
                      )}
                    >
                      <div className="flex items-start gap-2.5">
                        <span className="mt-0.5 size-4 shrink-0 rounded-md ring-1 ring-white/15" style={{ background: s.swatch }} />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-semibold leading-tight">{s.title}</p>
                          <p className="mt-0.5 font-mono text-[10px] text-[#F5F7F4]/45">{s.spec}</p>
                          <p className="mt-1 text-[11px] leading-snug text-[#F5F7F4]/65">{s.reason}</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onToggleAddition(s.id)}
                          className={cn(
                            "flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition",
                            on ? "bg-[#00DD94] text-[#050D0A]" : "border border-[#00DD94]/50 text-[#00DD94] hover:bg-[#00DD94]/10",
                          )}
                        >
                          {on ? <Check className="size-3" /> : <Plus className="size-3" />}
                          {on ? "Added" : "Add"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
