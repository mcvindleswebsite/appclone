import { COLORS } from "./roomData";

/** Room elements that are easy to change for real: paint, bedding, curtains, a rug, one piece of furniture. */
export type ColorTarget = "walls" | "bedding" | "curtains" | "rug" | "accent";

export type RoomColors = Record<ColorTarget, string>;

export const COLOR_TARGETS: { id: ColorTarget; label: string; hint?: string }[] = [
  { id: "walls", label: "Walls" },
  { id: "bedding", label: "Bedding" },
  { id: "curtains", label: "Curtains" },
  { id: "rug", label: "Rug", hint: "Add the area rug to see it" },
  { id: "accent", label: "Accent furniture", hint: "Wood console" },
];

/** The colors as photographed. */
export const DEFAULT_COLORS: RoomColors = {
  walls: COLORS.wall,
  bedding: COLORS.comforter,
  curtains: COLORS.curtain,
  rug: COLORS.sand,
  accent: COLORS.darkWood,
};

export const EARTH_SWATCHES: { name: string; hex: string }[] = [
  { name: "Forest green", hex: "#2f4a36" },
  { name: "Sage green", hex: "#9caf88" },
  { name: "Terracotta", hex: "#b4623f" },
  { name: "Muted mocha", hex: "#6e5443" },
  { name: "Cream", hex: "#ede4d0" },
  { name: "Soft charcoal", hex: "#46484b" },
];

export const amazonSearchUrl = (itemTitle: string) =>
  `https://www.amazon.com/s?k=${encodeURIComponent(itemTitle + " earth tone")}`;
