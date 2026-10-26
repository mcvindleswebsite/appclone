// Rule-based interior design engine: scores a layout against clearance, door,
// daylight, balance and palette rules, and searches for a better arrangement.
// Pure functions only, so it runs per drag frame and inside the optimizer.

import {
  ADDITIONS,
  GRID_STEP,
  ROOM,
  WALK_CLEARANCE,
  ZONES,
  constrain,
  halfExtents,
  type FurnitureItem,
  type Layout,
  type Placement,
  type Rect,
  type Side,
} from "./roomData";

const HW = ROOM.width / 2;
const HD = ROOM.depth / 2;
const MIN_OVERLAP = 0.004; // m² — ignore touching edges and float noise

export const GRID_NX = Math.round(ROOM.width / GRID_STEP);
export const GRID_NZ = Math.round(ROOM.depth / GRID_STEP);

export type IssueCode = "collision" | "door" | "closet" | "window" | "access" | "walkway";

export interface Issue {
  code: IssueCode;
  message: string;
}

export interface ItemReport {
  id: string;
  label: string;
  status: "bad" | "good" | "neutral";
  issues: Issue[];
  wins: string[];
}

export interface SceneOptions {
  /** Boca-gold throw + pillows on the bed (a suggested addition). */
  accentTextiles: boolean;
  /** Oak floating shelf on the blankest wall (a suggested addition). */
  floatingShelf: boolean;
}

export interface Analysis {
  reports: Record<string, ItemReport>;
  metrics: { clearance: number; light: number; balance: number; palette: number; harmony: number };
  score: number;
  /** Percent of visible surface area in each palette band. */
  palette: { base: number; secondary: number; accent: number };
  /** GRID_NX × GRID_NZ, 1 where a 76 cm-wide walkway from the door reaches. Row-major by z. */
  reachable: Uint8Array;
}

// ---------------------------------------------------------------------------
// Geometry

const DIRS: Record<Side, [number, number]> = { "+x": [1, 0], "-x": [-1, 0], "+z": [0, 1], "-z": [0, -1] };

/** Direction of a local side in world space (rotation.y = turns · 90°). */
export function worldDir(side: Side, turns: number): [number, number] {
  const [x, z] = DIRS[side];
  const t = ((turns % 4) + 4) % 4;
  const c = [1, 0, -1, 0][t];
  const s = [0, 1, 0, -1][t];
  return [x * c + z * s, -x * s + z * c];
}

export function footprint(item: FurnitureItem, p: Placement): Rect {
  const { hx, hz } = halfExtents(item, p.turns);
  return { x0: p.x - hx, x1: p.x + hx, z0: p.z - hz, z1: p.z + hz };
}

function overlap(a: Rect, b: Rect) {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const d = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
  return w > 0 && d > 0 ? w * d : 0;
}

function rectDist(a: Rect, b: Rect) {
  const dx = Math.max(0, b.x0 - a.x1, a.x0 - b.x1);
  const dz = Math.max(0, b.z0 - a.z1, a.z0 - b.z1);
  return Math.hypot(dx, dz);
}

function pointDist(x: number, z: number, r: Rect) {
  const dx = Math.max(0, r.x0 - x, x - r.x1);
  const dz = Math.max(0, r.z0 - z, z - r.z1);
  return Math.hypot(dx, dz);
}

/** The band of floor directly beside one side of a rect. */
function strip(r: Rect, [dx, dz]: [number, number], depth: number): Rect {
  if (dx > 0) return { x0: r.x1, x1: r.x1 + depth, z0: r.z0, z1: r.z1 };
  if (dx < 0) return { x0: r.x0 - depth, x1: r.x0, z0: r.z0, z1: r.z1 };
  if (dz > 0) return { x0: r.x0, x1: r.x1, z0: r.z1, z1: r.z1 + depth };
  return { x0: r.x0, x1: r.x1, z0: r.z0 - depth, z1: r.z0 };
}

