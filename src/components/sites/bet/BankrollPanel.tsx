"use client";

import { Wallet } from "lucide-react";
import { useState } from "react";

import { KELLY_OPTIONS, type BankrollSettings } from "@/lib/bet/bankroll";
import { formatMoney } from "@/lib/bet/pnl";
import { cn } from "@/lib/utils";

import { T } from "./theme";

/** Bankroll, Kelly fraction, and the per-bet and daily caps every stake suggestion uses. */
export function BankrollPanel({
  settings,
  exposure,
  onChange,
}: {
  settings: BankrollSettings;
  /** Dollars already staked today. */
  exposure: number;
  onChange: (next: BankrollSettings) => void;
}) {
  const [text, setText] = useState(settings.bankroll ? String(settings.bankroll) : "");
  const cap = settings.bankroll * settings.dailyCapPct;
  const pctInput = (label: string, key: "maxBetPct" | "dailyCapPct", max: number) => (
    <label className="flex flex-col gap-1">
      <span className={T.label}>{label}</span>
      <div className="relative">
        <input
          inputMode="decimal"
          defaultValue={String(Math.round(settings[key] * 1000) / 10)}
          onBlur={(e) => {
            const n = Number(e.target.value);
            if (n > 0 && n <= max) onChange({ ...settings, [key]: n / 100 });
            else e.target.value = String(Math.round(settings[key] * 1000) / 10);
          }}
          className={cn(T.input, "pr-7 tabular-nums")}
        />
        <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-[#F5F7F4]/50">%</span>
      </div>
    </label>
  );

  return (
    <div className={cn(T.card, "flex flex-col gap-4 p-4 sm:p-5")}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-(--accent-deep)">
          <Wallet className="size-5 text-(--accent)" />
        </span>
        <div>
          <h2 className="font-kalshi-bold text-lg">Bankroll &amp; Staking</h2>
          <p className={cn("text-sm", T.muted)}>
            Stakes are sized by fractional Kelly on the probability the app trusts (sharp books when they price the game),
            then capped per bet and per day. Saved in this browser.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <label className="flex flex-col gap-1">
          <span className={T.label}>Bankroll</span>
          <div className="relative">
            <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[#F5F7F4]/50">$</span>
            <input
              inputMode="decimal"
              value={text}
              placeholder="Not set"
              onChange={(e) => {
                const next = e.target.value.replace(/[^\d.]/g, "").slice(0, 10);
                setText(next);
                onChange({ ...settings, bankroll: Math.min(10_000_000, Number(next) || 0) });
              }}
              className={cn(T.input, "pl-7 tabular-nums")}
            />
          </div>
        </label>
        <div className="flex flex-col gap-1">
          <span className={T.label}>Kelly</span>
          <div className="flex h-11 gap-1 rounded-lg border border-[#1E2638] bg-[#050D0A] p-1 sm:h-9">
            {KELLY_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                aria-pressed={settings.kellyFraction === o.value}
                onClick={() => onChange({ ...settings, kellyFraction: o.value })}
                className={cn(
                  "flex-1 rounded-md text-xs font-semibold transition-colors",
                  settings.kellyFraction === o.value ? "bg-(--accent) text-[#050D0A]" : "text-[#F5F7F4]/60 hover:text-white"
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        {pctInput("Max per bet", "maxBetPct", 50)}
        {pctInput("Daily cap", "dailyCapPct", 100)}
      </div>
      {settings.bankroll > 0 ? (
        <p className={cn("text-xs", T.muted)}>
          Today: <span className="font-kalshi-bold text-white">{formatMoney(exposure)}</span> staked of{" "}
          {formatMoney(cap)} cap · {formatMoney(Math.max(0, cap - exposure))} left · max{" "}
          {formatMoney(settings.bankroll * settings.maxBetPct)} a bet
        </p>
      ) : (
        <p className={cn("text-xs", T.muted)}>Set a bankroll to get a suggested stake on every pick.</p>
      )}
    </div>
  );
}
