"use client";

import { ChevronDown, Clock, Link2, Loader2, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { RISK_PROFILES } from "@/lib/bet/engine";
import { buildInsights, historyContext, legTally, slipLabel, sportsOf } from "@/lib/bet/history";
import { DEFAULT_WAGER, formatMoney, profitSummary } from "@/lib/bet/pnl";
import { legTiming, slipTiming, timingTickers, type LegTiming, type SlipTiming } from "@/lib/bet/timing";
import { cn } from "@/lib/utils";
import type { BetLeg, BetRecord, LegResult, Outcome } from "@/types/bet";

import { T } from "./theme";

const FILTERS = ["ALL", "PENDING", "WIN", "LOSS"] as const;

/** How often an open Vault re-checks pending picks against Kalshi. */
const AUTO_SYNC_MS = 2 * 60 * 1000;

/** Leg results are data, not accents: always green for a hit and red for a miss. */
const LEG_RESULT_STYLES: Record<LegResult, string> = {
  WIN: "font-kalshi-bold text-[#00DD94]",
  LOSS: "font-kalshi-bold text-[#FF3B30]",
  PENDING: "text-[#F5F7F4]/60",
  VOID: "text-[#F5F7F4]/35 line-through",
};

/** Only open legs show a price; a settled contract's 99¢/1¢ is noise (older saves still carry it). */
const openPrice = (leg: BetLeg) => (leg.price && (!leg.result || leg.result === "PENDING") ? leg.price : null);

const LEG_RESULT_MARK: Record<LegResult, string> = { WIN: "✓", LOSS: "✕", PENDING: "•", VOID: "–" };

const OUTCOME_STYLES: Record<Outcome, string> = {
  WIN: "bg-[#00DD94] text-[#050D0A]",
  LOSS: "bg-[#FF3B30] text-white",
  PENDING: "bg-[#1E2638] text-white",
};

/** Clock time, with the day when it isn't today. */
const clockTime = (ms: number, now: number) => {
  const d = new Date(ms);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date(now).toDateString()) return time;
  if (d.toDateString() === new Date(now + 86_400_000).toDateString()) return `tomorrow ${time}`;
  return `${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}, ${time}`;
};

/** "2h 15m", "45m", or "3d 4h" for far-off games. */
const duration = (ms: number) => {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  const h = Math.floor(minutes / 60);
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
  return h ? `${h}h ${minutes % 60}m` : `${minutes}m`;
};