function outsideRoom(r: Rect) {
  return r.x0 < -HW - 0.01 || r.x1 > HW + 0.01 || r.z0 < -HD - 0.01 || r.z1 > HD + 0.01;
}

function againstWall(r: Rect, [dx, dz]: [number, number], tol = 0.06) {
  if (dx > 0) return HW - r.x1 <= tol;
  if (dx < 0) return r.x0 + HW <= tol;
  if (dz > 0) return HD - r.z1 <= tol;
  return r.z0 + HD <= tol;
}

function wallsNear(r: Rect, tol: number) {
  return [HW - r.x1, r.x0 + HW, HD - r.z1, r.z0 + HD].filter((g) => g <= tol).length;
}

/** Squared point-to-rect distance (no sqrt) for the hot walkway loops. */
function pointDist2(x: number, z: number, r: Rect) {
  const dx = r.x0 > x ? r.x0 - x : x > r.x1 ? x - r.x1 : 0;
  const dz = r.z0 > z ? r.z0 - z : z > r.z1 ? z - r.z1 : 0;
  return dx * dx + dz * dz;
}

// Walkway cell centers, precomputed so the hot loops don't allocate.
const CELL_X = Float64Array.from({ length: GRID_NX }, (_, i) => -HW + GRID_STEP * (i + 0.5));
const CELL_Z = Float64Array.from({ length: GRID_NZ }, (_, j) => -HD + GRID_STEP * (j + 0.5));

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

// ---------------------------------------------------------------------------
// Palette (60-30-10). Areas are visible surface m², grouped by color role.

const WALL_OPENINGS = 1.05 + 1.76 + 3.69; // window, entry door, closet doors
const WALLS_NET = 2 * (ROOM.width + ROOM.depth) * ROOM.height - WALL_OPENINGS;
const TURF_AREA = 2.3 * 2.2;
const SECONDARY_FIXED = 2.2 + 3.69; // olive curtains + chalkboard closet
const ACCENT_FIXED = 0.4 + 0.19 + 0.22 + 0.03 + 0.15; // jersey, pennant, poster, plate, lamp + trophy
const ACCENT_TEXTILE_AREA = 1.1;

function visibleArea(item: FurnitureItem) {
  const { w, d, h } = item.size;
  return item.design.flat ? w * d : w * d + (w + d) * h * 0.5;
}

function paletteShares(items: FurnitureItem[], opts: SceneOptions) {
  const rug = items.some((i) => i.kind === "areaRug");
  // Floor that isn't covered by the turf or a rug reads as base carpet.
  const rugArea = items.filter((i) => i.design.flat).reduce((s, i) => s + i.size.w * i.size.d, 0);
  let base = WALLS_NET + ROOM.width * ROOM.depth - (rug ? rugArea : TURF_AREA);
  let secondary = SECONDARY_FIXED + (rug ? 0 : TURF_AREA);
  let accent = ACCENT_FIXED + (opts.accentTextiles ? ACCENT_TEXTILE_AREA : 0);
  if (opts.floatingShelf) {
    secondary += 0.2;
    accent += 0.12;
  }
  for (const item of items) {
    const a = visibleArea(item);
    if (item.design.palette === "base") base += a;
    else if (item.design.palette === "secondary") secondary += a;
    else accent += a;
  }
  const total = base + secondary + accent;
  return {
    base: Math.round((base / total) * 100),
    secondary: Math.round((secondary / total) * 100),
    accent: Math.round((accent / total) * 100),
  };
}

// ---------------------------------------------------------------------------
// Analysis

