"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { Canvas, useFrame, useThree, type RootState, type ThreeEvent } from "@react-three/fiber";
import { Edges, Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { DoorClosed, DoorOpen, Grid3x3, Orbit, RotateCcw, RotateCw, Ruler, ScanEye } from "lucide-react";

import { cn } from "@/lib/utils";

import { DesignPanel } from "./DesignPanel";
import {
  analyze,
  bestRugPlacement,
  blankestWall,
  darkestCorner,
  optimizeLayout,
  suggestAdditions,
  type ItemReport,
  type SceneOptions,
  type SuggestionId,
} from "./designEngine";
import { FurnitureModel } from "./FurnitureModels";
import { DEFAULT_COLORS, type ColorTarget, type RoomColors } from "./roomColors";
import { RoomShell } from "./RoomShell";
import {
  ADDITIONS,
  ALL_ITEMS,
  FURNITURE,
  GRID_STEP,
  INITIAL_LAYOUT,
  ROOM,
  constrain,
  type FurnitureItem,
  type Layout,
  type Placement,
} from "./roomData";
import { FEEDBACK_COLORS, ZonesOverlay } from "./ZonesOverlay";

type View = "orbit" | "top";
type Controls = ComponentRef<typeof OrbitControls>;
type Added = Record<SuggestionId, boolean>;

const LAYOUT_KEY = "room-layout-v1";
const ADDED_KEY = "room-additions-v1";
const COLORS_KEY = "room-colors-v1";
const NO_ADDITIONS: Added = { areaRug: false, uplight: false, accentTextiles: false, floatingShelf: false };
const SELECT_COLOR = "#7dd3fc";
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ORBIT_POS = new THREE.Vector3(3.4, 3.6, 4.6);
const ORBIT_TARGET = new THREE.Vector3(-0.1, 0.7, -0.2);
const TOP_POS = new THREE.Vector3(0, 9.2, 0.01);
const TOP_TARGET = new THREE.Vector3(0, 0, 0);

function loadLayout(): Layout {
  const layout: Layout = { ...INITIAL_LAYOUT };
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "null") as Partial<Layout> | null;
    if (saved) {
      for (const item of ALL_ITEMS) {
        const p = saved[item.id];
        if (p && Number.isFinite(p.x) && Number.isFinite(p.z) && Number.isInteger(p.turns)) {
          layout[item.id] = { x: p.x, z: p.z, turns: ((p.turns % 4) + 4) % 4 };
        }
      }
    }
  } catch {
    // Corrupt or unavailable storage: fall back to the photographed layout.
  }
  return layout;
}

function loadAdded(): Added {
  try {
    const saved = JSON.parse(localStorage.getItem(ADDED_KEY) ?? "null") as Partial<Added> | null;
    if (saved) {
      return Object.fromEntries(Object.keys(NO_ADDITIONS).map((k) => [k, saved[k as SuggestionId] === true])) as Added;
    }
  } catch {
    // Ignore unreadable storage.
  }
  return NO_ADDITIONS;
}

