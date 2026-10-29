import type { Metadata, Viewport } from "next";

import { MeApp } from "@/components/sites/me/MeApp";

import "./me.css";

export const metadata: Metadata = {
  title: " ",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#000000",
};

export default function MePage() {
  return <MeApp />;
}