export function analyze(items: FurnitureItem[], layout: Layout, opts: SceneOptions): Analysis {
  const placed = items.filter((i) => layout[i.id]);
  const rects: Record<string, Rect> = {};
  for (const i of placed) rects[i.id] = footprint(i, layout[i.id]);
  const solid = placed.filter((i) => !i.design.flat);
  const byId = Object.fromEntries(placed.map((i) => [i.id, i]));
  const isPair = (a: FurnitureItem, b: FurnitureItem) => a.design.companionOf === b.id || b.design.companionOf === a.id;

  const reports: Record<string, ItemReport> = {};
  for (const i of placed) reports[i.id] = { id: i.id, label: i.label, status: "neutral", issues: [], wins: [] };
  const flag = (id: string, code: IssueCode, message: string) => {
    if (!reports[id].issues.some((x) => x.message === message)) reports[id].issues.push({ code, message });
  };

  // Collisions.
  for (let a = 0; a < solid.length; a++) {
    for (let b = a + 1; b < solid.length; b++) {
      const A = solid[a];
      const B = solid[b];
      if (isPair(A, B)) continue;
      if (overlap(rects[A.id], rects[B.id]) > MIN_OVERLAP) {
        flag(A.id, "collision", `Overlaps the ${B.label.toLowerCase()}`);
        flag(B.id, "collision", `Overlaps the ${A.label.toLowerCase()}`);
      }
    }
  }

  // Doors and daylight.
  for (const i of solid) {
    const r = rects[i.id];
    if (overlap(r, ZONES.door) > MIN_OVERLAP) flag(i.id, "door", "Blocks the door swing");
    if (overlap(r, ZONES.closet) > MIN_OVERLAP) flag(i.id, "closet", "Blocks the closet doors");
    // A chair pulled up to a window desk is the point of the desk, not an obstruction.
    if (i.design.role !== "companion" && i.size.h > ZONES.windowSill && overlap(r, ZONES.window) > MIN_OVERLAP) {
      flag(i.id, "window", "Blocks daylight from the window");
    }
  }

  // Use clearance in front of drawers, desks and beds.
  const accessOk: Record<string, boolean> = {};
  for (const i of placed) {
    const spec = i.design.access;
    if (!spec) continue;
    const p = layout[i.id];
    const results = spec.sides.map((side) => {
      const zone = strip(rects[i.id], worldDir(side, p.turns), spec.depth);
      if (spec.trimFromWall && i.design.wallSide) {
        const [wx, wz] = worldDir(i.design.wallSide, p.turns);
        if (wx < 0) zone.x0 += spec.trimFromWall;
        if (wx > 0) zone.x1 -= spec.trimFromWall;
        if (wz < 0) zone.z0 += spec.trimFromWall;
        if (wz > 0) zone.z1 -= spec.trimFromWall;
      }
      const blockers = solid.filter(
        (o) => o.id !== i.id && !isPair(o, i) && overlap(zone, rects[o.id]) > MIN_OVERLAP,
      );
      return { ok: !outsideRoom(zone) && blockers.length === 0, blockers };
    });
    const ok = spec.mode === "all" ? results.every((r) => r.ok) : results.some((r) => r.ok);
    accessOk[i.id] = ok;
    if (!ok) {
      flag(i.id, "access", `Needs ${spec.label}`);
      if (spec.mode === "all") {
        for (const b of results.flatMap((r) => r.blockers)) {
          flag(b.id, "access", `Crowds the ${i.label.toLowerCase()} (${spec.label})`);
        }
      }
    }
  }

  // Walkways: cells whose center keeps half the clearance from every obstacle
  // and wall, flood-filled from the doorway.
  const half = WALK_CLEARANCE / 2;
  const half2 = half * half;
  const solidRects = solid.map((o) => rects[o.id]);
  const walkable = new Uint8Array(GRID_NX * GRID_NZ);
  for (let j = 0; j < GRID_NZ; j++) {
    for (let i = 0; i < GRID_NX; i++) {
      const x = CELL_X[i];
      const z = CELL_Z[j];
      if (Math.abs(x) > HW - half || Math.abs(z) > HD - half) continue;
      let free = true;
      for (const r of solidRects) {
        if (pointDist2(x, z, r) < half2) {
          free = false;
          break;
        }
      }
      if (free) walkable[j * GRID_NX + i] = 1;
    }
  }
  const reachable = new Uint8Array(GRID_NX * GRID_NZ);
  const queue: number[] = [];
  for (let j = 0; j < GRID_NZ; j++) {
    for (let i = 0; i < GRID_NX; i++) {
      const k = j * GRID_NX + i;
      if (walkable[k] && pointDist2(CELL_X[i], CELL_Z[j], ZONES.door) === 0) {
        reachable[k] = 1;
        queue.push(k);
      }
    }
  }
  const visit = (n: number) => {
    if (walkable[n] && !reachable[n]) {
      reachable[n] = 1;
      queue.push(n);
    }
  };
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q];
    const i = k % GRID_NX;
    if (i > 0) visit(k - 1);
    if (i < GRID_NX - 1) visit(k + 1);
    if (k >= GRID_NX) visit(k - GRID_NX);
    if (k < GRID_NX * (GRID_NZ - 1)) visit(k + GRID_NX);
  }
  const near2 = (half + 0.17) ** 2;
  const reaches = (group: Rect[]) => {
    for (const k of queue) {
      const x = CELL_X[k % GRID_NX];
      const z = CELL_Z[Math.floor(k / GRID_NX)];
      for (const r of group) if (pointDist2(x, z, r) <= near2) return true;
    }
    return false;
  };
  for (const i of solid) {
    if (i.design.role !== "anchor") continue;
    const group = [rects[i.id], ...solid.filter((o) => o.design.companionOf === i.id).map((o) => rects[o.id])];
    if (!reaches(group)) flag(i.id, "walkway", "No 76 cm walkway reaches it from the door");
  }

  // Harmony: each piece's own placement rules.
  const harmonious: Record<string, boolean> = {};
  const lampSpots = solid
    .filter((o) => o.id === "desk" || o.id === "nightstand" || o.id === "bed")
    .map((o) => {
      const rect = rects[o.id];
      if (o.id !== "bed" || !o.design.wallSide) return { item: o, rect };
      // Only the head end of the bed counts: a lamp at the foot is in the way.
      const [wx, wz] = worldDir(o.design.wallSide, layout[o.id].turns);
      const head = { ...rect };
      if (wx < 0) head.x1 = head.x0 + 0.5;
      if (wx > 0) head.x0 = head.x1 - 0.5;
      if (wz < 0) head.z1 = head.z0 + 0.5;
      if (wz > 0) head.z0 = head.z1 - 0.5;
      return { item: o, rect: head };
    });
  const nearAnchor = (r: Rect) => lampSpots.find((s) => rectDist(r, s.rect) <= 0.35)?.item;
  for (const i of placed) {
    const r = rects[i.id];
    const p = layout[i.id];
    const wins = reports[i.id].wins;
    const onWall = i.design.wallSide ? againstWall(r, worldDir(i.design.wallSide, p.turns)) : false;
    switch (i.kind) {
      case "bed": {
        const [hx, hz] = worldDir("-x", p.turns);
        const underWindow = hz < 0 && againstWall(r, [hx, hz]) && r.x1 > ZONES.window.x0 && r.x0 < ZONES.window.x1;
        if (onWall && !underWindow) wins.push("Headboard anchored to a solid wall");
        if (onWall && wallsNear(r, 0.06) >= 2) wins.push("Corner placement opens up floor space");
        harmonious[i.id] = onWall && !underWindow;
        break;
      }
      case "desk": {
        const lit = rectDist(r, ZONES.window) <= 0.9;
        const windowX = (ZONES.window.x0 + ZONES.window.x1) / 2;
        const centered = onWall && r.z0 + HD <= 0.06 && Math.abs((r.x0 + r.x1) / 2 - windowX) <= 0.3;
        if (centered) wins.push("Centered on the window, the room's focal point");
        else if (onWall) wins.push("Back to the wall, facing into the room");
        if (lit) wins.push("Natural light on the work surface");
        harmonious[i.id] = onWall && lit;
        break;
      }
      case "dresser":
      case "nightstand":
        if (onWall && accessOk[i.id]) wins.push("Against the wall with clear access");
        harmonious[i.id] = onWall && accessOk[i.id];
        break;
      case "gamingChair": {
        const desk = byId.desk;
        if (!desk) break;
        const dr = rects.desk;
        const [fx, fz] = worldDir("+z", p.turns);
        const vx = (dr.x0 + dr.x1) / 2 - p.x;
        const vz = (dr.z0 + dr.z1) / 2 - p.z;
        const facing = (fx * vx + fz * vz) / (Math.hypot(vx, vz) || 1) > 0.7;
        if (rectDist(r, dr) <= 0.35 && facing) wins.push("Pulled up to the desk");
        harmonious[i.id] = wins.length > 0;
        break;
      }
      case "floorLamp":
      case "uplight": {
        const corner = wallsNear(r, 0.35) >= 2;
        const beside = nearAnchor(r);
        const awayFromWindow = rectDist(r, ZONES.window) >= 0.8;
        if (awayFromWindow && corner) wins.push("Lights a dark corner");
        else if (awayFromWindow && beside) wins.push(`Task light beside the ${beside.label.toLowerCase()}`);
        harmonious[i.id] = wins.length > 0;
        break;
      }
      case "acousticGuitar":
      case "electricGuitar":
        if (onWall) wins.push("Leaning safely against a wall");
        harmonious[i.id] = onWall;
        break;
      case "areaRug": {
        const bed = byId.bed;
        if (!bed) break;
        const br = rects.bed;
        const share = overlap(r, br) / ((br.x1 - br.x0) * (br.z1 - br.z0));
        if (share >= 0.3 && share <= 0.9) wins.push("Anchors the bed with floor showing at the head");
        harmonious[i.id] = wins.length > 0;
        break;
      }
    }
  }

  for (const i of placed) {
    const rep = reports[i.id];
    rep.status = rep.issues.length ? "bad" : harmonious[i.id] ? "good" : "neutral";
  }

  // Metrics.
  const all = Object.values(reports);
  const issueCount = (codes: IssueCode[]) => all.reduce((n, r) => n + r.issues.filter((x) => codes.includes(x.code)).length, 0);
  const clearance = clamp(100 - 16 * issueCount(["collision", "door", "closet", "access", "walkway"]));
  const deskLit = reports.desk?.wins.includes("Natural light on the work surface") ?? true;
  const light = clamp(100 - 40 * issueCount(["window"]) - (deskLit ? 0 : 20));

  let wSum = 0;
  let cx = 0;
  let cz = 0;
  for (const i of solid) {
    const w = i.size.w * i.size.d * i.size.h;
    const p = layout[i.id];
    wSum += w;
    cx += p.x * w;
    cz += p.z * w;
  }
  const offset = wSum ? Math.hypot(cx / wSum, cz / wSum) / Math.hypot(HW, HD) : 0;
  const balance = clamp(100 * (1 - offset * 2.2));

  const palette = paletteShares(placed, opts);
  const paletteScore = clamp(
    100 - 2 * (Math.abs(palette.base - 60) + Math.abs(palette.secondary - 30) + Math.abs(palette.accent - 10)),
  );
  const harmony = clamp((100 * all.filter((r) => r.status === "good").length) / Math.max(1, all.length));

  const score = clamp(0.35 * clearance + 0.15 * light + 0.15 * balance + 0.1 * paletteScore + 0.25 * harmony);

  return {
    reports,
    metrics: { clearance, light, balance, palette: paletteScore, harmony },
    score,
    palette,
    reachable,
  };
}

