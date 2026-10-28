"use client";

import { Loader2, RefreshCw, Target } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import type { TrackedPick, TrackSummary } from "@/types/bet";

import { T } from "./theme";

interface TrackResponse {
  configured: boolean;
  summary?: TrackSummary;
  sharp?: TrackSummary;
  ai?: TrackSummary;
  safe?: TrackSummary;
  mismatch?: TrackSummary;
  deep?: TrackSummary;
  recent?: TrackedPick[];
  error?: string;
}

const signed = (n: number | null, digits = 1) => (n === null ? "—" : `${n >= 0 ? "+" : "−"}${Math.abs(n * 100).toFixed(digits)}%`);
const tone = (n: number | null) => (n === null ? undefined : n >= 0 ? "text-[#00DD94]" : "text-[#FF3B30]");

/** The bar for calling a strategy proven: enough picks for CLV noise to average out. */
const PROVEN = 50;

/**
 * Top Picks' own record: every recommended pick, bet or not, settled and checked against
 * Kalshi's closing price. CLV is the verdict on whether the scanner has an edge.
 */
export function TrackRecord({ accessKey }: { accessKey: string }) {
  const [data, setData] = useState<TrackResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!accessKey) return;
    setLoading(true);
    try {
      const response = await fetch("/api/scanner/track", { method: "POST", headers: { "x-bet-key": accessKey } });
      setData((await response.json()) as TrackResponse);
    } catch {
      setData({ configured: true, error: "Couldn't load the track record." });
    } finally {
      setLoading(false);
    }
  }, [accessKey]);

  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    return () => clearTimeout(first);
  }, [load]);

  const s = data?.summary;
  const rows: [string, TrackSummary | undefined][] = [
    ["Price Edges", data?.sharp],
    ["AI Picks", data?.ai],
    ["Mismatches", data?.mismatch],
    ["Safest Wins", data?.safe],
    ["Deep-checked", data?.deep],
  ];

  return (
    <div className={cn(T.card, "flex flex-col gap-4 p-4 sm:p-5")}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--accent-deep)">
          <Target className="size-5 text-(--accent)" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-kalshi-bold text-lg">Top Picks Track Record</h2>
          <p className={cn("text-sm", T.muted)}>
            Every pick the scanner recommends is logged at its price, whether you bet it or not, then graded and compared to
            Kalshi&apos;s price at kickoff. Positive CLV over {PROVEN}+ picks is the real proof of an edge.
          </p>
        </div>
        <button
          type="button"
          aria-label="Refresh track record"
          disabled={loading || !accessKey}
          onClick={() => void load()}
          className="rounded-lg p-2 text-[#F5F7F4]/60 hover:bg-[#050D0A] hover:text-white disabled:opacity-40"
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </button>
      </div>

      {!accessKey ? (
        <p className="text-xs text-[#FF3B30]">Needs your access key.</p>
      ) : data?.error ? (
        <p className="text-xs text-[#FF3B30]">{data.error}</p>
      ) : data && !data.configured ? (
        <p className={cn("text-xs", T.muted)}>Tracking needs the Upstash store connected on Vercel.</p>
      ) : s ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Picks logged", value: String(s.picks), sub: `${s.settled} settled` },
              { label: "Hit rate", value: s.settled ? `${Math.round((s.wins / s.settled) * 100)}%` : "—", sub: `${s.wins}-${s.settled - s.wins}` },
              { label: "Flat ROI", value: signed(s.roi), sub: "1 unit a pick, after fees", tone: tone(s.roi) },
              {
                label: "Avg CLV",
                value: signed(s.clv),
                sub: s.clvN ? `${Math.round((s.beatClose ?? 0) * 100)}% beat the close · n=${s.clvN}` : "No closing lines yet",
                tone: tone(s.clv),
              },
            ].map((t) => (
              <div key={t.label} className={cn(T.inset, "p-3")}>
                <p className={T.label}>{t.label}</p>
                <p className={cn("font-kalshi-condensed mt-1 text-2xl tabular-nums", t.tone)}>{t.value}</p>
                <p className={cn("text-[11px]", T.muted)}>{t.sub}</p>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className={T.muted}>
                <tr>
                  <th className="py-1.5 pr-3 font-semibold">Basis</th>
                  <th className="py-1.5 pr-3 font-semibold">Picks</th>
                  <th className="py-1.5 pr-3 font-semibold">W-L</th>
                  <th className="py-1.5 pr-3 font-semibold">ROI</th>
                  <th className="py-1.5 font-semibold">CLV</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, r]) => (
                  <tr key={label} className="border-t border-[#1E2638]">
                    <td className="py-1.5 pr-3">{label}</td>
                    <td className="py-1.5 pr-3">{r?.picks ?? 0}</td>
                    <td className="py-1.5 pr-3">{r ? `${r.wins}-${r.settled - r.wins}` : "—"}</td>
                    <td className={cn("py-1.5 pr-3", tone(r?.roi ?? null))}>{signed(r?.roi ?? null)}</td>
                    <td className={cn("py-1.5", tone(r?.clv ?? null))}>{signed(r?.clv ?? null)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={cn("text-[11px]", T.muted)}>
            {s.picks < PROVEN
              ? `${PROVEN - s.picks} more picks before these numbers mean much — small samples swing wildly.`
              : s.clv !== null && s.clv > 0
                ? "Beating the close on a real sample: the scanner is finding prices the market later agrees with."
                : "Not beating the close on a real sample: treat picks as entertainment until that changes."}
          </p>
          {(data?.recent ?? []).length > 0 && (
            <details className="text-xs">
              <summary className={cn("cursor-pointer", T.muted)}>Recent picks</summary>
              <ul className="mt-2 flex flex-col divide-y divide-[#1E2638] rounded-xl border border-[#1E2638]">
                {data!.recent!.map((p) => (
                  <li key={p.ticker} className="flex items-center gap-2 bg-[#050D0A] px-3 py-2">
                    <span className="min-w-0 flex-1 truncate">
                      {p.pick} <span className={T.muted}>· {p.matchup}</span>
                    </span>
                    <span className={cn("shrink-0", T.muted)}>{{ sharp: "Edge", safe: "Safe", mismatch: "Mismatch", ai: "AI" }[p.basis]}</span>
                    <span className="shrink-0 tabular-nums">{p.entry}¢</span>
                    {typeof p.close === "number" && (
                      <span className={cn("shrink-0 tabular-nums", tone(p.close / p.entry - 1))}>→ {p.close.toFixed(1)}¢</span>
                    )}
                    <span
                      className={cn(
                        "font-kalshi-bold w-10 shrink-0 text-right",
                        p.result === "WIN" ? "text-[#00DD94]" : p.result === "LOSS" ? "text-[#FF3B30]" : T.muted
                      )}
                    >
                      {p.result && p.result !== "PENDING" ? p.result : "open"}
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        <p className={cn("text-xs", T.muted)}>{loading ? "Loading…" : "No picks logged yet — run a Top Picks scan."}</p>
      )}
    </div>
  );
}
