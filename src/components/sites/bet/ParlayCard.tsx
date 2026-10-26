"use client";

import { AlertTriangle, Check, Copy, Link2, Loader2 } from "lucide-react";
import { useState } from "react";

import { formatAmerican, RISK_PROFILES, type ParlayEvaluation, type SlipLine } from "@/lib/bet/engine";
import { cn } from "@/lib/utils";
import type { BetSlip, LegRating, RiskLevel, SlipAnalysis } from "@/types/bet";

import { T } from "./theme";

/** NEUTRAL is yellow by request; it's the one color outside the brand kit. */
const PILL: Record<LegRating, string> = {
  "STRONG VALUE": "border-[#00DD94]/50 bg-[#014737] text-[#00DD94]",
  NEUTRAL: "border-[#F5C542]/40 bg-[#F5C542]/10 text-[#F5C542]",
  "BUM PICK": "border-[#FF3B30]/50 bg-[#FF3B30]/15 text-[#FF3B30]",
};

const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

const slipText = (slip: BetSlip, line: SlipLine, title: string) =>
  [
    `MCVINDLE BETS — ${title} (${line.indexes.length} leg${line.indexes.length > 1 ? "s" : ""})`,
    ...line.indexes.map((i, n) => {
      const leg = slip.legs[i];
      const quote = leg.price ? ` (${leg.price}¢)` : leg.americanOdds ? ` (${formatAmerican(leg.americanOdds)})` : "";
      return `${n + 1}. ${leg.market || leg.pick}${quote}`;
    }),
    [
      line.american !== null ? `Est. odds ${formatAmerican(line.american)}` : null,
      `~${pct(line.probability, 1)} to hit`,
      line.ev !== null ? `EV ${signedPct(line.ev)}` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  ].join("\n");

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className={cn(T.inset, "p-3")}>
      <p className={T.label}>{label}</p>
      <p className={cn("font-kalshi-condensed mt-1 text-2xl tabular-nums", tone)}>{value}</p>
    </div>
  );
}

