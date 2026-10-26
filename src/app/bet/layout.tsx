import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import "./bet.css";

// Fallback for Kalshi Sans: a variable font, so bold (700) and light (300) both render true.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata: Metadata = {
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Vindle" },
  // Next only emits mobile-web-app-capable; iOS Safari still reads the apple- prefixed tag.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#050D0A",
};

export default function BetLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${inter.variable} bet-fonts`}>{children}</div>;
}
