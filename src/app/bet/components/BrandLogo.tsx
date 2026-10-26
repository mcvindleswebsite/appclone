import { cn } from "@/lib/utils";

/**
 * MCVINDLE BETS sub-brand lockup. Clearspace is two stem widths on every side
 * (a bold stem is ~0.12em, so 0.24em of padding), scaling with the font size.
 * Never skew, stretch, or shadow the lockup.
 */
export function BrandLogo({ className }: { className?: string }) {
  return (
    <span
      aria-label="MCVINDLE BETS"
      className={cn("inline-flex items-baseline gap-[0.22em] p-[0.24em] leading-none uppercase select-none", className)}
    >
      <span className="font-kalshi-bold tracking-[0.02em] text-[#FFFFFF]">Mcvindle</span>
      <span className="font-kalshi-light tracking-[0.06em] text-(--accent)">Bets</span>
    </span>
  );
}
