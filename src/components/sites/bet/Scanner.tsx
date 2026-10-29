"use client";

import { ArrowRightLeft, Hourglass, Loader2, Microscope, Plus, Radar, RefreshCw, Vault, X } from "lucide-react";
import { useEffect, useState } from "react";

import { adviseStake, type BankrollSettings } from "@/lib/bet/bankroll";
import { decimalToAmerican, kalshiDecimal } from "@/lib/bet/engine";
import { buildParlay, PAYOUT_TARGETS } from "@/lib/bet/parlay-builder";
import { DEFAULT_WAGER, formatMoney } from "@/lib/bet/pnl";
import {
  kickoffOf,
  leaguesOfSport,
  SCAN_LEAGUES,
  TIME_WINDOWS,
  windowRange,
  type ScanLeague,
  type ScanSport,
  type TimeWindow,
} from "@/lib/bet/scan-scope";
import { cn } from "@/lib/utils";
import type { BetLeg, LegAnalysis, RecommendedLeg, SoccerRecommendation, VaultProfile } from "@/types/bet";

import { GameLink } from "./GameLink";
import { PriceGapList, type GapState } from "./PriceGaps";
import { T } from "./theme";

const pct = (n: number, digits = 0) => `${(n * 100).toFixed(digits)}%`;
const signedPct = (n: number) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;

