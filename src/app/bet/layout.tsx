import { Inter } from "next/font/google";

import "./bet.css";

// Fallback for Kalshi Sans: a variable font, so bold (700) and light (300) both render true.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export default function BetLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${inter.variable} bet-fonts`}>{children}</div>;
}
