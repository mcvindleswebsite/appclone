import type { Metadata, Viewport } from "next";

import { DropMonitor } from "@/components/sites/pokemon/DropMonitor";

export const metadata: Metadata = {
  title: "Pokémon Drop Monitor",
  description: "Adaptive countdown and stock monitor for Pokémon Center drops.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0b",
};

export default function PokemonPage() {
  return <DropMonitor />;
}
