// All measurements are in meters, estimated from the three reference photos
// (IMG_7442 window wall, IMG_7443 door/shelf wall, IMG_7444 chalkboard closet).
// World axes: +x = east (closet), -x = west (jersey), -z = north (window), +z = south (door).

export const ROOM = {
  width: 3.3, // west → east
  depth: 3.7, // north → south
  height: 2.44,
} as const;

export const COLORS = {
  wall: "#e7d9b6",
  ceiling: "#efece4",
  trim: "#f4f1ea",
  carpet: "#5b4c3c",
  turf: "#2f5e24",
  curtain: "#3f4a2c",
  blinds: "#d9c7a0",
  windowGlow: "#fff6df",
  darkWood: "#4e2c1e",
  cherryWood: "#5c2a1c",
  comforter: "#cdc2b3",
  sheets: "#a9b7a8",
} as const;

export type FurnitureKind = "bed" | "nightstand" | "desk" | "gamingChair" | "dresser";

export interface FurnitureItem {
  id: string;
  label: string;
  kind: FurnitureKind;
  /** Footprint along the item's local x (w) and z (d), plus height (h). */
  size: { w: number; d: number; h: number };
}

export interface Placement {
  x: number;
  z: number;
  /** Quarter turns counter-clockwise when viewed from above (0–3). */
  turns: number;
}

export type Layout = Record<string, Placement>;

export const FURNITURE: FurnitureItem[] = [
  { id: "bed", label: "Full bed", kind: "bed", size: { w: 1.91, d: 1.37, h: 0.62 } },
  { id: "nightstand", label: "Wood console", kind: "nightstand", size: { w: 1.0, d: 0.35, h: 0.6 } },
  { id: "desk", label: "Desk", kind: "desk", size: { w: 1.2, d: 0.6, h: 0.75 } },
  { id: "gamingChair", label: "Gaming chair", kind: "gamingChair", size: { w: 0.66, d: 0.66, h: 1.28 } },
  { id: "dresser", label: "Cherry dresser", kind: "dresser", size: { w: 0.9, d: 0.48, h: 0.85 } },
];

// Positions as photographed.
export const INITIAL_LAYOUT: Layout = {
  bed: { x: -0.695, z: 1.165, turns: 0 },
  nightstand: { x: -1.475, z: -0.05, turns: 1 },
  desk: { x: -0.05, z: -1.55, turns: 0 },
  gamingChair: { x: -0.1, z: -0.9, turns: 2 },
  dresser: { x: 1.16, z: -1.61, turns: 0 },
};

export const GRID_STEP = 0.1;

/** World-space footprint half extents after rotation. */
export function halfExtents(item: FurnitureItem, turns: number) {
  const swapped = turns % 2 === 1;
  return {
    hx: (swapped ? item.size.d : item.size.w) / 2,
    hz: (swapped ? item.size.w : item.size.d) / 2,
  };
}

/** Snap (optionally) and keep the footprint inside the walls. */
export function constrain(
  item: FurnitureItem,
  x: number,
  z: number,
  turns: number,
  snap: boolean,
): { x: number; z: number } {
  const { hx, hz } = halfExtents(item, turns);
  let nx = snap ? Math.round(x / GRID_STEP) * GRID_STEP : x;
  let nz = snap ? Math.round(z / GRID_STEP) * GRID_STEP : z;
  nx = Math.min(ROOM.width / 2 - hx, Math.max(-ROOM.width / 2 + hx, nx));
  nz = Math.min(ROOM.depth / 2 - hz, Math.max(-ROOM.depth / 2 + hz, nz));
  return { x: nx, z: nz };
}
