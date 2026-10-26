"use client";

import dynamic from "next/dynamic";

// WebGL, canvas textures and localStorage are browser-only, so skip prerendering.
const RoomEditor = dynamic(() => import("./RoomEditor").then((m) => m.RoomEditor), {
  ssr: false,
  loading: () => (
    <div className="fixed inset-0 grid place-items-center bg-[#111214] font-mono text-xs text-white/40">
      Building room…
    </div>
  ),
});

export function RoomEditorLoader() {
  return <RoomEditor />;
}
