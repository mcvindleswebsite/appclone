"use client";

import { CircleCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";

import {
  breakdown,
  clvSummary,
  MIN_CALIBRATION_PICKS,
  type BreakdownDimension,
  type Calibration,
  type CalibrationBucket,
} from "@/lib/bet/edge";
import { slipLabel } from "@/lib/bet/history";
import { formatMoney } from "@/lib/bet/pnl";
import type { BankrollSettings } from "@/lib/bet/bankroll";
import { cn } from "@/lib/utils";
import type { BetRecord } from "@/types/bet";

import { BankrollPanel } from "./BankrollPanel";
import { T } from "./theme";
import { TrackRecord } from "./TrackRecord";

const DIMENSIONS: BreakdownDimension[] = ["Market", "Sport", "Legs", "Source", "Risk"];
const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
const signed = (n: number, digits = 1) => `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(digits)}%`;

function Tile({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className={cn(T.card, "p-4")}>
      <p className={T.label}>{label}</p>
      <p className={cn("font-kalshi-condensed mt-1 text-3xl tabular-nums", tone)}>{value}</p>
      <p className={cn("mt-0.5 text-[11px] leading-snug", T.muted)}>{sub}</p>
    </div>
  );
}

/* Calibration chart: one series of dots (model said → actually hit) over a y = x reference. */
// Sized near its rendered width so the 10–11px labels stay true to size.
const W = 480;
const H = 300;
const PAD = { l: 40, r: 14, t: 12, b: 38 };
const x = (p: number) => PAD.l + p * (W - PAD.l - PAD.r);
const y = (p: number) => H - PAD.b - p * (H - PAD.t - PAD.b);

function CalibrationChart({ buckets }: { buckets: CalibrationBucket[] }) {
  const [hover, setHover] = useState<CalibrationBucket | null>(null);
  const shown = buckets.filter((b) => b.n > 0);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Model probability versus actual hit rate">
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line x1={x(0)} x2={x(1)} y1={y(t)} y2={y(t)} stroke="#1E2638" strokeWidth={1} />
            <text x={PAD.l - 6} y={y(t) + 3} textAnchor="end" className="fill-[#F5F7F4]/45 text-[10px]">
              {pct(t)}
            </text>
            <text x={x(t)} y={H - PAD.b + 14} textAnchor="middle" className="fill-[#F5F7F4]/45 text-[10px]">
              {pct(t)}
            </text>
          </g>
        ))}
        {/* Perfect calibration */}
        <line x1={x(0)} y1={y(0)} x2={x(1)} y2={y(1)} stroke="#F5F7F4" strokeOpacity={0.3} strokeWidth={1} />
        <text x={(x(0) + x(1)) / 2} y={H - 6} textAnchor="middle" className="fill-[#F5F7F4]/55 text-[11px]">
          Model said
        </text>
        <text
          x={10}
          y={(y(0) + y(1)) / 2}
          textAnchor="middle"
          transform={`rotate(-90 10 ${(y(0) + y(1)) / 2})`}
          className="fill-[#F5F7F4]/55 text-[11px]"
        >
          Actually hit
        </text>
        {shown.map((b) => (
          <g key={b.from} onMouseEnter={() => setHover(b)} onMouseLeave={() => setHover(null)}>
            <circle cx={x(b.predicted)} cy={y(b.actual)} r={5} fill="#00DD94" stroke="#121824" strokeWidth={2} />
            {/* Hit target larger than the mark */}
            <circle cx={x(b.predicted)} cy={y(b.actual)} r={14} fill="transparent" />
          </g>
        ))}
      </svg>
      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#F5F7F4]/50">
        <span className="inline-block h-px w-4 bg-[#F5F7F4]/40" /> Diagonal = perfectly calibrated · hover a dot for its picks
      </p>
      {hover && (
        <div
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-[#1E2638] bg-[#050D0A] px-2.5 py-1.5 text-[11px] whitespace-nowrap shadow-lg"
          style={{ left: `${(x(hover.predicted) / W) * 100}%`, top: `${(y(hover.actual) / H) * 100 - 3}%` }}
        >
          <p className="font-kalshi-bold">
            {pct(hover.from)}–{pct(hover.to)} picks · {hover.n}
          </p>
          <p className={T.muted}>
            Model {pct(hover.predicted)} · hit {pct(hover.actual)}
          </p>
        </div>
      )}
    </div>
  );
}