export function ParlayCard({
  slip,
  analysis,
  parlay,
  risk,
  researching,
  hasKey,
}: {
  slip: BetSlip;
  analysis: SlipAnalysis | null;
  parlay: ParlayEvaluation;
  risk: RiskLevel;
  researching: boolean;
  hasKey: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const recommended = parlay.verdict === "PLAY TRIMMED SLIP" ? parlay.trimmed : parlay.verdict === "PLAY FULL SLIP" ? parlay.full : null;

  const copy = async () => {
    if (!recommended) return;
    await navigator.clipboard.writeText(
      slipText(slip, recommended, parlay.verdict === "PLAY TRIMMED SLIP" ? "Trimmed slip" : "Full slip")
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const { full } = parlay;
  return (
    <div className={cn(T.card, "flex flex-col gap-5 p-5")}>
      {/* Bum Pick Summary */}
      <div className="flex flex-col gap-2">
        <p className={T.label}>Bum Pick Summary · {slip.legs.length} legs</p>
        {researching ? (
          <p className="flex items-center gap-2 text-sm text-[#F5F7F4]/85">
            <Loader2 className="size-4 animate-spin text-[#00DD94]" /> Researching all {slip.legs.length} legs in parallel…
          </p>
        ) : !analysis ? (
          <p className={cn("text-sm", T.muted)}>
            {hasKey ? "Research hasn't run for this slip yet." : "Add your access key (key icon, top right) to rate the legs."}
          </p>
        ) : (
          <>
            <p className={cn("font-kalshi-condensed text-4xl", parlay.bums.length ? T.no : T.yes)}>
              {parlay.bums.length ? `${parlay.bums.length} BUM PICK${parlay.bums.length > 1 ? "S" : ""}` : "NO BUM PICKS"}
            </p>
            {parlay.bums.length > 0 && (
              <ul className="flex flex-col gap-1 text-xs">
                {parlay.bums.map((b) => (
                  <li key={b.index} className="text-[#F5F7F4]/85">
                    <span className="font-kalshi-bold text-[#FF3B30]">Leg {b.index + 1}</span> · {b.leg.pick || b.leg.market}
                    {" — "}
                    {b.analysis?.reason}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {analysis && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat
            label="Parlay +EV"
            value={full.ev === null ? "—" : signedPct(full.ev)}
            tone={full.ev === null ? undefined : full.ev > 0 ? T.yes : T.no}
          />
          <Stat label="True Win Prob" value={pct(full.probability, full.probability < 0.1 ? 1 : 0)} />
          <Stat label="Risk Score" value={`${analysis.riskScore}/5`} tone={analysis.riskScore >= 4 ? T.no : undefined} />
          <Stat
            label="Payout / $10"
            value={full.decimal ? `$${(full.decimal * 10).toFixed(0)}` : "—"}
          />
        </div>
      )}

      {analysis && analysis.correlations.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {analysis.correlations.map((c, i) => (
            <li
              key={i}
              className={cn(
                "flex gap-2 rounded-lg border px-3 py-2 text-xs",
                c.type === "negative" ? "border-[#FF3B30]/40 bg-[#FF3B30]/10" : "border-[#1E2638] bg-[#050D0A]"
              )}
            >
              {c.type === "negative" ? (
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-[#FF3B30]" />
              ) : (
                <Link2 className="mt-0.5 size-3.5 shrink-0 text-[#00DD94]" />
              )}
              <span className="text-[#F5F7F4]/85">
                <span className="font-kalshi-bold">
                  {c.type === "negative" ? "Conflict" : "Correlated"} · Legs {c.legs.map((l) => l + 1).join(" & ")}
                </span>{" "}
                — {c.note}
              </span>
            </li>
          ))}
        </ul>
      )}

      {/* Leg breakdown */}
      <ol className="flex flex-col divide-y divide-[#1E2638] overflow-hidden rounded-xl border border-[#1E2638]">
        {parlay.legs.map((l) => {
          const a = l.analysis;
          const kept = recommended?.indexes.includes(l.index);
          return (
            <li key={l.index} className={cn("flex flex-col gap-1 p-3", kept ? "bg-[#014737]/30" : "bg-[#050D0A]")}>
              <div className="flex items-center gap-2">
                <span className="font-kalshi-bold w-5 shrink-0 text-xs text-[#F5F7F4]/50">{l.index + 1}</span>
                <p className="min-w-0 flex-1 truncate text-sm">{l.leg.market || l.leg.pick || "Untitled leg"}</p>
                <span className="shrink-0 text-xs tabular-nums text-[#F5F7F4]/60">
                  {l.leg.price ? `${l.leg.price}¢` : l.leg.americanOdds ? formatAmerican(l.leg.americanOdds) : "no price"}
                </span>
                {a && (
                  <span className={cn("font-kalshi-bold shrink-0 rounded-full border px-2 py-0.5 text-[10px]", PILL[a.rating])}>
                    {a.rating}
                  </span>
                )}
              </div>
              {a && (
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 pl-7 text-[11px] text-[#F5F7F4]/60">
                  <span className="tabular-nums text-white">{pct(a.probability)} to hit</span>
                  {a.researched && (
                    <>
                      <span className="tabular-nums">
                        L10 {a.last10.hits}/{a.last10.games}
                      </span>
                      <span className="tabular-nums">
                        Matchup #{a.matchup.rank}/{a.matchup.outOf}
                      </span>
                    </>
                  )}
                  {l.ev !== null && <span className={cn("tabular-nums", l.ev >= 0 ? T.yes : T.no)}>EV {signedPct(l.ev)}</span>}
                  {l.conflicted && <span className="text-[#FF3B30]">Conflicts</span>}
                  {kept && <span className={T.yes}>✓ Kept</span>}
                </div>
              )}
              {a && <p className={cn("pl-7 text-xs", a.rating === "BUM PICK" ? "text-[#FF3B30]" : "text-[#F5F7F4]/70")}>{a.reason}</p>}
            </li>
          );
        })}
      </ol>

      {/* Recommendation */}
      {analysis && (
        <div className={cn(T.inset, "flex flex-col gap-3 p-4")}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className={T.label}>
                {parlay.verdict === "PLAY TRIMMED SLIP" ? "Trimmed Slip" : "Recommendation"} · Risk {risk}{" "}
                {RISK_PROFILES[risk].label}
              </p>
              <p className={cn("font-kalshi-condensed mt-1 text-3xl", recommended ? T.yes : "text-white")}>{parlay.verdict}</p>
            </div>
            {recommended && (
              <button
                type="button"
                onClick={() => void copy()}
                className="font-kalshi-bold flex shrink-0 items-center gap-1.5 rounded-lg bg-[#00DD94] px-3 py-2 text-xs text-[#050D0A] hover:brightness-110"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy Optimized Slip"}
              </button>
            )}
          </div>
          {recommended ? (
            <p className="text-sm text-[#F5F7F4]/85">
              {recommended.indexes.length} of {slip.legs.length} legs
              {recommended.american !== null && (
                <>
                  {" "}
                  · <span className="font-kalshi-bold text-white">{formatAmerican(recommended.american)}</span> (est.)
                </>
              )}
              {recommended.decimal && <> · $10 pays ${(recommended.decimal * 10).toFixed(2)}</>}
              {" "}· {pct(recommended.probability, 1)} to hit
              {recommended.ev !== null && (
                <>
                  {" "}
                  · EV <span className={T.yes}>{signedPct(recommended.ev)}</span>
                </>
              )}
            </p>
          ) : null}
          {parlay.reasons.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs text-[#F5F7F4]/70">
              {parlay.reasons.map((r) => (
                <li key={r}>• {r}</li>
              ))}
            </ul>
          )}
          {parlay.verdict === "PLAY TRIMMED SLIP" && (
            <p className="text-[11px] text-[#F5F7F4]/50">
              Trimmed odds are estimated from the kept legs&apos; own prices; Kalshi&apos;s combo quote may differ.
            </p>
          )}
        </div>
      )}

      {analysis && <p className="text-sm leading-relaxed text-[#F5F7F4]/85">{analysis.reasoning}</p>}
    </div>
  );
}