function loadColors(): RoomColors {
  try {
    const saved = JSON.parse(localStorage.getItem(COLORS_KEY) ?? "null") as Partial<RoomColors> | null;
    if (saved) {
      return Object.fromEntries(
        Object.entries(DEFAULT_COLORS).map(([k, v]) => {
          const c = saved[k as ColorTarget];
          return [k, typeof c === "string" && /^#[0-9a-f]{6}$/i.test(c) ? c : v];
        }),
      ) as RoomColors;
    }
  } catch {
    // Ignore unreadable storage.
  }
  return DEFAULT_COLORS;
}

const cm = (m: number) => Math.round(m * 100);

function setControlsEnabled(get: () => RootState, enabled: boolean) {
  const controls = get().controls as Controls | null;
  if (controls) controls.enabled = enabled;
}

function DraggableItem({
  item,
  placement,
  report,
  selected,
  showDims,
  accentTextiles,
  colors,
  onSelect,
  onMove,
  onDragChange,
}: {
  item: FurnitureItem;
  placement: Placement;
  report: ItemReport | undefined;
  selected: boolean;
  showDims: boolean;
  accentTextiles: boolean;
  colors: RoomColors;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, z: number) => void;
  onDragChange: (dragging: boolean) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const drag = useRef<{ ox: number; oz: number } | null>(null);
  const hit = useMemo(() => new THREE.Vector3(), []);
  const get = useThree((s) => s.get);
  // Only the first render seeds the transform; after that useFrame eases toward the placement.
  const [initial] = useState(() => ({
    position: [placement.x, 0, placement.z] as [number, number, number],
    rotation: [0, (placement.turns * Math.PI) / 2, 0] as [number, number, number],
  }));

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const k = 1 - Math.exp(-dt * 16);
    g.position.x += (placement.x - g.position.x) * k;
    g.position.z += (placement.z - g.position.z) * k;
    g.position.y += ((drag.current ? 0.035 : 0) - g.position.y) * k;
    const target = (placement.turns * Math.PI) / 2;
    const diff = Math.atan2(Math.sin(target - g.rotation.y), Math.cos(target - g.rotation.y));
    g.rotation.y += diff * Math.min(1, k * 0.8);
  });

  const endDrag = (e: ThreeEvent<PointerEvent>) => {
    if (!drag.current) return;
    drag.current = null;
    (e.target as unknown as Element).releasePointerCapture(e.pointerId);
    setControlsEnabled(get, true);
    document.body.style.cursor = "grab";
    onDragChange(false);
  };

  const { w, d, h } = item.size;
  const status = report?.status ?? "neutral";
  const feedback = status === "neutral" ? null : FEEDBACK_COLORS[status];
  const outline = selected ? (feedback ?? SELECT_COLOR) : feedback;

  return (
    <group
      ref={group}
      position={initial.position}
      rotation={initial.rotation}
      onPointerDown={(e) => {
        if (e.button !== 0) return; // right/middle drag still pans the camera
        e.stopPropagation();
        onSelect(item.id);
        if (!e.ray.intersectPlane(FLOOR, hit)) return;
        drag.current = { ox: hit.x - placement.x, oz: hit.z - placement.z };
        (e.target as unknown as Element).setPointerCapture(e.pointerId);
        // OrbitControls reads `enabled` synchronously on the same DOM event, so flip it here.
        setControlsEnabled(get, false);
        document.body.style.cursor = "grabbing";
        onDragChange(true);
      }}
      onPointerMove={(e) => {
        if (!drag.current) return;
        e.stopPropagation();
        if (!e.ray.intersectPlane(FLOOR, hit)) return;
        onMove(item.id, hit.x - drag.current.ox, hit.z - drag.current.oz);
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerOver={(e) => {
        e.stopPropagation();
        if (!drag.current) document.body.style.cursor = "grab";
      }}
      onPointerOut={() => {
        if (!drag.current) document.body.style.cursor = "auto";
      }}
    >
      <FurnitureModel item={item} accentTextiles={accentTextiles} colors={colors} />

      {/* Spatial feedback: red footprint in tight/blocked spots, green in harmony zones. */}
      {(feedback || selected) && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} raycast={() => null}>
          <planeGeometry args={[w + 0.08, d + 0.08]} />
          <meshBasicMaterial
            color={outline ?? SELECT_COLOR}
            transparent
            opacity={selected ? 0.3 : 0.22}
            depthWrite={false}
          />
        </mesh>
      )}
      {outline && (selected || status === "bad") && (
        <mesh position={[0, h / 2 + 0.01, 0]} raycast={() => null}>
          <boxGeometry args={[w + 0.03, h + 0.02, d + 0.03]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
          <Edges color={outline} />
        </mesh>
      )}

      {(selected || showDims) && (
        <Html center position={[0, h + 0.16, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div
            className={cn(
              "whitespace-nowrap rounded-md px-2 py-1 text-center font-mono text-[10px] leading-tight backdrop-blur-md",
              !selected && "bg-black/55 text-white/85",
              selected && status === "bad" && "bg-[#FF3B30]/90 text-white",
              selected && status === "good" && "bg-[#00DD94]/90 text-[#050D0A]",
              selected && status === "neutral" && "bg-sky-400/90 text-slate-950",
            )}
          >
            {selected && <div className="font-sans text-[11px] font-semibold">{item.label}</div>}
            {cm(w)} × {cm(d)} × {cm(h)} cm
          </div>
        </Html>
      )}
    </group>
  );
}

function SnapGrid() {
  const geometry = useMemo(() => {
    const pts: number[] = [];
    const hw = ROOM.width / 2;
    const hd = ROOM.depth / 2;
    for (let x = -hw; x <= hw + 1e-6; x += GRID_STEP) pts.push(x, 0, -hd, x, 0, hd);
    for (let z = -hd; z <= hd + 1e-6; z += GRID_STEP) pts.push(-hw, 0, z, hw, 0, z);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);
  return (
    <lineSegments geometry={geometry} position={[0, 0.012, 0]} raycast={() => null}>
      <lineBasicMaterial color="#9ad8ff" transparent opacity={0.14} depthWrite={false} />
    </lineSegments>
  );
}

function CameraRig({ view }: { view: View }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as Controls | null;
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);

  useEffect(() => {
    goal.current = view === "top" ? { pos: TOP_POS, target: TOP_TARGET } : { pos: ORBIT_POS, target: ORBIT_TARGET };
  }, [view]);

  useFrame((_, dt) => {
    const g = goal.current;
    if (!g || !controls) return;
    const k = 1 - Math.exp(-dt * 4.5);
    camera.position.lerp(g.pos, k);
    controls.target.lerp(g.target, k);
    controls.update();
    // Land exactly on the goal: straight overhead, even a millimetre of drift
    // would spin the top-down view off north-up.
    if (camera.position.distanceTo(g.pos) < 0.02 && controls.target.distanceTo(g.target) < 0.02) {
      camera.position.copy(g.pos);
      controls.target.copy(g.target);
      controls.update();
      goal.current = null;
    }
  });

  return null;
}

function ToolButton({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      title={label}
      className={cn(
        "flex items-center gap-1.5 rounded-full px-3 py-2 text-xs font-medium transition-colors",
        "text-white/75 hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-35",
        active && "bg-white/90 text-neutral-900 hover:bg-white hover:text-neutral-900",
      )}
    >
      {children}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

export function RoomEditor() {
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const [added, setAdded] = useState<Added>(loadAdded);
  const [colors, setColors] = useState<RoomColors>(loadColors);
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [showDims, setShowDims] = useState(false);
  const [closetOpen, setClosetOpen] = useState(false);
  const [view, setView] = useState<View>("orbit");
  const [panelOpen, setPanelOpen] = useState(() => window.innerWidth >= 640);
  const [showZones, setShowZones] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [optimizing, setOptimizing] = useState(false);
  const [undoLayout, setUndoLayout] = useState<Layout | null>(null);
  const [lastMoved, setLastMoved] = useState<number | null>(null);

  useEffect(() => {
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout));
  }, [layout]);
  useEffect(() => {
    localStorage.setItem(ADDED_KEY, JSON.stringify(added));
  }, [added]);
  useEffect(() => {
    try {
      localStorage.setItem(COLORS_KEY, JSON.stringify(colors));
    } catch {
      // Storage full or blocked: colors just won't persist.
    }
  }, [colors]);

  // Additions join the scene once they have a placement.
  const items = useMemo(
    () => [...FURNITURE, ...ADDITIONS.filter((a) => added[a.id as SuggestionId] && layout[a.id])],
    [added, layout],
  );
  const opts = useMemo<SceneOptions>(
    () => ({ accentTextiles: added.accentTextiles, floatingShelf: added.floatingShelf }),
    [added.accentTextiles, added.floatingShelf],
  );
  const analysis = useMemo(() => analyze(items, layout, opts), [items, layout, opts]);
  // Rank suggestions once so cards don't reshuffle under the cursor as the room changes.
  const [suggestionOrder] = useState(() => suggestAdditions(analysis, items, layout).map((s) => s.id));
  const suggestions = useMemo(
    () =>
      suggestAdditions(analysis, items, layout).sort(
        (a, b) => suggestionOrder.indexOf(a.id) - suggestionOrder.indexOf(b.id),
      ),
    [analysis, items, layout, suggestionOrder],
  );
  const shelf = useMemo(() => (added.floatingShelf ? blankestWall() : null), [added.floatingShelf]);

  const manualEdit = () => {
    setUndoLayout(null);
    setLastMoved(null);
  };

  const move = useCallback(
    (id: string, x: number, z: number) => {
      const item = ALL_ITEMS.find((f) => f.id === id);
      if (!item) return;
      setUndoLayout(null);
      setLastMoved(null);
      setLayout((prev) => {
        const p = prev[id];
        const next = constrain(item, x, z, p.turns, snap);
        if (next.x === p.x && next.z === p.z) return prev;
        return { ...prev, [id]: { ...p, ...next } };
      });
    },
    [snap],
  );

  const rotateSelected = useCallback(() => {
    if (!selected) return;
    const item = ALL_ITEMS.find((f) => f.id === selected);
    if (!item) return;
    setUndoLayout(null);
    setLastMoved(null);
    setLayout((prev) => {
      const p = prev[selected];
      const turns = (p.turns + 1) % 4;
      return { ...prev, [selected]: { turns, ...constrain(item, p.x, p.z, turns, snap) } };
    });
  }, [selected, snap]);

  const optimize = () => {
    setOptimizing(true);
    // Yield a frame so the button can show its busy state before the search runs.
    window.setTimeout(() => {
      const next = optimizeLayout(items, layout, opts);
      const moved = items.filter((i) => {
        const a = layout[i.id];
        const b = next[i.id];
        return a && b && (Math.abs(a.x - b.x) > 0.01 || Math.abs(a.z - b.z) > 0.01 || a.turns !== b.turns);
      }).length;
      setUndoLayout(layout);
      setLayout(next);
      setLastMoved(moved);
      setOptimizing(false);
    }, 30);
  };

  const toggleAddition = (id: SuggestionId) => {
    const on = !added[id];
    setAdded((prev) => ({ ...prev, [id]: on }));
    if (!on) {
      if (selected === id) setSelected(null);
      return;
    }
    if (id === "uplight") {
      setLayout((prev) => ({ ...prev, uplight: darkestCorner(items, prev) }));
    } else if (id === "areaRug") {
      const rug = ADDITIONS.find((a) => a.id === "areaRug");
      if (rug) {
        const spot = bestRugPlacement([...items, rug], layout, opts);
        if (spot) setLayout((prev) => ({ ...prev, areaRug: spot }));
      }
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "r" || e.key === "R") rotateSelected();
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rotateSelected]);

  const selectedItem = items.find((f) => f.id === selected);

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-[#111214] text-white">
      <Canvas
        shadows="percentage"
        dpr={[1, 2]}
        camera={{ position: ORBIT_POS.toArray(), fov: 45, near: 0.05, far: 60 }}
        onPointerMissed={() => setSelected(null)}
        className="touch-none"
      >
        <color attach="background" args={["#111214"]} />
        <hemisphereLight args={["#fff4e0", "#4a3d30", 0.6]} />
        <ambientLight intensity={0.18} />
        {/* Daylight through the north window; the curtains cast the shadow edges. */}
        <directionalLight
          position={[-0.3, 3.4, -4.6]}
          intensity={1.7}
          color="#fff1d6"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-3}
          shadow-camera-right={3}
          shadow-camera-top={3}
          shadow-camera-bottom={-3}
          shadow-camera-near={0.5}
          shadow-camera-far={12}
          shadow-bias={-0.0004}
          shadow-normalBias={0.02}
        />
        <pointLight position={[-0.05, 1.6, -1.55]} intensity={1.4} distance={5} decay={2} color="#fff0d2" />
        <pointLight position={[0.5, ROOM.height - 0.2, 0.3]} intensity={0.9} distance={6} decay={2} color="#ffe9c7" />

        <RoomShell turf={!added.areaRug} shelf={shelf} colors={colors} closetOpen={closetOpen} />
        {snap && <SnapGrid />}
        {(showZones || dragging) && <ZonesOverlay reachable={analysis.reachable} />}

        {items.map((item) => (
          <DraggableItem
            key={item.id}
            item={item}
            placement={layout[item.id]}
            report={analysis.reports[item.id]}
            selected={selected === item.id}
            showDims={showDims}
            accentTextiles={added.accentTextiles}
            colors={colors}
            onSelect={setSelected}
            onMove={move}
            onDragChange={setDragging}
          />
        ))}

        <OrbitControls
          makeDefault
          enableDamping
          dampingFactor={0.08}
          enableRotate={view === "orbit"}
          minDistance={1.5}
          maxDistance={14}
          maxPolarAngle={Math.PI / 2 - 0.06}
          target={ORBIT_TARGET.toArray()}
        />
        <CameraRig view={view} />
      </Canvas>

      <div className="pointer-events-none absolute top-4 left-4 sm:top-6 sm:left-6">
        <h1 className="text-sm font-semibold tracking-tight text-white/90">Vince&apos;s Room</h1>
        <p className="mt-0.5 font-mono text-[11px] text-white/45">
          {ROOM.width.toFixed(1)} × {ROOM.depth.toFixed(1)} × {ROOM.height.toFixed(2)} m
        </p>
      </div>

      <DesignPanel
        open={panelOpen}
        onOpenChange={setPanelOpen}
        analysis={analysis}
        selected={selected ? (analysis.reports[selected] ?? null) : null}
        suggestions={suggestions}
        added={added}
        onToggleAddition={toggleAddition}
        colors={colors}
        onColorChange={(target, hex) => setColors((prev) => ({ ...prev, [target]: hex }))}
        onResetColors={() => setColors(DEFAULT_COLORS)}
        onOptimize={optimize}
        optimizing={optimizing}
        lastMoved={lastMoved}
        onUndo={
          undoLayout
            ? () => {
                setLayout(undoLayout);
                manualEdit();
              }
            : null
        }
        showZones={showZones}
        onToggleZones={() => setShowZones((s) => !s)}
      />

      <div className="absolute inset-x-0 bottom-4 flex flex-col items-center gap-2 px-3 sm:bottom-6">
        <p className="pointer-events-none text-center text-[11px] text-white/45">
          {selectedItem
            ? `${selectedItem.label} · drag to move · R to rotate · Esc to deselect`
            : "Drag furniture to rearrange · right-drag to pan · scroll to zoom"}
        </p>
        <div className="flex items-center gap-0.5 rounded-full border border-white/10 bg-neutral-900/70 p-1 shadow-2xl shadow-black/50 backdrop-blur-xl">
          <ToolButton label={view === "orbit" ? "Orbit" : "Top-down"} onClick={() => setView(view === "orbit" ? "top" : "orbit")}>
            {view === "orbit" ? <Orbit className="size-4" /> : <ScanEye className="size-4" />}
          </ToolButton>
          <div className="mx-1 h-5 w-px bg-white/10" />
          <ToolButton label="Snap" active={snap} onClick={() => setSnap((s) => !s)}>
            <Grid3x3 className="size-4" />
          </ToolButton>
          <ToolButton label="Dimensions" active={showDims} onClick={() => setShowDims((s) => !s)}>
            <Ruler className="size-4" />
          </ToolButton>
          <ToolButton label="Rotate" disabled={!selected} onClick={rotateSelected}>
            <RotateCw className="size-4" />
          </ToolButton>
          <ToolButton label="Closet" active={closetOpen} onClick={() => setClosetOpen((o) => !o)}>
            {closetOpen ? <DoorOpen className="size-4" /> : <DoorClosed className="size-4" />}
          </ToolButton>
          <div className="mx-1 h-5 w-px bg-white/10" />
          <ToolButton
            label="Reset"
            onClick={() => {
              setLayout((prev) => ({ ...prev, ...INITIAL_LAYOUT }));
              setSelected(null);
              manualEdit();
            }}
          >
            <RotateCcw className="size-4" />
          </ToolButton>
        </div>
      </div>
    </div>
  );
}
