import type { Metadata } from "next";

import { BetApp } from "@/components/sites/bet/BetApp";

export const metadata: Metadata = {
  title: "VINDLE BETS",
  description: "Scan a Kalshi slip, measure the edge, and track every pick.",
  robots: { index: false, follow: false },
};

export default function BetPage() {
  return <BetApp />;
}
