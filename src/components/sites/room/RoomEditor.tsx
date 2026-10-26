"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentRef } from "react";
import { Canvas, useFrame, useThree, type RootState, type ThreeEvent } from "@react-three/fiber";
import { Edges, Html, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Grid3x3, Orbit, RotateCcw, RotateCw, Ruler, ScanEye } from "lucide-react";

import { cn } from "@/lib/utils";

import { FurnitureModel } from "./FurnitureModels";
import { RoomShell } from "./RoomShell";
import {
  FURNITURE,
  GRID_STEP,
  INITIAL_LAYOUT,
  ROOM,
  constrain,
  type FurnitureItem,
  type Layout,
  type Placement,
} from "./roomData";

type View = "orbit" | "top";
type Controls = ComponentRef<typeof OrbitControls>;

const STORAGE_KEY = "room-layout-v1";
const FLOOR = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const ORBIT_POS = new THREE.Vector3(3.4, 3.6, 4.6);
const ORBIT_TARGET = new THREE.Vector3(-0.1, 0.7, -0.2);
const TOP_POS = new THREE.Vector3(0, 9.2, 0.01);
const TOP_TARGET = new THREE.Vector3(0, 0, 0);

function loadLayout(): Layout {
  const layout: Layout = { ...INITIAL_LAYOUT };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as Partial<Layout> | null;
    if (saved) {
      for (const item of FURNITURE) {
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

const cm = (m: number) => Math.round(m * 100);

function setControlsEnabled(get: () => RootState, enabled: boolean) {
  const controls = get().controls as Controls | null;
  if (controls) controls.enabled = enabled;
}

function DraggableItem({
  item,
  placement,
  selected,
  showDims,
  onSelect,
  onMove,
}: {
  item: FurnitureItem;
  placement: Placement;
  selected: boolean;
  showDims: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, z: number) => void;
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
  };

  const { w, d, h } = item.size;

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
      <FurnitureModel kind={item.kind} />

      {selected && (
        <>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.013, 0]} raycast={() => null}>
            <planeGeometry args={[w + 0.08, d + 0.08]} />
            <meshBasicMaterial color="#7dd3fc" transparent opacity={0.22} depthWrite={false} />
          </mesh>
          <mesh position={[0, h / 2 + 0.01, 0]} raycast={() => null}>
            <boxGeometry args={[w + 0.03, h + 0.02, d + 0.03]} />
            <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            <Edges color="#7dd3fc" />
          </mesh>
        </>
      )}

      {(selected || showDims) && (
        <Html center position={[0, h + 0.16, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
          <div
            className={cn(
              "whitespace-nowrap rounded-md px-2 py-1 text-center font-mono text-[10px] leading-tight backdrop-blur-md",
              selected ? "bg-sky-400/90 text-slate-950" : "bg-black/55 text-white/85",
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
  const [selected, setSelected] = useState<string | null>(null);
  const [snap, setSnap] = useState(true);
  const [showDims, setShowDims] = useState(false);
  const [view, setView] = useState<View>("orbit");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
  }, [layout]);

  const move = useCallback(
    (id: string, x: number, z: number) => {
      const item = FURNITURE.find((f) => f.id === id);
      if (!item) return;
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
    const item = FURNITURE.find((f) => f.id === selected);
    if (!item) return;
    setLayout((prev) => {
      const p = prev[selected];
      const turns = (p.turns + 1) % 4;
      return { ...prev, [selected]: { turns, ...constrain(item, p.x, p.z, turns, snap) } };
    });
  }, [selected, snap]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "r" || e.key === "R") rotateSelected();
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rotateSelected]);

  const selectedItem = FURNITURE.find((f) => f.id === selected);

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

        <RoomShell />
        {snap && <SnapGrid />}

        {FURNITURE.map((item) => (
          <DraggableItem
            key={item.id}
            item={item}
            placement={layout[item.id]}
            selected={selected === item.id}
            showDims={showDims}
            onSelect={setSelected}
            onMove={move}
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

      <div className="pointer-events-none absolute left-4 top-4 sm:left-6 sm:top-6">
        <h1 className="text-sm font-semibold tracking-tight text-white/90">Vince&apos;s Room</h1>
        <p className="mt-0.5 font-mono text-[11px] text-white/45">
          {ROOM.width.toFixed(1)} × {ROOM.depth.toFixed(1)} × {ROOM.height.toFixed(2)} m
        </p>
      </div>

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
          <div className="mx-1 h-5 w-px bg-white/10" />
          <ToolButton
            label="Reset"
            onClick={() => {
              setLayout({ ...INITIAL_LAYOUT });
              setSelected(null);
            }}
          >
            <RotateCcw className="size-4" />
          </ToolButton>
        </div>
      </div>
    </div>
  );
}