/** Live countdown, ticking by the second: 1:23:45 or 23:45. */
const countdown = (ms: number) => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const mm = String(Math.floor((total % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(total % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};

/** When a pending parlay's last game should wrap up: upcoming, a live countdown, or due. */
function CompletionBadge({ timing, now }: { timing: SlipTiming; now: number }) {
  const partial = timing.known < timing.total ? ` · ${timing.known}/${timing.total} legs timed` : "";
  if (now < timing.startsAt) {
    return (
      <div className="rounded-xl border border-[#00DD94]/25 bg-[#050D0A] px-3 py-2 md:text-right">
        <p className="font-kalshi-bold flex items-center gap-1.5 text-[11px] text-[#00DD94] md:justify-end">
          <Clock className="size-3.5" /> All games finish ~{clockTime(timing.endsAt, now)}
        </p>
        <p className={cn("mt-0.5 text-[10px] tabular-nums", T.muted)}>
          First game {clockTime(timing.startsAt, now)} · done in {duration(timing.endsAt - now)}
          {partial}
        </p>
      </div>
    );
  }
  if (now < timing.endsAt) {
    return (
      <div className="rounded-xl border border-[#00DD94]/40 bg-[#050D0A] px-3 py-2 md:text-right">
        <p className="font-kalshi-bold flex items-center gap-1.5 text-[11px] text-[#00DD94] md:justify-end">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#00DD94] opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-[#00DD94]" />
          </span>
          LIVE · Final in
          <span className="font-kalshi-condensed text-base leading-none tabular-nums text-white">
            {countdown(timing.endsAt - now)}
          </span>
        </p>
        <p className={cn("mt-0.5 text-[10px] tabular-nums", T.muted)}>
          Last game ends ~{clockTime(timing.endsAt, now)} · check back then
          {partial}
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-xl border border-[#1E2638] bg-[#050D0A] px-3 py-2 md:text-right">
      <p className="font-kalshi-bold flex items-center gap-1.5 text-[11px] text-[#F5F7F4]/85 md:justify-end">
        <Clock className="size-3.5 text-[#00DD94]" /> Games should be final
      </p>
      <p className={cn("mt-0.5 text-[10px]", T.muted)}>Ended ~{clockTime(timing.endsAt, now)} · waiting on Kalshi to settle</p>
    </div>
  );
}

/** An open leg's own finish time in the expanded leg list. */
function LegFinish({ leg, live, now }: { leg: BetLeg; live: Record<string, LegTiming>; now: number }) {
  if (leg.result && leg.result !== "PENDING") return null;
  const t = (leg.ticker && live[leg.ticker]) || legTiming(leg);
  if (!t) return null;
  const end = Date.parse(t.endsAt);
  const playing = now >= Date.parse(t.startsAt) && now < end;
  return (
    <span className={cn("shrink-0 tabular-nums", playing ? "text-[#00DD94]" : "opacity-60")}>
      {now >= end ? "final soon" : `${playing ? "live · " : ""}ends ~${clockTime(end, now)}`}
    </span>
  );
}

const verdictColor = (verdict: string) =>
  /^(BUY YES|PLAY)/.test(verdict) ? T.yes : verdict.startsWith("BUY NO") ? T.no : T.muted;

/** The vault's link bar: logs a bet already placed on Kalshi, settled or still open. */
function QuickAdd({
  onQuickAdd,
}: {
  onQuickAdd: (links: string, paidCents: number | null, wager: number) => Promise<string>;
}) {
  const [links, setLinks] = useState("");
  const [paid, setPaid] = useState("");
  const [wager, setWager] = useState(String(DEFAULT_WAGER));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const submit = async () => {
    if (!links.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const n = Number(paid);
      setMessage({ text: await onQuickAdd(links.trim(), n >= 1 && n <= 99 ? n : null, Number(wager) || 0), ok: true });
      setLinks("");
      setPaid("");
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : "Couldn't add that bet", ok: false });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cn(T.card, "flex flex-col gap-2 p-4")}>
      <p className={T.label}>Quick Add Past Bet</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-2 sm:flex-row"
      >
        <div className="relative min-w-0 flex-1">
          <Link2 className="pointer-events-none absolute top-3.5 left-3 size-4 text-[#F5F7F4]/35 sm:top-2.5" />
          <textarea
            rows={links.includes("\n") ? 3 : 1}
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            placeholder="Kalshi link you bet on"
            className={cn(T.input, "resize-none pl-9")}
          />
        </div>
        <input
          inputMode="numeric"
          value={paid}
          onChange={(e) => setPaid(e.target.value.replace(/\D/g, "").slice(0, 2))}
          placeholder="Paid ¢"
          aria-label="Price you paid, in cents"
          className={cn(T.input, "sm:w-24")}
        />
        <div className="relative sm:w-28">
          <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#F5F7F4]/50">$</span>
          <input
            inputMode="decimal"
            value={wager}
            onChange={(e) => setWager(e.target.value.replace(/[^\d.]/g, "").slice(0, 9))}
            placeholder="Stake"
            aria-label="Overall wager on the ticket, in dollars"
            className={cn(T.input, "pl-7 tabular-nums")}
          />
        </div>
        <button
          type="submit"
          disabled={busy || !links.trim()}
          className="font-kalshi-bold flex min-h-11 items-center justify-center gap-1.5 rounded-lg bg-(--accent) px-4 text-sm text-[#050D0A] disabled:opacity-40 sm:min-h-9 sm:text-xs"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />} Add to Vault
        </button>
      </form>
      {message && <p className={cn("text-xs", message.ok ? T.yes : T.no)}>{message.text}</p>}
    </div>
  );
}

export function BetVault({
  records,
  onOutcome,
  onDelete,
  onQuickAdd,
  onRefresh,
}: {
  records: BetRecord[];
  onOutcome: (id: string, outcome: Outcome) => void;
  onDelete: (id: string) => void;
  onQuickAdd: (links: string, paidCents: number | null, wager: number) => Promise<string>;
  onRefresh: () => Promise<string>;
}) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("ALL");
  const [refreshing, setRefreshing] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const [refreshNote, setRefreshNote] = useState<string | null>(null);
  const insights = buildInsights(records);
  const { roi } = historyContext(records);
  const money = profitSummary(records);
  const settled = insights.record.wins + insights.record.losses;
  const refreshable = records.some((r) => r.outcome === "PENDING" && (r.slip.comboTicker || r.slip.legs.some((l) => l.ticker)));

  const [lastSync, setLastSync] = useState<string | null>(null);
  const busy = useRef(false);

  // Game timing for pending picks, fetched fresh from Kalshi (start times can move);
  // timing saved on legs at import fills in until it arrives.
  const [liveTiming, setLiveTiming] = useState<Record<string, LegTiming>>({});
  const tickerKey = timingTickers(records).slice(0, 60).sort().join(",");
  useEffect(() => {
    if (!tickerKey) return;
    let cancelled = false;
    fetch("/api/vault/timing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: tickerKey.split(",") }),
    })
      .then((response) => (response.ok ? (response.json() as Promise<{ timing?: Record<string, LegTiming> }>) : null))
      .then((data) => {
        if (!cancelled && data?.timing) setLiveTiming((prev) => ({ ...prev, ...data.timing }));
      })
      .catch(() => {
        // Badges fall back to timing saved on the legs.
      });
    return () => {
      cancelled = true;
    };
  }, [tickerKey]);

  const [now, setNow] = useState(() => Date.now());
  const timings = new Map(
    records.flatMap((r) => {
      const t = r.outcome === "PENDING" ? slipTiming(r, liveTiming) : null;
      return t ? [[r.id, t] as const] : [];
    })
  );
  const anyLive = [...timings.values()].some((t) => now >= t.startsAt && now < t.endsAt);
  // Tick every second while a countdown is on screen, otherwise every half minute.
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), anyLive ? 1000 : 30_000);
    return () => clearInterval(timer);
  }, [anyLive]);

  const refresh = useCallback(
    async (quiet = false) => {
      if (busy.current) return;
      busy.current = true;
      if (!quiet) setRefreshing(true);
      const note = await onRefresh();
      // Auto-polls only speak up when something actually changed.
      if (!quiet || !note.startsWith("Nothing")) setRefreshNote(note);
      setLastSync(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
      setRefreshing(false);
      busy.current = false;
    },
    [onRefresh]
  );

  // Live games: while the Vault is open and on screen, re-check pending picks every 2 minutes.
  const latestRefresh = useRef(refresh);
  useEffect(() => {
    latestRefresh.current = refresh;
  });
  useEffect(() => {
    if (!refreshable) return;
    const tick = () => {
      if (document.visibilityState === "visible") void latestRefresh.current(true);
    };
    const first = setTimeout(tick, 1500);
    const timer = setInterval(tick, AUTO_SYNC_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [refreshable]);
  const shown = filter === "ALL" ? records : records.filter((r) => r.outcome === filter);

  return (
    <div className="flex flex-col gap-4">
      <QuickAdd onQuickAdd={onQuickAdd} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          {
            label: "Total P/L",
            value: money.staked ? formatMoney(money.profit, true) : "—",
            sub: money.staked ? `on ${formatMoney(money.staked)} staked` : "No settled stakes yet",
            tone: money.staked ? (money.profit >= 0 ? "text-[#00DD94]" : "text-[#FF3B30]") : undefined,
          },
          {
            label: "Hit Rate",
            value: settled ? `${Math.round((insights.record.wins / settled) * 100)}%` : "—",
            sub: `${insights.record.wins}-${insights.record.losses} · ${insights.record.pending} pending`,
          },
          {
            label: "ROI / Unit",
            value: roi === null ? "—" : `${roi >= 0 ? "+" : ""}${(roi * 100).toFixed(1)}%`,
            sub: "Flat 1-unit stakes",
          },
          {
            label: "Dollar ROI",
            value: money.roi === null ? "—" : `${money.roi >= 0 ? "+" : ""}${(money.roi * 100).toFixed(1)}%`,
            sub: `${money.picks} staked pick${money.picks === 1 ? "" : "s"} settled`,
          },
        ].map((stat) => (
          <div key={stat.label} className={cn(T.card, "p-4")}>
            <p className={T.label}>{stat.label}</p>
            <p className={cn("font-kalshi-condensed mt-1 text-3xl tabular-nums", stat.tone)}>{stat.value}</p>
            <p className={cn("mt-0.5 text-[11px]", T.muted)}>{stat.sub}</p>
          </div>
        ))}
      </div>

      {insights.sports.length > 0 && (
        <div className={cn(T.card, "flex flex-wrap gap-2 p-4")}>
          <span className={cn(T.label, "mr-2 self-center")}>Memory</span>
          {insights.sports.map((s) => (
            <span key={s.sport} className="rounded-full bg-[#1E2638] px-3 py-1 text-xs">
              {s.sport} <span className={T.muted}>· {s.count} picks · {s.wins}-{s.losses}</span>
            </span>
          ))}
          {insights.byRisk
            .filter((r) => r.wins + r.losses > 0)
            .map((r) => (
              <span key={r.risk} className="rounded-full bg-[#1E2638] px-3 py-1 text-xs">
                Risk {r.risk} <span className={T.muted}>· {r.wins}-{r.losses}</span>
              </span>
            ))}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-full bg-[#121824] p-1">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors",
                filter === f ? "bg-white text-[#050D0A]" : "text-[#F5F7F4]/60 hover:text-white"
              )}
            >
              {f === "ALL" ? "All" : f[0] + f.slice(1).toLowerCase()}
              {f === "PENDING" && insights.record.pending ? ` · ${insights.record.pending}` : ""}
            </button>
          ))}
        </div>
        {refreshable && (
          <button
            type="button"
            disabled={refreshing}
            onClick={() => void refresh()}
            className="flex min-h-9 items-center gap-1.5 rounded-full bg-[#121824] px-4 text-xs font-semibold text-[#F5F7F4]/85 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={cn("size-3.5", refreshing && "animate-spin")} /> Sync Results
          </button>
        )}
        {refreshable && (
          <span className={cn("text-[11px]", T.muted)}>
            Auto-sync every 2 min{lastSync ? ` · last ${lastSync}` : ""}
          </span>
        )}
        {refreshNote && <span className={cn("text-xs", T.muted)}>{refreshNote}</span>}
      </div>

      {shown.length === 0 ? (
        <div className={cn(T.card, "p-10 text-center text-sm", T.muted)}>
          {records.length === 0 ? "No picks yet — evaluate a slip and it lands here." : "Nothing in this filter."}
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {shown.map((r) => {
            const tally = legTally(r.slip);
            const multi = r.slip.legs.length > 1;
            const open = expanded.has(r.id);
            return (
              <li key={r.id} className={cn(T.card, "flex flex-col gap-3 p-4 md:flex-row md:items-start")}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded bg-[#1E2638] px-2 py-0.5 font-semibold">{sportsOf(r).join(" · ")}</span>
                    <span className={T.muted}>
                      {new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    <span className={T.muted}>
                      · Risk {r.risk} {RISK_PROFILES[r.risk].label}
                    </span>
                    {r.ai && <span className="rounded bg-(--accent-deep) px-1.5 py-0.5 text-(--accent)">AI</span>}
                    {r.imported && <span className="rounded bg-[#1E2638] px-1.5 py-0.5">Logged from Kalshi</span>}
                  </div>
                  <p className="font-kalshi-bold mt-1.5 truncate">{slipLabel(r.slip)}</p>
                  {!multi ? (
                    <p className={cn("truncate text-xs", r.slip.legs[0].result ? LEG_RESULT_STYLES[r.slip.legs[0].result] : T.muted)}>
                      {r.slip.legs[0].matchup}
                      {r.slip.legs[0].pick && ` · ${r.slip.legs[0].pick}`}
                        {openPrice(r.slip.legs[0]) && ` @ ${openPrice(r.slip.legs[0])}¢`}
                    </p>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => toggle(r.id)}
                        aria-expanded={open}
                        className="mt-1 flex items-center gap-2 text-xs"
                      >
                        {tally ? (
                          <span className="font-kalshi-bold">
                            <span className={tally.hit === tally.total ? "text-[#00DD94]" : tally.hit < tally.settled ? "text-[#FF3B30]" : ""}>
                              {tally.hit}/{tally.total} Legs Hit
                            </span>
                            {tally.settled < tally.total && <span className={T.muted}> · {tally.total - tally.settled} pending</span>}
                          </span>
                        ) : (
                          <span className={T.muted}>{r.slip.legs.length} legs · not settled</span>
                        )}
                        <ChevronDown className={cn("size-3.5 text-[#F5F7F4]/60 transition-transform", open && "rotate-180")} />
                      </button>
                      {open && (
                        <ol className="mt-2 flex flex-col gap-1 rounded-lg border border-[#1E2638] bg-[#050D0A] p-2 text-xs">
                          {r.slip.legs.map((leg, i) => (
                            <li key={i} className={cn("flex gap-2", leg.result ? LEG_RESULT_STYLES[leg.result] : "text-[#F5F7F4]/70")}>
                              <span className="w-4 shrink-0 text-center">{leg.result ? LEG_RESULT_MARK[leg.result] : `${i + 1}`}</span>
                              <span className="min-w-0 flex-1 truncate">{leg.market || leg.pick}</span>
                              <LegFinish leg={leg} live={liveTiming} now={now} />
                              {openPrice(leg) && <span className="shrink-0 tabular-nums opacity-70">{openPrice(leg)}¢</span>}
                            </li>
                          ))}
                        </ol>
                      )}
                    </>
                  )}
                  <p className="mt-2 text-xs leading-relaxed text-[#F5F7F4]/85">{r.summary}</p>
                </div>

                <div className="flex shrink-0 flex-row flex-wrap items-center justify-between gap-3 md:flex-col md:items-end">
                  {timings.has(r.id) && (
                    <div className="w-full md:w-auto">
                      <CompletionBadge timing={timings.get(r.id)!} now={now} />
                    </div>
                  )}
                  <div className="text-right">
                    <p className={cn("font-kalshi-bold text-sm", verdictColor(r.verdict))}>{r.verdict}</p>
                    {r.wager ? (
                      <p className="text-[11px] tabular-nums">
                        <span className={T.muted}>
                          {formatMoney(r.wager)}
                          {r.potentialPayout ? ` → ${formatMoney(r.potentialPayout)}` : ""}
                        </span>
                        {r.netProfit !== null && r.netProfit !== undefined && (
                          <span className={cn("font-kalshi-bold ml-1.5", r.netProfit >= 0 ? "text-[#00DD94]" : "text-[#FF3B30]")}>
                            {formatMoney(r.netProfit, true)}
                          </span>
                        )}
                      </p>
                    ) : null}
                    {!r.imported && (
                      <p className={cn("text-[11px] tabular-nums", T.muted)}>
                        {(r.probability * 100).toFixed(r.probability < 0.1 ? 1 : 0)}% · {r.edge >= 0 ? "+" : ""}
                        {(r.edge * 100).toFixed(1)}
                        {r.slip.legs.length > 1 ? "% EV" : " pts"}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {(["WIN", "LOSS", "PENDING"] as Outcome[]).map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => onOutcome(r.id, o)}
                        className={cn(
                          "rounded-md px-2.5 py-1 text-[11px] font-bold transition-colors",
                          r.outcome === o ? OUTCOME_STYLES[o] : "bg-[#050D0A] text-[#F5F7F4]/35 hover:text-white"
                        )}
                      >
                        {o}
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-label="Delete pick"
                      onClick={() => onDelete(r.id)}
                      className="ml-1 rounded-md p-1.5 text-[#F5F7F4]/35 hover:bg-[#FF3B30]/10 hover:text-[#FF3B30]"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