export function EdgeLab({
  records,
  calibration: cal,
  accessKey,
  bankroll,
  exposure,
  onBankroll,
}: {
  records: BetRecord[];
  calibration: Calibration;
  accessKey: string;
  bankroll: BankrollSettings;
  /** Dollars staked today. */
  exposure: number;
  onBankroll: (next: BankrollSettings) => void;
}) {
  const [dim, setDim] = useState<BreakdownDimension>("Market");
  const clv = clvSummary(records);
  const rows = breakdown(records, dim);
  const leaks = (["Market", "Sport", "Legs", "Source"] as const)
    .flatMap((d) => breakdown(records, d).filter((r) => r.tag === "leak"))
    .sort((a, b) => (a.roi ?? 0) - (b.roi ?? 0));
  const gap = cal.predicted !== null && cal.actual !== null ? cal.actual - cal.predicted : null;
  const sample = (p: number) => 1 / (1 + Math.exp(-(cal.alpha * Math.log(p / (1 - p)) + cal.beta)));

  return (
    <div className="flex flex-col gap-4">
      <BankrollPanel settings={bankroll} exposure={exposure} onChange={onBankroll} />
      <TrackRecord accessKey={accessKey} />
      <h2 className="font-kalshi-bold mt-2 text-lg">Your Bets</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile
          label="Avg CLV"
          value={clv.average === null ? "—" : signed(clv.average)}
          sub={clv.n ? `${clv.n} ticket${clv.n === 1 ? "" : "s"} with a closing line` : "Fills in as logged games start"}
          tone={clv.average === null ? undefined : clv.average >= 0 ? "text-[#00DD94]" : "text-[#FF3B30]"}
        />
        <Tile
          label="Beat the Close"
          value={clv.beatRate === null ? "—" : pct(clv.beatRate)}
          sub="Over 50% across 50+ bets is a real edge"
        />
        <Tile
          label="AI Calibration"
          value={cal.predicted === null || cal.actual === null ? "—" : `${pct(cal.predicted)} → ${pct(cal.actual)}`}
          sub={cal.n ? `Model said vs hit · ${cal.n} graded pick${cal.n === 1 ? "" : "s"}` : "Needs settled AI-researched picks"}
          tone={gap === null ? undefined : gap < -0.05 ? "text-[#FF3B30]" : undefined}
        />
        <Tile
          label="Biggest Leak"
          value={leaks[0] ? signed(leaks[0].roi ?? 0, 0) : "None"}
          sub={leaks[0] ? `${leaks[0].key} · ${leaks[0].picks} picks` : "No group of 5+ picks losing 15%+"}
          tone={leaks[0] ? "text-[#FF3B30]" : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Closing line value */}
        <section className={cn(T.card, "flex flex-col gap-3 p-4 sm:p-5")}>
          <div>
            <h2 className="font-kalshi-bold">Closing Line Value</h2>
            <p className={cn("mt-1 text-xs leading-relaxed", T.muted)}>
              What you paid against Kalshi&apos;s fair price when the game started. Buying before the market moves your
              way is the clearest sign of skill, and it shows up long before win rate does. Parlay CLV includes the
              combo&apos;s markup.
            </p>
          </div>
          {clv.recent.length === 0 ? (
            <p className={cn(T.inset, "p-4 text-sm", T.muted)}>
              No closing lines yet. They&apos;re read from Kalshi&apos;s price history automatically once a logged
              bet&apos;s game starts.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-[#1E2638] overflow-hidden rounded-xl border border-[#1E2638] bg-[#050D0A]">
              {clv.recent.map(({ record, clv: c }) => (
                <li key={record.id} className="flex items-center gap-3 px-3 py-2 text-xs">
                  <span className="min-w-0 flex-1 truncate">{slipLabel(record.slip)}</span>
                  <span className={cn("shrink-0 tabular-nums", T.muted)}>
                    {(c.entry * 100).toFixed(c.entry < 0.1 ? 1 : 0)}¢ → {(c.close * 100).toFixed(c.close < 0.1 ? 1 : 0)}¢
                  </span>
                  <span
                    className={cn(
                      "font-kalshi-bold w-14 shrink-0 text-right tabular-nums",
                      c.clv >= 0 ? "text-[#00DD94]" : "text-[#FF3B30]"
                    )}
                  >
                    {signed(c.clv)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Calibration */}
        <section className={cn(T.card, "flex flex-col gap-3 p-4 sm:p-5")}>
          <div>
            <h2 className="font-kalshi-bold">Is the AI&apos;s % Honest?</h2>
            <p className={cn("mt-1 text-xs leading-relaxed", T.muted)}>
              Settled AI-researched picks grouped by the probability the model gave them. Dots below the line mean
              it&apos;s overconfident, so its edges, and your Kelly stakes, are too big.
            </p>
          </div>
          {cal.n === 0 ? (
            <p className={cn(T.inset, "p-4 text-sm", T.muted)}>
              Nothing to grade yet. Research picks with the AI and let them settle.
            </p>
          ) : (
            <>
              <CalibrationChart buckets={cal.buckets} />
              <p
                className={cn(
                  "flex items-start gap-1.5 rounded-lg border px-3 py-2 text-xs",
                  cal.active ? "border-[#00DD94]/30 bg-[#050D0A]" : "border-[#1E2638] bg-[#050D0A]"
                )}
              >
                {cal.active ? (
                  <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-[#00DD94]" />
                ) : (
                  <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-[#F5C542]" />
                )}
                <span className="text-[#F5F7F4]/85">
                  {cal.active
                    ? `Correction on: new evaluations map the model's 50% → ${pct(sample(0.5))}, 65% → ${pct(sample(0.65))}, 80% → ${pct(sample(0.8))} before measuring edge.`
                    : `Correction turns on at ${MIN_CALIBRATION_PICKS} graded picks (${cal.n} so far), so a few results can't swing your edges.`}
                </span>
              </p>
              <table className="w-full text-xs tabular-nums">
                <thead className={T.muted}>
                  <tr className="text-left">
                    <th className="py-1 font-normal">Model said</th>
                    <th className="py-1 text-right font-normal">Picks</th>
                    <th className="py-1 text-right font-normal">Avg model</th>
                    <th className="py-1 text-right font-normal">Hit</th>
                    <th className="py-1 text-right font-normal">Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {cal.buckets
                    .filter((b) => b.n > 0)
                    .map((b) => (
                      <tr key={b.from} className="border-t border-[#1E2638]">
                        <td className="py-1.5">
                          {pct(b.from)}–{pct(b.to)}
                        </td>
                        <td className="py-1.5 text-right">{b.n}</td>
                        <td className="py-1.5 text-right">{pct(b.predicted)}</td>
                        <td className="py-1.5 text-right">{pct(b.actual)}</td>
                        <td className={cn("py-1.5 text-right", b.actual - b.predicted < -0.05 ? "text-[#FF3B30]" : "")}>
                          {signed(b.actual - b.predicted, 0)}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      </div>

      {/* Where the money goes */}
      <section className={cn(T.card, "flex flex-col gap-3 p-4 sm:p-5")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-kalshi-bold">Where You Win and Lose</h2>
            <p className={cn("mt-1 text-xs", T.muted)}>
              Settled picks by group, worst first. ROI is per unit at flat 1-unit stakes. Cut the leaks.
            </p>
          </div>
          <div className="flex gap-1 rounded-full bg-[#050D0A] p-1">
            {DIMENSIONS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDim(d)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold transition-colors",
                  dim === d ? "bg-white text-[#050D0A]" : "text-[#F5F7F4]/60 hover:text-white"
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        {rows.length === 0 ? (
          <p className={cn(T.inset, "p-4 text-sm", T.muted)}>No settled picks yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs tabular-nums">
              <thead className={T.muted}>
                <tr className="text-left">
                  <th className="py-1.5 font-normal">{dim}</th>
                  <th className="py-1.5 text-right font-normal">Picks</th>
                  <th className="py-1.5 text-right font-normal">W-L</th>
                  <th className="py-1.5 text-right font-normal">ROI / unit</th>
                  <th className="py-1.5 text-right font-normal">$ P/L</th>
                  <th className="py-1.5 text-right font-normal">Avg CLV</th>
                  <th className="py-1.5 pl-3 font-normal" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-t border-[#1E2638]">
                    <td className="py-2 font-semibold">{r.key}</td>
                    <td className="py-2 text-right">{r.picks}</td>
                    <td className="py-2 text-right">
                      {r.wins}-{r.losses}
                    </td>
                    <td
                      className={cn(
                        "py-2 text-right font-semibold",
                        r.roi === null ? "" : r.roi >= 0 ? "text-[#00DD94]" : "text-[#FF3B30]"
                      )}
                    >
                      {r.roi === null ? "—" : signed(r.roi)}
                    </td>
                    <td className="py-2 text-right">{r.staked ? formatMoney(r.profit, true) : "—"}</td>
                    <td className="py-2 text-right">{r.clv === null ? "—" : signed(r.clv)}</td>
                    <td className="py-2 pl-3">
                      {r.tag === "leak" && (
                        <span className="font-kalshi-bold inline-flex items-center gap-1 rounded-full bg-[#FF3B30]/15 px-2 py-0.5 text-[10px] text-[#FF3B30]">
                          <TriangleAlert className="size-3" /> LEAK
                        </span>
                      )}
                      {r.tag === "strength" && (
                        <span className="font-kalshi-bold inline-flex items-center gap-1 rounded-full bg-[#00DD94]/12 px-2 py-0.5 text-[10px] text-[#00DD94]">
                          <CircleCheck className="size-3" /> STRENGTH
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={cn("text-[11px]", T.muted)}>
          Groups need 5+ settled picks to be tagged. Small samples swing hard; treat early results as hints, not proof.
        </p>
      </section>
    </div>
  );
}
