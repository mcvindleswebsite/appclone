import type { Metadata, Viewport } from "next";

import { RoomEditorLoader } from "@/components/sites/room/RoomEditorLoader";

export const metadata: Metadata = {
  title: "Room Editor",
  description: "Interactive 3D model of my room. Drag the furniture around to try new layouts.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#111214",
};

export default function RoomPage() {
  return <RoomEditorLoader />;
}
