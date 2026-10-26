/**
 * Kalshi brand kit palette, shared across the /bet components. The accent is a CSS variable
 * (see bet.css): darkmode green #00DD94 while the access key works, red #FF3B30 when it's
 * missing or broken. It only ever sits on the dark surfaces below (#050D0A, #121824).
 */
export const T = {
  bg: "bg-[#050D0A]",
  card: "rounded-2xl border border-[#1E2638] bg-[#121824]",
  inset: "rounded-xl border border-[#1E2638] bg-[#050D0A]",
  muted: "text-[#F5F7F4]/60",
  label: "font-kalshi-bold text-[11px] uppercase tracking-[0.08em] text-[#F5F7F4]/60",
  input:
    "min-h-11 w-full min-w-0 rounded-lg border border-[#1E2638] bg-[#050D0A] px-3 py-2 text-base text-white sm:min-h-9 sm:text-sm outline-none transition-colors placeholder:text-[#F5F7F4]/35 focus:border-(--accent)/60",
  yes: "text-(--accent)",
  no: "text-[#FF3B30]",
  yesBg: "bg-(--accent)",
  noBg: "bg-[#FF3B30]",
} as const;
