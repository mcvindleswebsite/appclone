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
  navy: "#273a6b",
  bocaGold: "#f2b630",
  bocaNavy: "#1f3a86",
  sand: "#cbb994",
} as const;

export type FurnitureKind =
  | "bed"
  | "nightstand"
  | "desk"
  | "gamingChair"
  | "dresser"
  | "floorLamp"
  | "acousticGuitar"
  | "electricGuitar"
  | "areaRug"
  | "uplight";

/** A side of an item in its local frame (front = +z, except the bed whose head is −x). */
export type Side = "+x" | "-x" | "+z" | "-z";

export interface DesignSpec {
  /** Anchors are placed first by the optimizer; companions follow their anchor; accents fill in. */
  role: "anchor" | "companion" | "accent";
  /** Side that belongs flush against a wall (headboard, desk back, dresser back). */
  wallSide?: Side;
  /** Floor space needed to use the piece. With mode "any", one clear side is enough. */
  access?: { sides: Side[]; depth: number; mode: "all" | "any"; label: string; trimFromWall?: number };
  /** Piece this one pairs with (the chair tucks into the desk's access zone). */
  companionOf?: string;
  /** Flat on the floor: not an obstacle for walking. */
  flat?: boolean;
  /** Which band of the 60-30-10 palette this piece contributes to. */
  palette: "base" | "secondary" | "accent";
}

export interface FurnitureItem {
  id: string;
  label: string;
  kind: FurnitureKind;
  /** Footprint along the item's local x (w) and z (d), plus height (h). */
  size: { w: number; d: number; h: number };
  design: DesignSpec;
}

export interface Placement {
  x: number;
  z: number;
  /** Quarter turns counter-clockwise when viewed from above (0–3). */
  turns: number;
}

export type Layout = Record<string, Placement>;

/** 30 inches, the standard minimum walkway. */
export const WALK_CLEARANCE = 0.76;

export const FURNITURE: FurnitureItem[] = [
  {
    id: "bed",
    label: "Full bed",
    kind: "bed",
    size: { w: 1.91, d: 1.37, h: 0.62 },
    design: {
      role: "anchor",
      wallSide: "-x",
      // The first 50 cm beside the headboard is nightstand territory, not walkway.
      access: { sides: ["+z", "-z"], depth: 0.6, mode: "any", label: "60 cm along one side of the bed", trimFromWall: 0.5 },
      palette: "secondary",
    },
  },
  {
    id: "desk",
    label: "Desk",
    kind: "desk",
    size: { w: 1.2, d: 0.6, h: 0.75 },
    design: {
      role: "anchor",
      wallSide: "-z",
      access: { sides: ["+z"], depth: WALK_CLEARANCE, mode: "all", label: "76 cm to pull the chair out" },
      palette: "secondary",
    },
  },
  {
    id: "dresser",
    label: "Cherry dresser",
    kind: "dresser",
    size: { w: 0.9, d: 0.48, h: 0.85 },
    design: {
      role: "anchor",
      wallSide: "-z",
      access: { sides: ["+z"], depth: WALK_CLEARANCE, mode: "all", label: "76 cm to open the drawers" },
      palette: "secondary",
    },
  },
  {
    id: "nightstand",
    label: "Wood console",
    kind: "nightstand",
    size: { w: 1.0, d: 0.35, h: 0.6 },
    design: {
      role: "anchor",
      wallSide: "-z",
      access: { sides: ["+z"], depth: 0.45, mode: "all", label: "45 cm in front of the console" },
      palette: "secondary",
    },
  },
  {
    id: "gamingChair",
    label: "Gaming chair",
    kind: "gamingChair",
    size: { w: 0.66, d: 0.66, h: 1.28 },
    design: { role: "companion", companionOf: "desk", palette: "secondary" },
  },
  {
    id: "floorLamp",
    label: "Floor lamp",
    kind: "floorLamp",
    size: { w: 0.3, d: 0.3, h: 1.7 },
    design: { role: "accent", palette: "accent" },
  },
  {
    id: "acousticGuitar",
    label: "Red acoustic guitar",
    kind: "acousticGuitar",
    size: { w: 0.38, d: 0.26, h: 1.0 },
    design: { role: "accent", wallSide: "-z", palette: "accent" },
  },
  {
    id: "electricGuitar",
    label: "Electric guitar",
    kind: "electricGuitar",
    size: { w: 0.33, d: 0.24, h: 0.98 },
    design: { role: "accent", wallSide: "-z", palette: "accent" },
  },
];

// Standard rug sizes (m). Pick the largest that leaves a 30 cm floor border.
const RUG_SIZES: [number, number][] = [
  [1.8, 2.7],
  [1.5, 2.1],
  [1.2, 1.8],
];
const RUG = RUG_SIZES.find(([w, l]) => l <= ROOM.depth - 0.6 && w <= ROOM.width - 0.6 && l <= ROOM.width - 0.6) ?? RUG_SIZES[2];

/** Suggested additions: hidden until the user adds them from the design panel. */
export const ADDITIONS: FurnitureItem[] = [
  {
    id: "areaRug",
    label: "Sand wool area rug",
    kind: "areaRug",
    size: { w: RUG[1], d: RUG[0], h: 0.012 },
    design: { role: "accent", flat: true, palette: "secondary" },
  },
  {
    id: "uplight",
    label: "Corner uplight",
    kind: "uplight",
    size: { w: 0.26, d: 0.26, h: 1.5 },
    design: { role: "accent", palette: "accent" },
  },
];

export const ALL_ITEMS = [...FURNITURE, ...ADDITIONS];

// Positions as photographed.
export const INITIAL_LAYOUT: Layout = {
  bed: { x: -0.695, z: 1.165, turns: 0 },
  nightstand: { x: -1.475, z: -0.05, turns: 1 },
  desk: { x: -0.05, z: -1.55, turns: 0 },
  gamingChair: { x: -0.1, z: -0.9, turns: 2 },
  dresser: { x: 1.16, z: -1.61, turns: 0 },
  floorLamp: { x: -0.95, z: -1.5, turns: 0 },
  acousticGuitar: { x: 0.82, z: -1.2, turns: 0 },
  electricGuitar: { x: 1.3, z: -1.22, turns: 0 },
};

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const HW = ROOM.width / 2;
const HD = ROOM.depth / 2;

/** Fixed architectural zones the engine keeps clear. */
export const ZONES = {
  /** Entry door (south wall), hinged on its east jamb, swings 80 cm into the room. */
  door: { x0: 0.55, x1: 1.35, z0: HD - 0.82, z1: HD } satisfies Rect,
  doorHinge: { x: 1.35, z: HD, radius: 0.8 },
  /** Sliding chalkboard closet (east wall) needs 60 cm to reach in. */
  closet: { x0: HW - 0.6, x1: HW, z0: -1.15, z1: 0.65 } satisfies Rect,
  /** Daylight band in front of the north window; anything taller than the sill blocks it. */
  window: { x0: -0.6, x1: 0.5, z0: -HD, z1: -HD + 0.7 } satisfies Rect,
  windowSill: 0.93,
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
  nx = Math.min(HW - hx, Math.max(-HW + hx, nx));
  nz = Math.min(HD - hz, Math.max(-HD + hz, nz));
  return { x: nx, z: nz };
}
