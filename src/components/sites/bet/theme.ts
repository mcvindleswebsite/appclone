/**
 * Kalshi brand kit palette, shared across the /bet components. Darkmode green (#00DD94)
 * only ever sits on the dark surfaces below (#050D0A, #121824).
 */
export const T = {
  bg: "bg-[#050D0A]",
  card: "rounded-2xl border border-[#1E2638] bg-[#121824]",
  inset: "rounded-xl border border-[#1E2638] bg-[#050D0A]",
  muted: "text-[#F5F7F4]/60",
  label: "font-kalshi-bold text-[11px] uppercase tracking-[0.08em] text-[#F5F7F4]/60",
  input:
    "w-full rounded-lg border border-[#1E2638] bg-[#050D0A] px-3 py-2 text-sm text-white outline-none transition-colors placeholder:text-[#F5F7F4]/35 focus:border-[#00DD94]/60",
  yes: "text-[#00DD94]",
  no: "text-[#FF3B30]",
  yesBg: "bg-[#00DD94]",
  noBg: "bg-[#FF3B30]",
} as const;
