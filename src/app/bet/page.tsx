import type { Metadata, Viewport } from "next";

import { BetApp } from "@/components/sites/bet/BetApp";

export const metadata: Metadata = {
  title: "Bet Lab — Kalshi Bet Evaluator",
  description: "Scan a Kalshi slip, measure the edge, and track every pick.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0A0D14",
};

export default function BetPage() {
  return <BetApp />;
}
