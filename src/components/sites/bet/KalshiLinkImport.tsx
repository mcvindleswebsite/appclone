"use client";

import { ClipboardPaste, Link2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { isKalshiLink } from "@/lib/bet/kalshi-link";
import { detectSport } from "@/lib/bet/parse-slip";
import { cn } from "@/lib/utils";
import type { BetSlip, KalshiImport, KalshiMarketOption } from "@/types/bet";

import { T } from "./theme";

const DISMISSED_KEY = "mcvindle_bet_clip_dismissed";

const priceOf = (m: KalshiMarketOption) => m.yesAsk ?? m.lastPrice ?? m.yesBid;

const toSlip = (event: KalshiImport, market: KalshiMarketOption): Partial<BetSlip> => ({
  sport: detectSport(`${event.competition} ${event.title} ${event.eventTicker}`),
  matchup: event.title,
  marketTitle: market.title === event.title ? market.title : `${event.title}: ${market.title}`,
  pick: market.pick,
  yesPrice: priceOf(market) ?? 50,
  americanOdds: null,
});

export function KalshiLinkImport({ onImport }: { onImport: (fields: Partial<BetSlip>, label: string) => void }) {
  const [link, setLink] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [event, setEvent] = useState<KalshiImport | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const lastSeen = useRef<string | null>(null);

  const choose = useCallback(
    (data: KalshiImport, market: KalshiMarketOption) => {
      setChosen(market.ticker);
      onImport(toSlip(data, market), `${market.pick} @ ${priceOf(market) ?? "?"}¢`);
    },
    [onImport]
  );

  const importLink = useCallback(
    async (url: string) => {
      setLink(url);
      setError(null);
      setEvent(null);
      setChosen(null);
      setLoading(true);
      lastSeen.current = url;
      try {
        const response = await fetch(`/api/bet/kalshi?url=${encodeURIComponent(url)}`);
        const data = (await response.json()) as KalshiImport | { error: string };
        if ("error" in data) return setError(data.error);
        setEvent(data);
        const markets = data.markets.filter((m) => m.active);
        // Auto-fill when the link named one market, or the event only has one.
        const direct = data.markets.find((m) => m.ticker === data.selected) ?? (markets.length === 1 ? markets[0] : null);
        if (direct) choose(data, direct);
      } catch {
        setError("Couldn't reach Kalshi — try again");
      } finally {
        setLoading(false);
      }
    },
    [choose]
  );

  /**
   * Reads the clipboard. Automatic checks (focus/mount) only raise the banner; a tap on
   * the paste button imports straight away. iOS Safari only allows clipboard reads from a
   * tap, so on iPhone the automatic check is silently denied and the button is the path.
   */
  const checkClipboard = useCallback(
    async (fromTap: boolean) => {
      if (!navigator.clipboard?.readText) {
        if (fromTap) setError("Clipboard isn't available in this browser — paste into the box");
        return;
      }
      try {
        const text = (await navigator.clipboard.readText()).trim();
        if (!isKalshiLink(text)) {
          if (fromTap) setError("No Kalshi link on the clipboard");
          return;
        }
        if (fromTap) return void importLink(text);
        if (text !== lastSeen.current && text !== sessionStorage.getItem(DISMISSED_KEY)) {
          lastSeen.current = text;
          setToast(text);
        }
      } catch {
        if (fromTap) setError("Clipboard access was blocked — paste into the box instead");
      }
    },
    [importLink]
  );

  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    const check = () => {
      if (document.visibilityState === "visible") void checkClipboard(false);
    };
    const boot = setTimeout(check, 400);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearTimeout(boot);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [checkClipboard]);

  const dismissToast = () => {
    if (toast) sessionStorage.setItem(DISMISSED_KEY, toast);
    setToast(null);
  };

  const options = event?.markets.filter((m) => m.active && priceOf(m) !== null).slice(0, 12) ?? [];

  return (
    <>
      {toast && (
        <div
          role="alertdialog"
          aria-label="Kalshi link detected"
          className="bet-toast-in fixed inset-x-0 top-[max(env(safe-area-inset-top),12px)] z-50 mx-auto w-[min(92vw,420px)] overflow-hidden rounded-[22px] border border-[#1E2638] bg-[#121824]/90 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl"
        >
          <div className="flex gap-3 p-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#014737]">
              <Link2 className="size-5 text-[#00DD94]" />
            </span>
            <div className="min-w-0">
              <p className="font-kalshi-bold text-[15px] text-white">Kalshi link detected</p>
              <p className="text-[13px] leading-snug text-[#F5F7F4]/85">
                Kalshi link detected in clipboard. Would you like to import this bet?
              </p>
              <p className="mt-1 truncate text-[11px] text-[#F5F7F4]/50">{toast}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 border-t border-[#1E2638] text-[15px]">
            <button type="button" onClick={dismissToast} className="py-3 text-[#F5F7F4]/70 active:bg-[#1E2638]">
              Dismiss
            </button>
            <button
              type="button"
              onClick={() => {
                const url = toast;
                setToast(null);
                void importLink(url);
              }}
              className="font-kalshi-bold border-l border-[#1E2638] py-3 text-[#00DD94] active:bg-[#1E2638]"
            >
              Import
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (link.trim()) void importLink(link.trim());
          }}
          className="flex gap-2"
        >
          <div className="relative min-w-0 flex-1">
            <Link2 className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#F5F7F4]/35" />
            <input
              type="url"
              inputMode="url"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              placeholder="Paste a kalshi.com market link"
              className={cn(T.input, "pl-9")}
            />
          </div>
          <button
            type="button"
            aria-label="Paste from clipboard"
            onClick={() => void checkClipboard(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#1E2638] px-3 text-xs font-semibold text-white hover:bg-[#014737]"
          >
            <ClipboardPaste className="size-3.5" />
            <span className="hidden sm:inline">Paste</span>
          </button>
          <button
            type="submit"
            disabled={!link.trim() || loading}
            className="font-kalshi-bold flex shrink-0 items-center rounded-lg bg-[#00DD94] px-4 text-xs text-[#050D0A] disabled:opacity-40"
          >
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : "Import"}
          </button>
        </form>

        {error && <p className="text-xs text-[#FF3B30]">{error}</p>}

        {event && (
          <div className={cn(T.inset, "flex flex-col gap-2 p-3")}>
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-kalshi-bold truncate text-sm">{event.title}</p>
              <p className={cn("shrink-0 text-[11px]", T.muted)}>{event.subtitle || event.competition}</p>
            </div>
            {options.length === 0 ? (
              <p className={cn("text-xs", T.muted)}>No open markets with a live price on this event.</p>
            ) : (
              <>
                <p className={cn("text-[11px]", T.muted)}>Pick the YES side to evaluate:</p>
                <div className="grid grid-cols-2 gap-2">
                  {options.map((m) => (
                    <button
                      key={m.ticker}
                      type="button"
                      onClick={() => choose(event, m)}
                      className={cn(
                        "flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
                        chosen === m.ticker
                          ? "border-[#00DD94] bg-[#014737] text-white"
                          : "border-[#1E2638] bg-[#121824] hover:border-[#00DD94]/50"
                      )}
                    >
                      <span className="truncate">{m.pick}</span>
                      <span className="font-kalshi-bold shrink-0 tabular-nums text-[#00DD94]">{priceOf(m)}¢</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </>
  );
}