// ---------------------------------------------------------------------------
// Auto-layout: beam search over wall-flush placements for the anchors, then
// the chair follows the desk and accents take their best-scoring spots.

const PENALTY: Record<IssueCode, number> = { collision: 100, door: 60, closet: 40, window: 35, access: 30, walkway: 45 };

function objective(a: Analysis) {
  let s = a.metrics.balance * 0.4;
  for (const r of Object.values(a.reports)) {
    for (const issue of r.issues) s -= PENALTY[issue.code];
    if (r.status === "good") s += 12;
    s += 4 * r.wins.length;
  }
  return s;
}

function wallCandidates(item: FurnitureItem, step: number): Placement[] {
  const side = item.design.wallSide ?? "-z";
  const out: Placement[] = [];
  for (let turns = 0; turns < 4; turns++) {
    const [dx, dz] = worldDir(side, turns);
    const { hx, hz } = halfExtents(item, turns);
    if (dx !== 0) {
      const x = dx > 0 ? HW - hx : -HW + hx;
      for (let z = -HD + hz; z <= HD - hz + 1e-6; z += step) out.push({ x, z, turns });
    } else {
      const z = dz > 0 ? HD - hz : -HD + hz;
      for (let x = -HW + hx; x <= HW - hx + 1e-6; x += step) out.push({ x, z, turns });
    }
  }
  return out;
}

