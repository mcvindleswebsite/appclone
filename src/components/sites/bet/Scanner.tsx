"use client";

import { ArrowRightLeft, Hourglass, Loader2, Radar, RefreshCw, Vault } from "lucide-react";
import { useEffect, useState } from "react";

import { decimalToAmerican, formatAmerican, kalshiDecimal } from "@/lib/bet/engine";
import { DEFAULT_WAGER, formatMoney } from "@/lib/bet/pnl";
import {
  kickoffOf,
  SCAN_LEAGUES,
  TIME_WINDOWS,
  windowRange,
  type ScanLeague,
  type TimeWindow,
} from "@/lib/bet/scan-scope";
import { cn } from "@/lib/utils";
import type { RecommendedLeg, SoccerRecommendation } from "@/types/bet";

import { T } from "./theme";

const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

const kickoff = (settlesAt: string) =>
  new Date(kickoffOf(settlesAt)).toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const seasonEnd = (settlesAt: string) =>
  `settles ${new Date(settlesAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

/** Whether a scanned leg falls inside the selected leagues and timeframe. */
const inScope = (l: RecommendedLeg, frame: TimeWindow, leagues: Set<ScanLeague>, now: number) => {
  if (!leagues.has(l.league as ScanLeague)) return false;
  if (frame === "futures") return !!l.futures;
  if (l.futures) return false;
  const { from, to } = windowRange(frame, now);
  const k = kickoffOf(l.settlesAt);
  return k >= from && k < to;
};

/** Ticket math for the legs on screen, which may be a filtered subset of the scan. */
const parlayOf = (legs: RecommendedLeg[]): SoccerRecommendation["parlay"] => {
  if (legs.length < 2) return null;
  const probability = legs.reduce((acc, l) => acc * l.modelProbability, 1);
  const decimal = legs.reduce((acc, l) => acc * kalshiDecimal(l.leg.price ?? 50), 1);
  return { probability, decimal, american: decimalToAmerican(decimal), ev: probability * decimal - 1 };
};

/** Timeframe slider: five stops, with a thumb that slides to the selected one. */
function TimeSlider({ value, onChange }: { value: TimeWindow; onChange: (w: TimeWindow) => void }) {
  const index = TIME_WINDOWS.findIndex((w) => w.id === value);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className={T.label}>Timeframe</p>
        <p className={cn("text-[11px]", T.muted)}>
          {value === "futures" ? "Season-long title markets" : "Matches kicking off in this window"}
        </p>
      </div>
      <div
        role="radiogroup"
        aria-label="Timeframe"
        onKeyDown={(e) => {
          const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (!step) return;
          e.preventDefault();
          onChange(TIME_WINDOWS[Math.min(TIME_WINDOWS.length - 1, Math.max(0, index + step))].id);
        }}
        className="relative grid grid-cols-5 rounded-full border border-[#1E2638] bg-[#050D0A] p-1"
      >
        <span
          aria-hidden
          className="absolute inset-y-1 left-1 rounded-full bg-(--accent) transition-transform duration-300 ease-out"
          style={{ width: `calc((100% - 0.5rem) / ${TIME_WINDOWS.length})`, transform: `translateX(${index * 100}%)` }}
        />
        {TIME_WINDOWS.map((w) => (
          <button
            key={w.id}
            type="button"
            role="radio"
            aria-checked={w.id === value}
            tabIndex={w.id === value ? 0 : -1}
            onClick={() => onChange(w.id)}
            className={cn(
              "relative z-10 flex min-h-9 items-center justify-center gap-1 rounded-full px-1 text-[11px] font-semibold whitespace-nowrap transition-colors sm:text-xs",
              w.id === value ? "text-[#050D0A]" : "text-[#F5F7F4]/60 hover:text-white"
            )}
          >
            {w.id === "futures" && <Hourglass className="hidden size-3 sm:block" />}
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** League chips: tap to toggle, "All" resets. At least one league always stays on. */
function LeaguePicker({ value, onChange }: { value: Set<ScanLeague>; onChange: (next: Set<ScanLeague>) => void }) {
  const all = value.size === SCAN_LEAGUES.length;
  const chip = (on: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
      on
        ? "border-(--accent)/60 bg-(--accent-deep) text-(--accent)"
        : "border-[#1E2638] bg-[#050D0A] text-[#F5F7F4]/60 hover:text-white"
    );
  return (
    <div className="flex flex-col gap-2">
      <p className={T.label}>Leagues</p>
      <div className="flex flex-wrap gap-1.5">
        <button type="button" aria-pressed={all} onClick={() => onChange(new Set(SCAN_LEAGUES))} className={chip(all)}>
          All
        </button>
        {SCAN_LEAGUES.map((league) => {
          const on = !all && value.has(league);
          return (
            <button
              key={league}
              type="button"
              aria-pressed={on}
              onClick={() => {
                // From "All", a tap narrows to that one league; otherwise it toggles.
                const next = all ? new Set<ScanLeague>() : new Set(value);
                if (on) next.delete(league);
                else next.add(league);
                onChange(next.size ? next : new Set(SCAN_LEAGUES));
              }}
              className={chip(on)}
            >
              {league}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
  const [frame, setFrame] = useState<TimeWindow>("week");
  const [leagues, setLeagues] = useState<Set<ScanLeague>>(() => new Set(SCAN_LEAGUES));
  /** The clock the timeframe filter reads; refreshed each minute so "Today" rolls over. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const windowLabel = TIME_WINDOWS.find((w) => w.id === frame)!.label;
  const shown = rec ? rec.legs.filter((l) => inScope(l, frame, leagues, now)) : [];
  const parlay = parlayOf(shown);
  const ticket: SoccerRecommendation | null = rec ? { ...rec, legs: shown, parlay } : null;
  // The last scan covered a different timeframe or leagues than the ones picked now.
  const stale =
    !!rec?.scope &&
    (rec.scope.window !== frame ||
      rec.scope.leagues.length !== leagues.size ||
      rec.scope.leagues.some((l) => !leagues.has(l)));

  const generate = async (fresh = false) => {
    const at = Date.now();
    setNow(at);
    setLoading(true);
    setError(null);
    setLogged(null);
    try {
      const response = await fetch(`/api/recommendations${fresh ? "?fresh=1" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bet-key": accessKey },
        body: JSON.stringify({ window: frame, ...windowRange(frame, at), leagues: [...leagues] }),
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
              Scans upcoming {SCAN_LEAGUES.slice(0, -1).join(", ")}, and {SCAN_LEAGUES.at(-1)} matches on Kalshi — or
              season-long title races in the Waiting Game — researches the strongest favorites, and keeps only legs that
              are +EV after fees.
            </p>
          </div>
        </div>
        <TimeSlider
          value={frame}
          onChange={(w) => {
            setFrame(w);
            setNow(Date.now());
            setLogged(null);
          }}
        />
        <LeaguePicker
          value={leagues}
          onChange={(next) => {
            setLeagues(next);
            setLogged(null);
          }}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={() => void generate()}
          className="font-kalshi-bold flex min-h-12 items-center justify-center gap-2 rounded-xl bg-(--accent) text-sm text-[#050D0A] transition-all hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {loading ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Analyzing all active fixtures across selected leagues…
            </>
          ) : (
            <>
              {frame === "futures" ? <Hourglass className="size-4" /> : <Radar className="size-4" />}
              {frame === "futures" ? "Generate Best Waiting Game Ticket" : `Generate Best 5-Leg Parlay · ${windowLabel}`}
            </>
          )}
        </button>
        {(!accessKey || keyBroken) && (
          <p className="text-xs text-[#FF3B30]">The scanner needs a working access key (key icon, top right).</p>
        )}
        {loading && (
          <p className={cn("text-xs", T.muted)}>
            Full-market analysis: every active {frame === "futures" ? "title market" : "fixture"} in {leagues.size === SCAN_LEAGUES.length ? "all leagues" : [...leagues].join(", ")} for {windowLabel.toLowerCase()} is researched, 16 at a time — bigger windows take up to a few minutes.
          </p>
        )}
        {error && <p className="text-xs text-[#FF3B30]">{error}</p>}
        {frame === "futures" && leagues.has("Saudi Pro League") && (
          <p className={cn("text-[11px]", T.muted)}>
            Kalshi has no Saudi Pro League title market yet — its matches show under the other timeframes.
          </p>
        )}
      </div>

      {rec && ticket && (
        <>
          <div className={cn(T.card, "flex flex-col gap-4 p-4 sm:p-5")}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className={T.label}>
                {shown.length}-Leg Ticket · {windowLabel} · scanned {rec.scanned.fixtures}{" "}
                {rec.scope?.window === "futures" ? "markets" : "fixtures"}, researched {rec.scanned.researched}
                {rec.scanned.skipped ? ` (${rec.scanned.skipped} out of time)` : ""}
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

            {parlay && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: "Win Prob", value: pct(parlay.probability, parlay.probability < 0.1 ? 1 : 0) },
                  { label: "Est. Odds", value: formatAmerican(parlay.american) },
                  { label: "Parlay EV", value: signedPct(parlay.ev), tone: parlay.ev > 0 ? T.yes : T.no },
                  { label: "$10 Pays", value: formatMoney(parlay.decimal * 10) },
                ].map((s) => (
                  <div key={s.label} className={cn(T.inset, "p-3")}>
                    <p className={T.label}>{s.label}</p>
                    <p className={cn("font-kalshi-condensed mt-1 text-2xl tabular-nums", s.tone)}>{s.value}</p>
                  </div>
                ))}
              </div>
            )}

            {shown.length === 0 ? (
              <p className={cn("text-sm", T.muted)}>
                {rec.legs.length === 0
                  ? "No leg cleared the bar this scan. Try again closer to kickoff, when prices move."
                  : stale
                    ? `None of this scan's ${rec.legs.length} legs fit ${windowLabel} in the leagues picked — tap Generate to scan them.`
                    : `None of this scan's legs fit ${windowLabel} any more — rescan for fresh fixtures.`}
              </p>
            ) : (
              <ol className="flex flex-col divide-y divide-[#1E2638] overflow-hidden rounded-xl border border-[#1E2638]">
                {shown.map((l, i) => (
                  <li key={l.leg.ticker ?? i} className="flex flex-col gap-1.5 bg-[#050D0A] p-3">
                    <div className="flex items-start gap-2">
                      <span className="font-kalshi-bold w-5 shrink-0 pt-0.5 text-xs text-[#F5F7F4]/50">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-kalshi-bold truncate text-sm">{l.leg.market}</p>
                        <p className={cn("truncate text-[11px]", T.muted)}>
                          {l.leg.matchup} · {l.league} · {l.futures ? seasonEnd(l.settlesAt) : kickoff(l.settlesAt)}
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
            {stale && shown.length > 0 && (
              <p className={cn("text-[11px]", T.muted)}>
                Filtered from the last scan ({rec.legs.length} legs) — Generate to scan {windowLabel} in these leagues.
              </p>
            )}
          </div>

          {shown.length > 0 && (
            <div className={cn(T.card, "flex flex-col gap-3 p-4 sm:p-5")}>
              <button
                type="button"
                onClick={() => onImport(ticket)}
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
                  onClick={() => setLogged(onLog(ticket, stake))}
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#1E2638] px-4 text-sm font-semibold hover:bg-(--accent-deep) disabled:opacity-40"
                >
                  <Vault className="size-4" /> Log to Vault
                  {stake > 0 &&
                    ` · ${formatMoney(stake)} pays ${formatMoney(
                      stake * shown.reduce((acc, l) => acc * kalshiDecimal(l.leg.price ?? 50), 1)
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
