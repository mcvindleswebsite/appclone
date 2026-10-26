"use client";

import { ArrowRightLeft, Loader2, Radar, RefreshCw, Vault } from "lucide-react";
import { useState } from "react";

import { formatAmerican, kalshiDecimal } from "@/lib/bet/engine";
import { DEFAULT_WAGER, formatMoney } from "@/lib/bet/pnl";
import { cn } from "@/lib/utils";
import type { SoccerRecommendation } from "@/types/bet";

import { T } from "./theme";

const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

const kickoff = (settlesAt: string) =>
  // Kalshi settles soccer markets about two hours after kickoff.
  new Date(Date.parse(settlesAt) - 2 * 60 * 60 * 1000).toLocaleString("en-US", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export function Scanner({
  accessKey,
  keyBroken,
  onImport,
  onLog,
}: {
  accessKey: string;
  keyBroken: boolean;
  /** Moves the recommended legs into the evaluator. */
  onImport: (rec: SoccerRecommendation) => void;
  /** Saves the recommended ticket to the vault with a stake; returns a status line. */
  onLog: (rec: SoccerRecommendation, wager: number) => string;
}) {
  const [rec, setRec] = useState<(SoccerRecommendation & { cached?: boolean }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wager, setWager] = useState(String(DEFAULT_WAGER));
  const [logged, setLogged] = useState<string | null>(null);

  const generate = async (fresh = false) => {
    setLoading(true);
    setError(null);
    setLogged(null);
    try {
      const response = await fetch(`/api/recommendations${fresh ? "?fresh=1" : ""}`, {
        method: "POST",
        headers: { "x-bet-key": accessKey },
      });
      const data = (await response.json()) as SoccerRecommendation | { error: string };
      if ("error" in data) setError(data.error);
      else setRec(data);
    } catch {
      setError("Couldn't reach the scanner — try again.");
    } finally {
      setLoading(false);
    }
  };

  const stake = Number(wager) || 0;
  const disabled = !accessKey || keyBroken || loading;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div className={cn(T.card, "flex flex-col gap-4 p-4 sm:p-5")}>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--accent-deep)">
            <Radar className="size-5 text-(--accent)" />
          </span>
          <div>
            <h2 className="font-kalshi-bold text-lg">AI Soccer Scanner</h2>
            <p className={cn("text-sm", T.muted)}>
              Scans upcoming Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions League, Europa League,
              and MLS matches on Kalshi, researches the strongest favorites, and keeps only legs that are +EV after fees.
            </p>
          </div>
        </div>
        <button
          type="button"
          disabled={disabled}
          onClick={() => void generate()}
          className="font-kalshi-bold flex min-h-12 items-center justify-center gap-2 rounded-xl bg-(--accent) text-sm text-[#050D0A] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Scanning fixtures and researching legs…
            </>
          ) : (
            <>
              <Radar className="size-4" /> Generate Best 5-Leg Soccer Parlay
            </>
          )}
        </button>
        {(!accessKey || keyBroken) && (
          <p className="text-xs text-[#FF3B30]">The scanner needs a working access key (key icon, top right).</p>
        )}
        {loading && <p className={cn("text-xs", T.muted)}>Researching about a dozen matches in parallel — usually under a minute.</p>}
        {error && <p className="text-xs text-[#FF3B30]">{error}</p>}
      </div>

      {rec && (
        <>
          <div className={cn(T.card, "flex flex-col gap-4 p-4 sm:p-5")}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className={T.label}>
                {rec.legs.length}-Leg Ticket · scanned {rec.scanned.fixtures} fixtures, researched {rec.scanned.researched}
              </p>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void generate(true)}
                className="flex items-center gap-1 text-[11px] text-[#F5F7F4]/60 hover:text-white disabled:opacity-40"
              >
                <RefreshCw className="size-3" />
                {rec.cached ? "Cached · rescan" : "Rescan"}
              </button>
            </div>

            {rec.parlay && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Win Prob", value: pct(rec.parlay.probability, rec.parlay.probability < 0.1 ? 1 : 0) },
                  { label: "Est. Odds", value: formatAmerican(rec.parlay.american) },
                  { label: "Parlay EV", value: signedPct(rec.parlay.ev), tone: rec.parlay.ev > 0 ? T.yes : T.no },
                  { label: "$10 Pays", value: formatMoney(rec.parlay.decimal * 10) },
                ].map((s) => (
                  <div key={s.label} className={cn(T.inset, "p-3")}>
                    <p className={T.label}>{s.label}</p>
                    <p className={cn("font-kalshi-condensed mt-1 text-2xl tabular-nums", s.tone)}>{s.value}</p>
                  </div>
                ))}
              </div>
            )}

            {rec.legs.length === 0 ? (
              <p className={cn("text-sm", T.muted)}>No leg cleared the bar this scan. Try again closer to kickoff, when prices move.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-[#1E2638] overflow-hidden rounded-xl border border-[#1E2638]">
                {rec.legs.map((l, i) => (
                  <li key={l.leg.ticker ?? i} className="flex flex-col gap-1.5 bg-[#050D0A] p-3">
                    <div className="flex items-start gap-2">
                      <span className="font-kalshi-bold w-5 shrink-0 pt-0.5 text-xs text-[#F5F7F4]/50">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-kalshi-bold truncate text-sm">{l.leg.market}</p>
                        <p className={cn("truncate text-[11px]", T.muted)}>
                          {l.leg.matchup} · {l.league} · {kickoff(l.settlesAt)}
                        </p>
                      </div>
                      <span className="font-kalshi-bold shrink-0 rounded-full border border-(--accent)/50 bg-(--accent-deep) px-2 py-0.5 text-[10px] text-(--accent)">
                        {signedPct(l.ev)} EV
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-7 text-[11px] tabular-nums text-[#F5F7F4]/60">
                      <span className="text-white">Model {pct(l.modelProbability)}</span>
                      <span>Market {l.leg.price}¢</span>
                      <span>Confidence {l.confidence}/10</span>
                      {l.opponentTier.playUpSpot && <span className={T.yes}>Play-up spot</span>}
                    </div>
                    <p className="pl-7 text-xs text-[#F5F7F4]/85">{l.reason}</p>
                  </li>
                ))}
              </ol>
            )}

            {rec.note && <p className={cn("text-xs", T.muted)}>{rec.note}</p>}
          </div>

          {rec.legs.length > 0 && (
            <div className={cn(T.card, "flex flex-col gap-3 p-4 sm:p-5")}>
              <button
                type="button"
                onClick={() => onImport(rec)}
                className="font-kalshi-bold flex min-h-12 items-center justify-center gap-2 rounded-xl bg-(--accent) text-sm text-[#050D0A] hover:brightness-110"
              >
                <ArrowRightLeft className="size-4" /> Import to Slip
              </button>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative sm:w-32">
                  <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#F5F7F4]/50">$</span>
                  <input
                    inputMode="decimal"
                    value={wager}
                    onChange={(e) => setWager(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))}
                    aria-label="Overall wager on this ticket, in dollars"
                    className={cn(T.input, "pl-7 tabular-nums")}
                  />
                </div>
                <button
                  type="button"
                  disabled={!stake}
                  onClick={() => setLogged(onLog(rec, stake))}
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#1E2638] px-4 text-sm font-semibold hover:bg-(--accent-deep) disabled:opacity-40"
                >
                  <Vault className="size-4" /> Log to Vault
                  {stake > 0 &&
                    ` · ${formatMoney(stake)} pays ${formatMoney(
                      stake * rec.legs.reduce((acc, l) => acc * kalshiDecimal(l.leg.price ?? 50), 1)
                    )}`}
                </button>
              </div>
              {logged && <p className={cn("text-xs", T.yes)}>{logged}</p>}
              <p className={cn("text-[11px] leading-relaxed", T.muted)}>
                Model estimates, not guarantees. Odds are estimated from each leg&apos;s own Kalshi price; build the combo on
                Kalshi to see its exact quote. Bet only what you can afford to lose.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