function chairFor(desk: FurnitureItem, chair: FurnitureItem, p: Placement): Placement {
  const [fx, fz] = worldDir("+z", p.turns);
  const reach = desk.size.d / 2 + chair.size.d / 2 - 0.12;
  const turns = (p.turns + 2) % 4;
  return { turns, ...constrain(chair, p.x + fx * reach, p.z + fz * reach, turns, false) };
}

function spotCandidates(item: FurnitureItem, layout: Layout, items: FurnitureItem[]): Placement[] {
  const out: Placement[] = [];
  const { hx, hz } = halfExtents(item, 0);
  // Corners.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push({ x: sx * (HW - hx - 0.05), z: sz * (HD - hz - 0.05), turns: 0 });
  // Beside each anchor.
  for (const a of items) {
    if (a.design.role !== "anchor" || !layout[a.id]) continue;
    const r = footprint(a, layout[a.id]);
    const g = 0.05;
    out.push(
      { x: r.x0 - hx - g, z: r.z0 + hz, turns: 0 },
      { x: r.x0 - hx - g, z: r.z1 - hz, turns: 0 },
      { x: r.x1 + hx + g, z: r.z0 + hz, turns: 0 },
      { x: r.x1 + hx + g, z: r.z1 - hz, turns: 0 },
      { x: r.x0 + hx, z: r.z0 - hz - g, turns: 0 },
      { x: r.x1 - hx, z: r.z1 + hz + g, turns: 0 },
    );
  }
  return out.map((p) => ({ ...p, ...constrain(item, p.x, p.z, 0, false) }));
}

