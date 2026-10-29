"use client";

import { ArrowRightLeft, BellRing } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";
import type { BetLeg, PriceGap } from "@/types/bet";

import { FotmobLink } from "./FotmobLink";
import { T } from "./theme";

export const GAP_ALERTS_STORAGE = "mcvindle_bet_gap_alerts";
/** Matches the server's odds cache, so polls never cost more than one refresh each. */
const POLL_MS = 15 * 60 * 1000;

export interface GapState {
  gaps: PriceGap[];
  /** False when ODDS_API_KEY isn't set on the server. */
  configured: boolean | null;
  checkedAt: number | null;
  error: string | null;
}

/**
 * Price-gap alerts while the page is open: polls every 15 minutes when the tab is visible,
 * and raises a browser notification (if allowed) for each newly seen gap.
 */
export function usePriceGaps(accessKey: string, enabled: boolean) {
  const [state, setState] = useState<GapState>({ gaps: [], configured: null, checkedAt: null, error: null });
  const seen = useRef(new Set<string>());

  const check = useCallback(async () => {
    if (!accessKey) return;
    try {
      const response = await fetch("/api/bet/gaps", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-bet-key": accessKey },
        body: "{}",
      });
      const data = (await response.json()) as { configured?: boolean; gaps?: PriceGap[]; error?: string };
      if (data.error) {
        setState((s) => ({ ...s, error: data.error!, checkedAt: Date.now() }));
        return;
      }
      const gaps = data.gaps ?? [];
      const fresh = gaps.filter((g) => g.leg.ticker && !seen.current.has(g.leg.ticker));
      fresh.forEach((g) => seen.current.add(g.leg.ticker!));
      if (fresh.length && typeof Notification !== "undefined" && Notification.permission === "granted") {
        const top = fresh[0];
        new Notification(`Kalshi is ${(top.sharp.edge * 100).toFixed(1)} pts cheap`, {
          body: `${top.leg.pick} (${top.leg.matchup}) at ${top.ask}¢ vs ${Math.round(top.sharp.fair * 100)}% fair at ${top.sharp.source}${
            fresh.length > 1 ? ` · +${fresh.length - 1} more` : ""
          }`,
          tag: "vindle-gaps",
        });
      }
      setState({ gaps, configured: data.configured ?? null, checkedAt: Date.now(), error: null });
    } catch {
      setState((s) => ({ ...s, error: "Couldn't check prices", checkedAt: Date.now() }));
    }
  }, [accessKey]);

  useEffect(() => {
    if (!enabled || !accessKey) return;
    const tick = () => {
      if (document.visibilityState === "visible") void check();
    };
    const first = setTimeout(tick, 500);
    const timer = setInterval(tick, POLL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, accessKey, check]);

  return { ...state, check };
}

const kickoff = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { weekday: "short", hour: "numeric", minute: "2-digit" });

/** The Top Picks card listing live gaps, with the on/off switch. */
export function PriceGapList({
  state,
  enabled,
  onToggle,
  onEvaluate,
}: {
  state: GapState;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  onEvaluate: (leg: BetLeg) => void;
}) {
  return (
    <div className={cn(T.card, "flex flex-col gap-3 p-4 sm:p-5")}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--accent-deep)">
          <BellRing className="size-5 text-(--accent)" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-kalshi-bold text-lg">Price-Gap Alerts</h2>
          <p className={cn("text-sm", T.muted)}>
            Matches in the next 3 days where Kalshi is at least 2 pts cheaper than the sharp books after fees — usually
            Kalshi lagging a line move. Checked every 15 minutes while this page is open.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => {
            const next = !enabled;
            if (next && typeof Notification !== "undefined" && Notification.permission === "default") {
              void Notification.requestPermission();
            }
            onToggle(next);
          }}
          className={cn(
            "relative h-6 w-11 shrink-0 rounded-full transition-colors",
            enabled ? "bg-(--accent)" : "bg-[#1E2638]"
          )}
        >
          <span className="sr-only">Price-gap alerts</span>
          <span
            className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform", enabled && "translate-x-5")}
          />
        </button>
      </div>
      {enabled && state.configured === false && (
        <p className="text-xs text-[#FF3B30]">Needs ODDS_API_KEY on the server (free at the-odds-api.com).</p>
      )}
      {enabled && state.error && <p className="text-xs text-[#FF3B30]">{state.error}</p>}
      {enabled && state.configured && state.gaps.length === 0 && (
        <p className={cn("text-xs", T.muted)}>No gaps right now — Kalshi is in line with the books.</p>
      )}
      {enabled && state.gaps.length > 0 && (
        <ul className="flex flex-col divide-y divide-[#1E2638] overflow-hidden rounded-xl border border-[#1E2638]">
          {state.gaps.map((g) => (
            <li key={g.leg.ticker} className="flex items-center gap-3 bg-[#050D0A] p-3">
              <div className="min-w-0 flex-1">
                <p className="font-kalshi-bold truncate text-sm">{g.leg.pick}</p>
                <p className={cn("truncate text-[11px]", T.muted)}>
                  {g.leg.matchup} · {g.league} · {kickoff(g.kickoffTime)}
                </p>
                <p className="text-[11px] tabular-nums text-[#F5F7F4]/70">
                  Kalshi {g.ask}¢ · {g.sharp.source} {Math.round(g.sharp.fair * 100)}% fair
                </p>
              </div>
              <span className="font-kalshi-bold shrink-0 rounded-full border border-(--accent)/50 bg-(--accent-deep) px-2 py-0.5 text-[10px] text-(--accent)">
                +{(g.sharp.edge * 100).toFixed(1)} pts
              </span>
              <FotmobLink matchup={g.leg.matchup} kickoff={g.kickoffTime} />
              <button
                type="button"
                aria-label={`Evaluate ${g.leg.pick}`}
                onClick={() => onEvaluate(g.leg)}
                className="flex min-h-9 shrink-0 items-center gap-1 rounded-lg bg-[#1E2638] px-2.5 text-xs font-semibold hover:bg-(--accent-deep)"
              >
                <ArrowRightLeft className="size-3.5" /> Evaluate
              </button>
            </li>
          ))}
        </ul>
      )}
      {enabled && state.checkedAt && (
        <p className={cn("text-[11px]", T.muted)}>
          Last checked {new Date(state.checkedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
        </p>
      )}
    </div>
  );
}