const kickoff = (settlesAt: string, league: string) =>
  new Date(kickoffOf(settlesAt, league)).toLocaleString("en-US", {
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
  const k = kickoffOf(l.settlesAt, l.league);
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

/** Leagues the viewer has X'd out, remembered in this browser. */
const EXCLUDED_LEAGUES_STORAGE = "mcvindle_bet_excluded_leagues";
const SPORT_STORAGE = "mcvindle_bet_scan_sport";

const SPORTS: { id: ScanSport; label: string }[] = [
  { id: "soccer", label: "Soccer" },
  { id: "basketball", label: "Basketball" },
];

/**
 * League chips: every league starts in; tap one to X it out (struck through), tap again to
 * bring it back. The last league left can't be removed.
 */
function LeaguePicker({
  options,
  value,
  onChange,
}: {
  options: readonly ScanLeague[];
  value: Set<ScanLeague>;
  onChange: (next: Set<ScanLeague>) => void;
}) {
  const excluded = options.filter((l) => !value.has(l));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className={T.label}>Leagues</p>
        {excluded.length > 0 && (
          <button
            type="button"
            onClick={() => onChange(new Set(options))}
            className="text-[11px] text-[#F5F7F4]/60 hover:text-white"
          >
            Reset ({excluded.length} out)
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options.map((league) => {
          const on = value.has(league);
          const last = on && value.size === 1;
          return (
            <button
              key={league}
              type="button"
              aria-pressed={on}
              aria-label={on ? `Exclude ${league}` : `Include ${league}`}
              disabled={last}
              title={last ? "At least one league stays in" : undefined}
              onClick={() => {
                const next = new Set(value);
                if (on) next.delete(league);
                else next.add(league);
                onChange(next);
              }}
              className={cn(
                "flex items-center gap-1 rounded-full border py-1 pr-2 pl-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed",
                on
                  ? "border-(--accent)/60 bg-(--accent-deep) text-(--accent)"
                  : "border-[#1E2638] bg-[#050D0A] text-[#F5F7F4]/40 line-through decoration-[#FF3B30]/70 hover:text-[#F5F7F4]/70"
              )}
            >
              {league}
              {on ? (
                <X className={cn("size-3.5", last ? "opacity-30" : "opacity-70")} aria-hidden />
              ) : (
                <Plus className="size-3.5 opacity-70" aria-hidden />
              )}
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
  profile,
  bankroll,
  exposure,
  gaps,
  gapAlerts,
  onGapAlerts,
  onEvaluateLeg,
  onImport,
  onLog,
  onLogSingles,
}: {
  accessKey: string;
  keyBroken: boolean;
  /** Bet Vault summary sent with each scan, so picks are weighed against your own record. */
  profile: VaultProfile;
  bankroll: BankrollSettings;
  /** Dollars already staked today, for the daily cap. */
  exposure: number;
  gaps: GapState;
  gapAlerts: boolean;
  onGapAlerts: (on: boolean) => void;
  /** Loads one leg (from a price-gap alert) into the evaluator. */
  onEvaluateLeg: (leg: BetLeg) => void;
  /** Moves the recommended legs into the evaluator. */
  onImport: (rec: SoccerRecommendation) => void;
  /** Saves the recommended ticket to the vault with a stake; returns a status line. */
  onLog: (rec: SoccerRecommendation, wager: number) => string;
  /** Saves each leg as its own single at its own stake; returns a status line. */
  onLogSingles: (rec: SoccerRecommendation, stakes: number[]) => string;
}) {
  const [mode, setMode] = useState<"singles" | "parlay">("parlay");
  /** Parlay payout to build toward (× stake). */
  const [target, setTarget] = useState<number>(10);
  /**
   * What a pick rests on: who the AI thinks wins (default), a good team against a
   * bottom-third one, the likeliest winners, or a price edge vs the sharp books.
   */
  const [pickMode, setPickMode] = useState<"opinion" | "mismatch" | "safe" | "sharp">("opinion");
  /** On-demand deep checks in flight or failed, by ticker. */
  const [deepState, setDeepState] = useState<Record<string, { busy: boolean; error?: string }>>({});

  /** Re-researches one pick on the deep model with API-Football data, and folds the result into the scan. */
  const deepCheck = async (l: RecommendedLeg) => {
    const ticker = l.leg.ticker;
    if (!ticker) return;
    setDeepState((s) => ({ ...s, [ticker]: { busy: true } }));
    try {
      const response = await fetch("/api/recommendations/deep", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bet-key": accessKey },
        body: JSON.stringify({
          leg: l.leg,
          league: l.league,
          kickoffTime: l.kickoffTime,
          volume: l.volume ?? 0,
          // An AI pick is judged on the AI's estimate; the books' price gates the other two.
          sharp: l.basis === "ai" ? undefined : l.sharp,
          futures: !!l.futures,
          mode: rec?.mode ?? l.basis,
          history: profile,
        }),
      });
      const data = (await response.json()) as
        | { analysis: LegAnalysis; footballData: boolean; failReason: string | null }
        | { error: string };
      if ("error" in data) {
        setDeepState((s) => ({ ...s, [ticker]: { busy: false, error: data.error } }));
        return;
      }
      const a = data.analysis;
      setRec((prev) =>
        prev && {
          ...prev,
          legs: prev.legs.map((x) => {
            if (x.leg.ticker !== ticker) return x;
            // Keep the line-value stats computed from prices; replace the research ones.
            const priceStats = x.reasoningStats.filter(
              (st) => st.source === "Kalshi" || st.source.startsWith("Vindle") || st.metric === "Sharp fair probability"
            );
            const p = x.basis === "sharp" ? x.modelProbability : a.probability;
            const decimal = kalshiDecimal(x.leg.price ?? 50);
            return {
              ...x,
              reasoningStats: [...priceStats, ...(a.reasoningStats ?? [])],
              confidence: a.hitConfidence,
              confidenceRating: a.hitConfidence,
              reason: a.reason,
              rating: a.rating,
              opponentTier: a.opponentTier,
              historyFlag: a.historyFlag ?? "",
              aiProbability: a.probability,
              modelProbability: p,
              ev: p * decimal - 1,
              deep: true,
              footballData: data.footballData,
              vetoed: data.failReason ?? undefined,
            };
          }),
        }
      );
      setDeepState((s) => ({ ...s, [ticker]: { busy: false } }));
    } catch {
      setDeepState((s) => ({ ...s, [ticker]: { busy: false, error: "Couldn't reach the server." } }));
    }
  };
  const [rec, setRec] = useState<(SoccerRecommendation & { cached?: boolean }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wager, setWager] = useState(String(DEFAULT_WAGER));
  const [logged, setLogged] = useState<string | null>(null);
  const [frame, setFrame] = useState<TimeWindow>("week");
  /** Every league left in, across both sports; a scan covers the current sport's share. */
  const [picked, setPicked] = useState<Set<ScanLeague>>(() => new Set(SCAN_LEAGUES));
  const [sport, setSport] = useState<ScanSport>("soccer");
  const sportLeagues = leaguesOfSport(sport);
  const leagues = new Set(sportLeagues.filter((l) => picked.has(l)));
  // Restore X'd-out leagues and the sport after mount (localStorage isn't readable during the server render).
  useEffect(() => {
    const restore = setTimeout(() => {
      try {
        if (localStorage.getItem(SPORT_STORAGE) === "basketball") setSport("basketball");
        const saved = JSON.parse(localStorage.getItem(EXCLUDED_LEAGUES_STORAGE) ?? "[]") as unknown;
        const out = new Set(Array.isArray(saved) ? saved : []);
        const kept = SCAN_LEAGUES.filter((l) => !out.has(l));
        if (kept.length && kept.length < SCAN_LEAGUES.length) setPicked(new Set(kept));
      } catch {
        // Nothing saved, or storage blocked: every league stays in.
      }
    }, 0);
    return () => clearTimeout(restore);
  }, []);
  /** The clock the timeframe filter reads; refreshed each minute so "Today" rolls over. */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const windowLabel = TIME_WINDOWS.find((w) => w.id === frame)!.label;
  const shown = rec ? rec.legs.filter((l) => inScope(l, frame, leagues, now)) : [];
  // Parlay mode: the combination of picks likeliest to hit that still pays the target.
  const built = mode === "parlay" ? buildParlay(shown.filter((l) => !l.vetoed), target) : null;
  const parlayLegs = built?.legs ?? shown;
  const parlay = parlayOf(parlayLegs);
  const ticket: SoccerRecommendation | null = rec ? { ...rec, legs: shown, parlay: parlayOf(shown) } : null;
  const parlayTicket: SoccerRecommendation | null = rec ? { ...rec, legs: parlayLegs, parlay } : null;
  /** The legs listed: the built parlay's in parlay mode, every pick for singles. */
  const listed = mode === "parlay" && built ? parlayLegs : shown;
  // The last scan covered a different timeframe or leagues than the ones picked now.
  const stale =
    !!rec?.scope &&
    ((rec.mode ?? "sharp") !== pickMode ||
      rec.scope.window !== frame ||
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
        body: JSON.stringify({ window: frame, ...windowRange(frame, at), leagues: [...leagues], history: profile, mode: pickMode }),
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

  // Singles: each leg sized by fractional Kelly, the daily cap shared down the list; with no
  // bankroll set, every single takes the flat stake below.
  let running = exposure;
  // Modes that pick on who wins rather than on price take a flat stake: Kelly stakes nothing
  // on a pick without a price edge.
  const flatStakes = rec?.mode === "opinion" || rec?.mode === "safe" || rec?.mode === "mismatch";
  const singleStakes = shown.map((l) => {
    // A pick the deep check vetoed gets no stake.
    if (l.vetoed) return { amount: 0, advice: null };
    const advice = flatStakes ? null : adviseStake(bankroll, l.modelProbability, kalshiDecimal(l.leg.price ?? 50), running);
    const amount = advice ? advice.stake : stake;
    running += amount;
    return { amount, advice };
  });
  const singlesTotal = singleStakes.reduce((s, x) => s + x.amount, 0);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PriceGapList state={gaps} enabled={gapAlerts} onToggle={onGapAlerts} onEvaluate={onEvaluateLeg} />
      <div className={cn(T.card, "flex flex-col gap-4 p-4 sm:p-5")}>
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--accent-deep)">
            <Radar className="size-5 text-(--accent)" />
          </span>
          <div>
            <h2 className="font-kalshi-bold text-lg">AI {sport === "basketball" ? "Basketball" : "Soccer"} Scanner</h2>
            <p className={cn("text-sm", T.muted)}>
              Covers {sportLeagues.slice(0, -1).join(", ")}, and {sportLeagues.at(-1)} on Kalshi. AI Picks researches
              the 15 clearest favorites and keeps the ones the AI rates 60%+ to win with real confidence. Deep-check any
              pick before you bet it. Season-long title races live in the Waiting Game.
            </p>
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <p className={T.label}>Pick Style</p>
          <div role="radiogroup" aria-label="Pick style" className="grid grid-cols-2 gap-1 rounded-xl sm:grid-cols-4 border border-[#1E2638] bg-[#050D0A] p-1">
            {(
              [
                ["opinion", "AI Picks", "Who the AI thinks wins"],
                ["mismatch", "Mismatches", "Good team vs bottom third"],
                ["safe", "Safest Wins", "Likeliest winners, 60%+"],
                ["sharp", "Price Edges", "Cheaper than the books"],
              ] as const
            ).map(([id, label, sub]) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={pickMode === id}
                onClick={() => {
                  setPickMode(id);
                  setLogged(null);
                }}
                className={cn(
                  "flex flex-col items-center rounded-lg px-2 py-2 transition-colors",
                  pickMode === id ? "bg-(--accent) text-[#050D0A]" : "text-[#F5F7F4]/60 hover:text-white"
                )}
              >
                <span className="text-xs font-semibold">{label}</span>
                <span className={cn("text-[10px]", pickMode === id ? "text-[#050D0A]/70" : "text-[#F5F7F4]/40")}>{sub}</span>
              </button>
            ))}
          </div>
        </div>
        <div role="radiogroup" aria-label="Sport" className="grid grid-cols-2 gap-1 rounded-xl border border-[#1E2638] bg-[#050D0A] p-1">
          {SPORTS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={sport === id}
              onClick={() => {
                setSport(id);
                setLogged(null);
                try {
                  localStorage.setItem(SPORT_STORAGE, id);
                } catch {
                  // Private mode: the choice lasts for this visit.
                }
              }}
              className={cn(
                "rounded-lg px-2 py-2 text-xs font-semibold transition-colors",
                sport === id ? "bg-(--accent) text-[#050D0A]" : "text-[#F5F7F4]/60 hover:text-white"
              )}
            >
              {label}
            </button>
          ))}
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
          options={sportLeagues}
          value={leagues}
          onChange={(next) => {
            const all = new Set([...picked].filter((l) => !sportLeagues.includes(l)).concat([...next]));
            setPicked(all);
            setLogged(null);
            try {
              localStorage.setItem(EXCLUDED_LEAGUES_STORAGE, JSON.stringify(SCAN_LEAGUES.filter((l) => !all.has(l))));
            } catch {
              // Private mode: the choice lasts for this visit.
            }
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
              <Loader2 className="size-4 animate-spin" /> Pricing every fixture, researching the best…
            </>
          ) : (
            <>
              {frame === "futures" ? <Hourglass className="size-4" /> : <Radar className="size-4" />}
              {frame === "futures" ? "Generate Best Waiting Game Picks" : `Generate Best Picks · ${windowLabel}`}
            </>
          )}
        </button>
        {(!accessKey || keyBroken) && (
          <p className="text-xs text-[#FF3B30]">The scanner needs a working access key (key icon, top right).</p>
        )}
        {loading && (
          <p className={cn("text-xs", T.muted)}>
            Full-market analysis: every active {frame === "futures" ? "title market" : "fixture"} in{" "}
            {leagues.size === sportLeagues.length
              ? `all ${sport} leagues`
              : leagues.size >= sportLeagues.length - 3 && sportLeagues.length > 4
                ? `all leagues except ${sportLeagues.filter((l) => !leagues.has(l)).join(", ")}`
                : [...leagues].join(", ")} for {windowLabel.toLowerCase()} is
            priced against the sharp books, then the 15 best candidates are researched against your Bet Vault record.
            Usually under a minute.
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
                {shown.length} Pick{shown.length === 1 ? "" : "s"} · {windowLabel} · {rec.scanned.fixtures}{" "}
                {rec.scope?.window === "futures" ? "markets" : "fixtures"}
                {rec.scanned.sharpLines ? ` · ${rec.scanned.sharpLines} sharp-priced` : ""} · {rec.scanned.researched} researched
                {rec.scanned.deep ? ` · ${rec.scanned.deep} deep-checked` : ""}
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

            {shown.length >= 2 && (
              <div
                role="radiogroup"
                aria-label="Ticket type"
                className="flex w-fit gap-1 rounded-full border border-[#1E2638] bg-[#050D0A] p-1"
              >
                {(["singles", "parlay"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => {
                      setMode(m);
                      setLogged(null);
                    }}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
                      mode === m ? "bg-(--accent) text-[#050D0A]" : "text-[#F5F7F4]/60 hover:text-white"
                    )}
                  >
                    {m === "singles" ? "Singles" : "Money Parlay"}
                  </button>
                ))}
              </div>
            )}
            {mode === "parlay" && shown.length >= 2 && (
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={T.label}>Target payout</span>
                  {PAYOUT_TARGETS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      aria-pressed={target === t}
                      onClick={() => {
                        setTarget(t);
                        setLogged(null);
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                        target === t
                          ? "border-(--accent)/60 bg-(--accent-deep) text-(--accent)"
                          : "border-[#1E2638] bg-[#050D0A] text-[#F5F7F4]/60 hover:text-white"
                      )}
                    >
                      {t}×
                    </button>
                  ))}
                </div>
                {built && (
                  <p className="text-xs text-[#F5F7F4]/85">
                    {built.reached
                      ? `Built from ${shown.length} AI picks: the ${built.legs.length} legs most likely to hit that still pay ${target}×.`
                      : `No combination of these ${shown.length} picks reaches ${target}× — this is the biggest available (${built.decimal.toFixed(1)}×). Scan This Week for more legs.`}
                  </p>
                )}
              </div>
            )}
            {mode === "parlay" && parlay && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: `${formatMoney(stake || 10)} Pays`, value: formatMoney(parlay.decimal * (stake || 10)) },
                  { label: "Payout", value: `${parlay.decimal.toFixed(1)}×` },
                  { label: "AI Hit Chance", value: pct(parlay.probability, parlay.probability < 0.1 ? 1 : 0) },
                  { label: "Parlay EV", value: signedPct(parlay.ev), tone: parlay.ev > 0 ? T.yes : T.no },
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
                  ? "No picks this scan — the reason is just below."
                  : stale
                    ? `None of this scan's ${rec.legs.length} legs fit ${windowLabel} in the leagues picked — tap Generate to scan them.`
                    : `None of this scan's legs fit ${windowLabel} any more — rescan for fresh fixtures.`}
              </p>
            ) : (
              <ol className="flex flex-col divide-y divide-[#1E2638] overflow-hidden rounded-xl border border-[#1E2638]">
                {listed.map((l, i) => (
                  <li key={l.leg.ticker ?? i} className="flex flex-col gap-1.5 bg-[#050D0A] p-3">
                    <div className="flex items-start gap-2">
                      <span className="font-kalshi-bold w-5 shrink-0 pt-0.5 text-xs text-[#F5F7F4]/50">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-kalshi-bold truncate text-sm">{l.leg.market}</p>
                        <p className={cn("truncate text-[11px]", T.muted)}>
                          {l.leg.matchup} · {l.league} · {l.futures ? seasonEnd(l.settlesAt) : kickoff(l.settlesAt, l.league)}
                        </p>
                      </div>
                      {!l.futures && <GameLink leg={l.leg} kickoff={l.kickoffTime} className="mt-0.5" />}
                      <span
                        className={cn(
                          "font-kalshi-bold shrink-0 rounded-full border px-2 py-0.5 text-[10px]",
                          l.ev >= 0
                            ? "border-(--accent)/50 bg-(--accent-deep) text-(--accent)"
                            : "border-[#FF3B30]/40 bg-[#FF3B30]/10 text-[#FF3B30]"
                        )}
                      >
                        {signedPct(l.ev)} EV
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 pl-7">
                      <span
                        className={cn(
                          "font-kalshi-bold rounded px-1.5 py-0.5 text-[10px]",
                          l.basis === "ai" ? "bg-[#1E2638] text-[#F5F7F4]/80" : "bg-(--accent-deep) text-(--accent)"
                        )}
                      >
                        {l.basis === "sharp" && l.sharp
                          ? `Sharp edge +${(l.sharp.edge * 100).toFixed(1)} pts`
                          : l.basis === "mismatch" && l.table
                            ? `${ordinal(l.table.pick.rank)} vs ${ordinal(l.table.opponent.rank)} of ${l.table.of}`
                            : l.basis === "safe"
                              ? `${pct(l.modelProbability)} to win`
                              : "AI pick"}
                      </span>
                      {l.table && (l.table.pick.form || l.table.opponent.form) && (
                        <span className="rounded bg-[#1E2638] px-1.5 py-0.5 text-[10px] tracking-wide">
                          Form {l.table.pick.form.slice(-5) || "?"} vs {l.table.opponent.form.slice(-5) || "?"}
                        </span>
                      )}
                      {l.thin && (
                        <span className="rounded bg-[#FF3B30]/10 px-1.5 py-0.5 text-[10px] text-[#FF3B30]">
                          Thin market — use a limit order
                        </span>
                      )}
                      {l.deep && <span className="rounded bg-[#1E2638] px-1.5 py-0.5 text-[10px]">Deep-checked</span>}
                      {l.footballData && <span className="rounded bg-[#1E2638] px-1.5 py-0.5 text-[10px]">API-Football data</span>}
                    </div>
                    <div className="flex flex-wrap gap-x-3 gap-y-0.5 pl-7 text-[11px] tabular-nums text-[#F5F7F4]/60">
                      {l.basis === "safe" || l.basis === "mismatch" ? (
                        <>
                          <span className="text-white">
                            Win chance {pct(l.modelProbability)} ({l.sharp ? l.sharp.source : "Kalshi price"})
                          </span>
                          <span>AI {pct(l.aiProbability ?? l.modelProbability)}</span>
                          <span className={l.ev >= 0 ? T.yes : "text-[#FF3B30]/90"}>EV {signedPct(l.ev)}</span>
                        </>
                      ) : l.basis === "sharp" && l.sharp ? (
                        <>
                          <span className="text-white">
                            Fair {pct(l.sharp.fair)} ({l.sharp.source})
                          </span>
                          <span>AI {pct(l.aiProbability ?? l.modelProbability)}</span>
                        </>
                      ) : (
                        <>
                          <span className="text-white">AI {pct(l.modelProbability)}</span>
                          {l.sharp && (
                            <span className={l.sharp.fair >= l.modelProbability - 0.03 ? undefined : "text-[#FF3B30]/90"}>
                              Books {pct(l.sharp.fair)} ({l.sharp.source})
                            </span>
                          )}
                        </>
                      )}
                      <span>Kalshi {l.leg.price}¢</span>
                      <span>Confidence {l.confidence}/10</span>
                      {l.opponentTier.playUpSpot && <span className={T.yes}>Play-up spot</span>}
                      {mode === "singles" && (
                        <span className="text-white">
                          Stake {formatMoney(singleStakes[i]?.amount ?? 0)}
                          {singleStakes[i]?.advice?.cappedBy ? ` (${singleStakes[i]!.advice!.cappedBy})` : ""}
                        </span>
                      )}
                    </div>
                    <p className="pl-7 text-xs text-[#F5F7F4]/85">{l.reason}</p>
                    {(l.reasoningStats ?? []).length > 0 && (
                      <ul className="flex flex-wrap gap-1 pl-7">
                        {l.reasoningStats.map((s) => (
                          <li
                            key={`${s.metric}:${s.value}`}
                            title={s.source}
                            className="rounded-md border border-[#1E2638] bg-[#121824] px-1.5 py-0.5 text-[10px] text-[#F5F7F4]/70"
                          >
                            {s.metric}: <span className="font-kalshi-bold text-white">{s.value}</span>
                            <span className="text-[#F5F7F4]/40"> · {s.source}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {l.historyFlag && (
                      <p className="pl-7 text-[11px] text-[#F5F7F4]/85">
                        <span className="font-kalshi-bold text-white">Your vault:</span> {l.historyFlag}
                      </p>
                    )}
                    {l.vetoed && (
                      <p className="pl-7 text-xs text-[#FF3B30]">
                        ▲ Deep check vetoed this pick: {l.vetoed}. It&apos;s left out of the stakes below.
                      </p>
                    )}
                    {!l.deep && l.leg.ticker && (
                      <div className="flex flex-wrap items-center gap-2 pl-7">
                        <button
                          type="button"
                          disabled={disabled || deepState[l.leg.ticker]?.busy}
                          onClick={() => void deepCheck(l)}
                          className="flex min-h-8 items-center gap-1.5 rounded-lg bg-[#1E2638] px-2.5 text-[11px] font-semibold hover:bg-(--accent-deep) disabled:opacity-50"
                        >
                          {deepState[l.leg.ticker]?.busy ? (
                            <>
                              <Loader2 className="size-3 animate-spin" /> Deep checking…
                            </>
                          ) : (
                            <>
                              <Microscope className="size-3" /> Deep check before betting
                            </>
                          )}
                        </button>
                        <span className={cn("text-[10px]", T.muted)}>Sonnet + API-Football · roughly $0.10–0.25</span>
                        {deepState[l.leg.ticker]?.error && (
                          <span className="text-[11px] text-[#FF3B30]">{deepState[l.leg.ticker]!.error}</span>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {rec.note && (
              // With no picks the note is the answer, so it reads as one.
              <p className={cn("text-xs", rec.legs.length ? T.muted : "text-[#F5F7F4]/90")}>{rec.note}</p>
            )}
            {rec.history && (
              <p className={cn("text-[11px]", T.muted)}>
                {rec.history.applied
                  ? `Weighed against your Bet Vault (${rec.history.settled} settled picks): confidence and flags reflect your record by market type and league.`
                  : "No settled Bet Vault picks yet — rated on the fixtures alone."}
              </p>
            )}
            {stale && shown.length > 0 && (
              <p className={cn("text-[11px]", T.muted)}>
                Filtered from the last scan ({rec.legs.length} legs) — Generate to scan {windowLabel} in these leagues.
              </p>
            )}
          </div>

          {shown.length > 0 && (mode === "singles" || shown.length < 2) && (
            <div className={cn(T.card, "flex flex-col gap-3 p-4 sm:p-5")}>
              {bankroll.bankroll && !flatStakes ? (
                <p className={cn("text-xs", T.muted)}>
                  Each single is sized by your Kelly setting and caps (Edge tab) ·{" "}
                  <span className="text-white">{formatMoney(singlesTotal)}</span> total
                </p>
              ) : (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <div className="relative sm:w-32">
                    <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#F5F7F4]/50">$</span>
                    <input
                      inputMode="decimal"
                      value={wager}
                      onChange={(e) => setWager(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))}
                      aria-label="Stake on each single, in dollars"
                      className={cn(T.input, "pl-7 tabular-nums")}
                    />
                  </div>
                  <p className={cn("text-[11px]", T.muted)}>
                    {flatStakes
                      ? "Flat stake on each single — Kelly sizing stakes nothing without a price edge, so this mode uses a flat stake."
                      : "Flat stake on each single — set a bankroll in the Edge tab for Kelly-sized stakes."}
                  </p>
                </div>
              )}
              <button
                type="button"
                disabled={!singlesTotal}
                onClick={() => setLogged(onLogSingles(ticket, singleStakes.map((s) => s.amount)))}
                className="font-kalshi-bold flex min-h-12 items-center justify-center gap-2 rounded-xl bg-(--accent) text-sm text-[#050D0A] hover:brightness-110 disabled:opacity-40"
              >
                <Vault className="size-4" /> Log {shown.length} Single{shown.length === 1 ? "" : "s"} to Vault ·{" "}
                {formatMoney(singlesTotal)}
              </button>
              {logged && <p className={cn("text-xs", T.yes)}>{logged}</p>}
              <p className={cn("text-[11px] leading-relaxed", T.muted)}>
                Place each one on Kalshi as a limit order at or below the listed price to skip most of the taker fee.
                Estimates, not guarantees. Bet only what you can afford to lose.
              </p>
            </div>
          )}

          {shown.length >= 2 && mode === "parlay" && (
            <div className={cn(T.card, "flex flex-col gap-3 p-4 sm:p-5")}>
              <button
                type="button"
                onClick={() => parlayTicket && onImport(parlayTicket)}
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
                  onClick={() => parlayTicket && setLogged(onLog(parlayTicket, stake))}
                  className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-[#1E2638] px-4 text-sm font-semibold hover:bg-(--accent-deep) disabled:opacity-40"
                >
                  <Vault className="size-4" /> Log to Vault
                  {stake > 0 &&
                    ` · ${formatMoney(stake)} pays ${formatMoney(
                      stake * parlayLegs.reduce((acc, l) => acc * kalshiDecimal(l.leg.price ?? 50), 1)
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