function rugCandidates(rug: FurnitureItem, layout: Layout, bed: FurnitureItem | undefined): Placement[] {
  if (!bed || !layout.bed) return [];
  const b = layout.bed;
  const [fx, fz] = worldDir("+x", b.turns); // toward the foot of the bed
  const out: Placement[] = [];
  for (const shift of [0.2, 0.35, 0.5, 0.65]) {
    for (let turns = 0; turns < 2; turns++) {
      const x = b.x + fx * shift;
      const z = b.z + fz * shift;
      out.push({ turns, ...constrain(rug, x, z, turns, false) });
    }
  }
  return out;
}

/** Where a newly added rug should land: the best-scoring spot under the bed. */
export function bestRugPlacement(items: FurnitureItem[], layout: Layout, opts: SceneOptions): Placement | null {
  const rug = items.find((i) => i.kind === "areaRug");
  if (!rug) return null;
  const cands = rugCandidates(rug, layout, items.find((i) => i.id === "bed"));
  let best: Placement | null = null;
  let bestScore = -Infinity;
  for (const c of cands) {
    const s = objective(analyze(items, { ...layout, [rug.id]: c }, opts));
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return best;
}

export function optimizeLayout(items: FurnitureItem[], current: Layout, opts: SceneOptions): Layout {
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  const anchors = ["bed", "desk", "dresser", "nightstand"].map((id) => byId[id]).filter(Boolean);
  const chair = byId.gamingChair;
  const BEAM = 4;

  const stage = (placed: FurnitureItem[], layout: Layout) => objective(analyze(placed, layout, opts));

  let beam: { layout: Layout; score: number }[] = [{ layout: {}, score: 0 }];
  const placed: FurnitureItem[] = [];
  for (const anchor of anchors) {
    placed.push(anchor);
    if (anchor.id === "desk" && chair) placed.push(chair);
    const next: { layout: Layout; score: number }[] = [];
    for (const b of beam) {
      for (const cand of wallCandidates(anchor, 0.1)) {
        const layout: Layout = { ...b.layout, [anchor.id]: cand };
        if (anchor.id === "desk" && chair) layout.gamingChair = chairFor(anchor, chair, cand);
        next.push({ layout, score: stage(placed, layout) });
      }
    }
    next.sort((a, b) => b.score - a.score);
    beam = next.slice(0, BEAM);
  }

  let layout = beam[0]?.layout ?? {};
  // Accents: greedily take the best candidate for each, in turn.
  const accents = items.filter((i) => i.design.role === "accent");
  for (const item of accents) {
    placed.push(item);
    const cands =
      item.kind === "areaRug"
        ? rugCandidates(item, layout, byId.bed)
        : item.design.wallSide
          ? wallCandidates(item, 0.1)
          : spotCandidates(item, layout, items);
    if (!cands.length) {
      if (current[item.id]) layout = { ...layout, [item.id]: current[item.id] };
      continue;
    }
    let best = cands[0];
    let bestScore = -Infinity;
    for (const c of cands) {
      const s = stage(placed, { ...layout, [item.id]: c });
      if (s > bestScore) {
        bestScore = s;
        best = c;
      }
    }
    layout = { ...layout, [item.id]: best };
  }

  // Refine: re-place each piece with everything else fixed until nothing improves.
  // This undoes early beam choices (e.g. a bed that seals off a corner).
  const candidatesFor = (item: FurnitureItem, l: Layout) =>
    item.kind === "areaRug"
      ? rugCandidates(item, l, byId.bed)
      : item.design.wallSide
        ? wallCandidates(item, 0.1)
        : spotCandidates(item, l, items);
  const movable = [...anchors, ...accents];
  let currentScore = stage(placed, layout);
  for (let pass = 0; pass < 3; pass++) {
    let improved = false;
    for (const item of movable) {
      for (const c of candidatesFor(item, layout)) {
        const trial: Layout = { ...layout, [item.id]: c };
        if (item.id === "desk" && chair) trial.gamingChair = chairFor(item, chair, c);
        const s = stage(placed, trial);
        if (s > currentScore + 1e-6) {
          currentScore = s;
          layout = trial;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }

  // Keep the current spot for anything the search didn't cover, and keep the
  // current layout outright if the search can't beat it.
  const merged: Layout = { ...current, ...layout };
  const before = objective(analyze(items, current, opts));
  const after = objective(analyze(items, merged, opts));
  return after >= before ? merged : current;
}

// ---------------------------------------------------------------------------
// Suggested additions

export type SuggestionId = "areaRug" | "uplight" | "accentTextiles" | "floatingShelf";

export interface Suggestion {
  id: SuggestionId;
  title: string;
  spec: string;
  reason: string;
  swatch: string;
}

export interface ShelfSpot {
  wall: "north" | "east" | "south" | "west";
  /** Center along the wall in that wall's local x (see RoomShell). */
  localX: number;
  length: number;
}

// Wall features at shelf height, as [start, end] in each wall's local x.
const WALL_FEATURES: Record<ShelfSpot["wall"], { span: number; blocked: [number, number][] }> = {
  north: { span: ROOM.width, blocked: [[-0.93, 0.87], [0.72, 1.56]] },
  east: { span: ROOM.depth, blocked: [[-1.19, 0.69]] },
  south: { span: ROOM.width, blocked: [[-1.39, -0.51], [-0.33, 0.63]] },
  west: { span: ROOM.depth, blocked: [[-0.45, 0.15]] },
};

/** Longest blank stretch of wall at eye level, for the floating shelf. */
export function blankestWall(): ShelfSpot {
  let best: ShelfSpot & { free: number } = { wall: "west", localX: 0, length: 0.9, free: 0 };
  for (const [wall, { span, blocked }] of Object.entries(WALL_FEATURES) as [ShelfSpot["wall"], (typeof WALL_FEATURES)["west"]][]) {
    const cuts = [...blocked].sort((a, b) => a[0] - b[0]);
    let cursor = -span / 2 + 0.1;
    for (const [s, e] of [...cuts, [span / 2 - 0.1, span / 2] as [number, number]]) {
      const free = s - cursor;
      if (free > best.free) best = { wall, localX: cursor + free / 2, length: Math.min(0.9, free - 0.2), free };
      cursor = Math.max(cursor, e);
    }
  }
  return { wall: best.wall, localX: best.localX, length: best.length };
}

/** The free room corner farthest from daylight and existing lamps. */
export function darkestCorner(items: FurnitureItem[], layout: Layout): Placement {
  const uplight = ADDITIONS.find((a) => a.id === "uplight");
  const inset = (uplight?.size.w ?? 0.26) / 2 + 0.08;
  const sources: [number, number, number][] = [[(ZONES.window.x0 + ZONES.window.x1) / 2, -HD, 2]];
  if (layout.floorLamp) sources.push([layout.floorLamp.x, layout.floorLamp.z, 2.5]);
  const occupied = items
    .filter((i) => i.id !== "uplight" && !i.design.flat && layout[i.id])
    .map((i) => footprint(i, layout[i.id]));
  let best: Placement = { x: HW - inset, z: HD - inset, turns: 0 };
  let bestDark = -Infinity;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const x = sx * (HW - inset);
      const z = sz * (HD - inset);
      if (pointDist(x, z, ZONES.door) < 0.2) continue;
      const spot = { x0: x - inset, x1: x + inset, z0: z - inset, z1: z + inset };
      if (occupied.some((r) => overlap(r, spot) > 0)) continue;
      const dark = sources.reduce((s, [lx, lz, w]) => s + w * Math.hypot(x - lx, z - lz), 0);
      if (dark > bestDark) {
        bestDark = dark;
        best = { x, z, turns: 0 };
      }
    }
  }
  return best;
}

const cornerName = (p: Placement) => `${p.z < 0 ? "north" : "south"}${p.x < 0 ? "west" : "east"}`;

export function suggestAdditions(analysis: Analysis, items: FurnitureItem[], layout: Layout): Suggestion[] {
  const rug = ADDITIONS.find((a) => a.id === "areaRug");
  const rugSpec = rug ? `${rug.size.d} × ${rug.size.w} m · low-pile wool` : "";
  const corner = darkestCorner(items, layout);
  const shelf = blankestWall();
  const out: [number, Suggestion][] = [
    [
      10 - analysis.palette.accent,
      {
        id: "accentTextiles",
        title: "Boca-gold throw & pillows",
        spec: "130 × 170 cm throw · two 50 cm shams",
        reason: `Accents are ${analysis.palette.accent}% of the room against a 10% target. Gold ties the bed to the jersey and pennant.`,
        swatch: "#f2b630",
      },
    ],
    [
      4,
      {
        id: "areaRug",
        title: "Sand area rug",
        spec: rugSpec,
        reason: "Swaps the turf for a neutral base under the bed. Sized for your room with a 30 cm floor border.",
        swatch: "#cbb994",
      },
    ],
    [
      3 + (100 - analysis.metrics.light) / 20,
      {
        id: "uplight",
        title: "Corner uplight",
        spec: "150 cm column · 2700 K warm",
        reason: `The ${cornerName(corner)} corner is the farthest from daylight and your lamp. Bounce light off the ceiling there.`,
        swatch: "#ffd7a0",
      },
    ],
    [
      2,
      {
        id: "floatingShelf",
        title: "Oak floating shelf",
        spec: `${Math.round(shelf.length * 100)} × 22 cm · mounted at 145 cm`,
        reason: `Your ${shelf.wall} wall has the longest blank stretch. A shelf there balances the art on the other walls.`,
        swatch: "#b08a5a",
      },
    ],
  ];
  return out.sort((a, b) => b[0] - a[0]).map(([, suggestion]) => suggestion);
}
