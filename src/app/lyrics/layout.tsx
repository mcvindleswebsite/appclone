import type { Viewport } from "next";

import "./lyrics.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // The title bar's silver in light mode, the Black finish in dark mode.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#feffff" },
    { media: "(prefers-color-scheme: dark)", color: "#232527" },
  ],
};

export default function LyricsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
