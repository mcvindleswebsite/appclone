"use client";

import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import type { ShelfSpot } from "./designEngine";
import type { RoomColors } from "./roomColors";
import { COLORS, ROOM } from "./roomData";
import {
  blindsTexture,
  chalkboardTexture,
  jerseyTexture,
  noiseTexture,
  pennantTexture,
  plateTexture,
  xmenPosterTexture,
} from "./textures";

const W = ROOM.width;
const D = ROOM.depth;
const H = ROOM.height;

const tmp = new THREE.Vector3();

// Walls and curtains follow the color picker; every wall reads the same paint.
const Paint = createContext<Pick<RoomColors, "walls" | "curtains">>({ walls: COLORS.wall, curtains: COLORS.curtain });

interface Opening {
  /** Center along the wall, in wall space. */
  x: number;
  w: number;
  h: number;
}

/** The wall face from floor to ceiling, with the opening cut out down to the floor. */
function wallGeometry(width: number, opening?: Opening) {
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  if (opening) {
    const x0 = opening.x - opening.w / 2;
    const x1 = opening.x + opening.w / 2;
    shape.lineTo(x0, 0);
    shape.lineTo(x0, opening.h);
    shape.lineTo(x1, opening.h);
    shape.lineTo(x1, 0);
  }
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, H);
  shape.lineTo(-width / 2, H);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/**
 * A wall whose local +z faces into the room. Children are placed in wall space:
 * x along the wall, y up from the floor, z out from the wall surface.
 * The whole wall (and anything mounted on it) hides when the camera is behind it.
 */
function Wall({
  position,
  rotationY,
  width,
  opening,
  children,
}: {
  position: [number, number, number];
  rotationY: number;
  width: number;
  /** A doorway cut through the wall, from the floor up. */
  opening?: Opening;
  children?: ReactNode;
}) {
  const { walls } = useContext(Paint);
  const geometry = useMemo(() => wallGeometry(width, opening), [width, opening]);
  // The baseboard runs either side of an opening.
  const baseboards = useMemo<[number, number][]>(() => {
    if (!opening) return [[0, width]];
    const x0 = opening.x - opening.w / 2;
    const x1 = opening.x + opening.w / 2;
    return [
      [(-width / 2 + x0) / 2, x0 + width / 2],
      [(x1 + width / 2) / 2, width / 2 - x1],
    ];
  }, [width, opening]);
  const ref = useRef<THREE.Group>(null);
  const normal = useMemo(() => new THREE.Vector3(Math.sin(rotationY), 0, Math.cos(rotationY)), [rotationY]);
  const origin = useMemo(() => new THREE.Vector3(...position), [position]);

  useFrame(({ camera }) => {
    if (!ref.current) return;
    ref.current.visible = tmp.copy(camera.position).sub(origin).dot(normal) > 0;
  });

  return (
    <group ref={ref} position={position} rotation={[0, rotationY, 0]}>
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial color={walls} roughness={0.95} />
      </mesh>
      {/* Baseboard */}
      {baseboards.map(([x, w]) => (
        <mesh key={x} position={[x, 0.045, 0.006]} receiveShadow>
          <boxGeometry args={[w, 0.09, 0.012]} />
          <meshStandardMaterial color={COLORS.trim} roughness={0.6} />
        </mesh>
      ))}
      {children}
    </group>
  );
}

function Ceiling() {
  const ref = useRef<THREE.Group>(null);
  const tex = useMemo(() => noiseTexture(COLORS.ceiling, ["#f7f5ef", "#dcd8ce", "#e6e2d8"], 3, [6, 6]), []);
  useFrame(({ camera }) => {
    if (ref.current) ref.current.visible = camera.position.y < H;
  });
  return (
    <group ref={ref}>
      <mesh position={[0, H, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={tex} roughness={1} />
      </mesh>
      {/* Recessed can lights seen in IMG_7442 / IMG_7444 */}
      {[
        [0.15, -0.35],
        [0.9, 0.9],
      ].map(([x, z]) => (
        <mesh key={`${x}-${z}`} position={[x, H - 0.002, z]} rotation={[Math.PI / 2, 0, 0]}>
          <circleGeometry args={[0.07, 24]} />
          <meshStandardMaterial color="#d8d2c2" emissive="#fff3d6" emissiveIntensity={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function Floor({ turf }: { turf: boolean }) {
  const carpet = useMemo(
    () => noiseTexture(COLORS.carpet, ["#4a3d30", "#6a5947", "#544636", "#72604c"], 11, [8, 9]),
    [],
  );
  const turfTex = useMemo(
    () => noiseTexture(COLORS.turf, ["#3c7a2c", "#24501b", "#46862f", "#2a5a1f"], 23, [6, 6], true),
    [],
  );

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={carpet} roughness={1} />
      </mesh>
      {turf && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.45, 0.004, -0.4]} receiveShadow>
          <planeGeometry args={[2.3, 2.2]} />
          <meshStandardMaterial map={turfTex} roughness={1} />
        </mesh>
      )}
    </group>
  );
}

function Picture({
  texture,
  size,
  position,
  transparent = false,
}: {
  texture: THREE.Texture;
  size: [number, number];
  position: [number, number, number];
  transparent?: boolean;
}) {
  return (
    <mesh position={position} castShadow={!transparent}>
      <planeGeometry args={size} />
      <meshStandardMaterial map={texture} transparent={transparent} alphaTest={transparent ? 0.5 : 0} roughness={0.8} />
    </mesh>
  );
}

function FloatingShelf({ length }: { length: number }) {
  // Suggested addition: oak shelf with a small plant and a gold-spined book.
  return (
    <group position={[0, 1.45, 0]}>
      <mesh position={[0, 0, 0.11]} castShadow receiveShadow>
        <boxGeometry args={[length, 0.04, 0.22]} />
        <meshStandardMaterial color="#b08a5a" roughness={0.55} />
      </mesh>
      <mesh position={[-length / 2 + 0.12, 0.08, 0.11]} castShadow>
        <cylinderGeometry args={[0.055, 0.045, 0.12, 20]} />
        <meshStandardMaterial color="#efe9dc" roughness={0.7} />
      </mesh>
      <mesh position={[-length / 2 + 0.12, 0.18, 0.11]} castShadow>
        <sphereGeometry args={[0.075, 16, 12]} />
        <meshStandardMaterial color="#4f7a3a" roughness={0.9} />
      </mesh>
      <mesh position={[length / 2 - 0.16, 0.1, 0.11]} castShadow>
        <boxGeometry args={[0.16, 0.16, 0.12]} />
        <meshStandardMaterial color={COLORS.bocaGold} roughness={0.6} />
      </mesh>
      <mesh position={[length / 2 - 0.3, 0.12, 0.13]} castShadow>
        <boxGeometry args={[0.1, 0.2, 0.02]} />
        <meshStandardMaterial color={COLORS.bocaNavy} roughness={0.6} />
      </mesh>
    </group>
  );
}

function NorthWall({ shelf }: { shelf: ShelfSpot | null }) {
  // Window wall (IMG_7442): blinds, olive curtains, Boca pennant, X-Men poster.
  const blinds = useMemo(() => blindsTexture(), []);
  const pennant = useMemo(() => pennantTexture(), []);
  const poster = useMemo(() => xmenPosterTexture(), []);
  const winX = -0.05;
  const { curtains } = useContext(Paint);
  return (
    <Wall position={[0, 0, -D / 2]} rotationY={0} width={W}>
      <mesh position={[winX, 1.5, 0.004]}>
        <planeGeometry args={[0.95, 1.1]} />
        <meshBasicMaterial color={COLORS.windowGlow} toneMapped={false} />
      </mesh>
      <mesh position={[winX, 1.5, 0.012]}>
        <planeGeometry args={[0.9, 1.05]} />
        <meshStandardMaterial map={blinds} transparent opacity={0.55} emissive="#fff0cf" emissiveIntensity={0.35} />
      </mesh>
      <mesh position={[winX, 0.93, 0.03]} castShadow>
        <boxGeometry args={[1.05, 0.03, 0.06]} />
        <meshStandardMaterial color={COLORS.trim} />
      </mesh>
      <mesh position={[winX, 2.17, 0.09]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.012, 0.012, 1.75, 12]} />
        <meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.4} />
      </mesh>
      {[winX - 0.62, winX + 0.66].map((cx, i) => (
        <group key={cx} position={[cx, 1.2, 0.09]}>
          {Array.from({ length: 6 }, (_, k) => (
            <mesh key={k} position={[(k - 2.5) * 0.085, 0, Math.sin(k * 1.7 + i) * 0.015]} castShadow receiveShadow>
              <cylinderGeometry args={[0.05, 0.055, 1.94, 10, 1, true]} />
              <meshStandardMaterial color={curtains} roughness={0.95} side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      ))}
      <Picture texture={pennant} size={[0.4, 0.48]} position={[0.92, 1.58, 0.01]} transparent />
      <Picture texture={poster} size={[0.4, 0.54]} position={[1.36, 1.68, 0.01]} />
      {shelf?.wall === "north" && (
        <group position={[shelf.localX, 0, 0]}>
          <FloatingShelf length={shelf.length} />
        </group>
      )}
    </Wall>
  );
}

// The closet doorway on the east wall, and how deep the closet runs behind it.
const CLOSET: Opening = { x: -0.25, w: 1.8, h: 2.05 };
const CLOSET_DEPTH = 0.6;

// Hanging clothes, left to right: [width along the rod, length, color].
const CLOTHES: [number, number, string][] = [
  [0.05, 0.95, "#2c3a5c"],
  [0.05, 0.9, "#1f3a86"],
  [0.04, 0.7, "#f2b630"],
  [0.05, 0.72, "#e8e4da"],
  [0.04, 0.68, "#7a2e2a"],
  [0.06, 1.05, "#3f4a2c"],
  [0.05, 0.75, "#9aa3ad"],
  [0.04, 0.7, "#1b1b1d"],
  [0.05, 0.72, "#c9b48a"],
  [0.06, 1.0, "#4a3a2e"],
  [0.04, 0.7, "#6b8fb3"],
];

// Each piece's center along the rod, packed from the left end of the closet with a small gap.
const CLOTHES_X = CLOTHES.reduce<number[]>((xs, [cw], i) => {
  const prev = i ? xs[i - 1] + CLOTHES[i - 1][0] / 2 + 0.055 : CLOSET.x - CLOSET.w / 2 + 0.12;
  return [...xs, prev + cw / 2];
}, []);

/** The closet behind the chalkboard doors, built in east-wall space (z < 0 is behind the wall). */
function ClosetInterior() {
  const { x, w, h } = CLOSET;
  const back = -CLOSET_DEPTH;
  const rodY = 1.68;
  const rodZ = back / 2;
  return (
    <group>
      {/* Back, sides, ceiling and carpeted floor */}
      <mesh position={[x, h / 2, back]} receiveShadow>
        <planeGeometry args={[w, h]} />
        <meshStandardMaterial color="#ddd2b4" roughness={0.95} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[x + (s * w) / 2, h / 2, back / 2]} rotation={[0, (-s * Math.PI) / 2, 0]} receiveShadow>
          <planeGeometry args={[CLOSET_DEPTH, h]} />
          <meshStandardMaterial color="#d6caab" roughness={0.95} />
        </mesh>
      ))}
      <mesh position={[x, h, back / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[w, CLOSET_DEPTH]} />
        <meshStandardMaterial color="#e4ddc9" roughness={0.95} />
      </mesh>
      <mesh position={[x, 0.004, back / 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w, CLOSET_DEPTH]} />
        <meshStandardMaterial color={COLORS.carpet} roughness={1} />
      </mesh>

      {/* Shelf above the rod, with storage bins and a cap */}
      <mesh position={[x, 1.86, back + 0.17]} castShadow receiveShadow>
        <boxGeometry args={[w - 0.02, 0.025, 0.34]} />
        <meshStandardMaterial color={COLORS.trim} roughness={0.6} />
      </mesh>
      {[
        [-0.6, 0.38, 0.16, "#8b7355"],
        [-0.18, 0.34, 0.14, "#4f5a66"],
        [0.4, 0.3, 0.12, "#a89574"],
      ].map(([dx, bw, bh, color]) => (
        <mesh key={String(dx)} position={[x + Number(dx), 1.873 + Number(bh) / 2, back + 0.17]} castShadow>
          <boxGeometry args={[Number(bw), Number(bh), 0.28]} />
          <meshStandardMaterial color={String(color)} roughness={0.85} />
        </mesh>
      ))}
      <mesh position={[x + 0.72, 1.91, back + 0.2]} castShadow>
        <sphereGeometry args={[0.07, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={COLORS.bocaNavy} roughness={0.8} />
      </mesh>

      {/* Rod and hanging clothes */}
      <mesh position={[x, rodY, rodZ]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.012, 0.012, w - 0.02, 10]} />
        <meshStandardMaterial color="#b8b8b8" metalness={0.8} roughness={0.3} />
      </mesh>
      {CLOTHES.map(([cw, len, color], i) => (
        <group key={i} position={[CLOTHES_X[i], rodY, rodZ]}>
          <mesh position={[0, -0.03, 0]}>
            <boxGeometry args={[0.008, 0.05, 0.36]} />
            <meshStandardMaterial color="#6b5a45" />
          </mesh>
          <mesh position={[0, -0.06 - len / 2, 0]} castShadow receiveShadow>
            <boxGeometry args={[cw, len, 0.44]} />
            <meshStandardMaterial color={color} roughness={0.95} />
          </mesh>
        </group>
      ))}

      {/* Shoes on the floor */}
      {[-0.7, -0.5, 0.3, 0.5].map((dx, i) => (
        <group key={dx} position={[x + dx, 0, back + 0.2]}>
          {[-0.05, 0.05].map((o) => (
            <mesh key={o} position={[o, 0.04, 0]} castShadow>
              <boxGeometry args={[0.09, 0.08, 0.28]} />
              <meshStandardMaterial color={["#f0f0f0", "#1b1b1d", "#7a5a3a", "#c22c2c"][i]} roughness={0.7} />
            </mesh>
          ))}
        </group>
      ))}

      <pointLight position={[x, h - 0.15, back / 2]} intensity={0.5} distance={2.2} decay={2} color="#ffe9c7" />
    </group>
  );
}

function EastWall({ shelf, closetOpen }: { shelf: ShelfSpot | null; closetOpen: boolean }) {
  // Sliding closet with chalkboard-painted doors (IMG_7444); the doors come off to show inside.
  const board = useMemo(() => chalkboardTexture(), []);
  const { x, w, h } = CLOSET;
  return (
    <Wall position={[W / 2, 0, 0]} rotationY={-Math.PI / 2} width={D} opening={closetOpen ? CLOSET : undefined}>
      {closetOpen ? (
        <>
          {/* Door casing around the open doorway */}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[x + s * (w / 2 + 0.02), h / 2 + 0.035, 0.01]}>
              <boxGeometry args={[0.04, h + 0.07, 0.02]} />
              <meshStandardMaterial color={COLORS.trim} />
            </mesh>
          ))}
          <mesh position={[x, h + 0.035, 0.01]}>
            <boxGeometry args={[w + 0.08, 0.07, 0.02]} />
            <meshStandardMaterial color={COLORS.trim} />
          </mesh>
          <ClosetInterior />
        </>
      ) : (
        <>
          <mesh position={[x, 1.06, 0.01]}>
            <planeGeometry args={[1.88, 2.12]} />
            <meshStandardMaterial color={COLORS.trim} />
          </mesh>
          <mesh position={[x, 1.03, 0.025]} receiveShadow>
            <boxGeometry args={[w, h, 0.02]} />
            <meshStandardMaterial map={board} roughness={0.9} />
          </mesh>
          <mesh position={[x, 1.03, 0.037]}>
            <boxGeometry args={[0.02, h, 0.004]} />
            <meshStandardMaterial color="#cfcac0" metalness={0.4} />
          </mesh>
        </>
      )}
      {shelf?.wall === "east" && (
        <group position={[shelf.localX, 0, 0]}>
          <FloatingShelf length={shelf.length} />
        </group>
      )}
    </Wall>
  );
}

function SouthWall({ shelf }: { shelf: ShelfSpot | null }) {
  // Entry door + two floating espresso shelves above the bed (IMG_7443).
  // On this wall local x = −world x.
  const plate = useMemo(() => plateTexture(), []);
  const doorX = -0.95;
  const shelfX = 0.15;
  return (
    <Wall position={[0, 0, D / 2]} rotationY={Math.PI} width={W}>
      <mesh position={[doorX, 1.02, 0.01]}>
        <boxGeometry args={[0.88, 2.08, 0.02]} />
        <meshStandardMaterial color={COLORS.trim} />
      </mesh>
      <mesh position={[doorX, 1.0, 0.025]} receiveShadow>
        <boxGeometry args={[0.8, 2.0, 0.03]} />
        <meshStandardMaterial color="#f6f4ee" roughness={0.5} />
      </mesh>
      {[
        [-0.17, 1.55],
        [0.17, 1.55],
        [-0.17, 0.95],
        [0.17, 0.95],
        [-0.17, 0.38],
        [0.17, 0.38],
      ].map(([px, py]) => (
        <mesh key={`${px}-${py}`} position={[doorX + px, py, 0.043]}>
          <boxGeometry args={[0.28, 0.5, 0.008]} />
          <meshStandardMaterial color="#ffffff" roughness={0.45} />
        </mesh>
      ))}
      <mesh position={[doorX + 0.32, 1.0, 0.06]}>
        <sphereGeometry args={[0.028, 12, 12]} />
        <meshStandardMaterial color="#b9a46a" metalness={0.8} roughness={0.3} />
      </mesh>

      {[1.55, 1.18].map((y) => (
        <mesh key={y} position={[shelfX, y, 0.12]} castShadow receiveShadow>
          <boxGeometry args={[0.95, 0.05, 0.24]} />
          <meshStandardMaterial color="#2a1d18" roughness={0.6} />
        </mesh>
      ))}
      {/* Top shelf: boxed collectibles and two Funko figures */}
      {[
        [-0.2, "#2f3b2f", 0.18],
        [-0.02, "#3c3c58", 0.22],
        [0.32, "#4a4426", 0.16],
      ].map(([x, color, h]) => (
        <mesh key={String(x)} position={[shelfX + Number(x), 1.575 + Number(h) / 2, 0.12]} castShadow>
          <boxGeometry args={[0.13, Number(h), 0.03]} />
          <meshStandardMaterial color={String(color)} />
        </mesh>
      ))}
      {[0.06, 0.13].map((x) => (
        <mesh key={x} position={[shelfX + x, 1.62, 0.13]} castShadow>
          <cylinderGeometry args={[0.025, 0.025, 0.08, 12]} />
          <meshStandardMaterial color={x < 0.1 ? "#f0f0f0" : "#c22c2c"} />
        </mesh>
      ))}
      {/* License plate under the top shelf and a framed print on the lower one */}
      <mesh position={[shelfX - 0.15, 1.46, 0.02]}>
        <planeGeometry args={[0.36, 0.085]} />
        <meshStandardMaterial map={plate} roughness={0.4} metalness={0.2} />
      </mesh>
      <mesh position={[shelfX + 0.18, 1.33, 0.04]}>
        <boxGeometry args={[0.24, 0.26, 0.015]} />
        <meshStandardMaterial color="#8fa6b0" />
      </mesh>
      {shelf?.wall === "south" && (
        <group position={[shelf.localX, 0, 0]}>
          <FloatingShelf length={shelf.length} />
        </group>
      )}
    </Wall>
  );
}

function WestWall({ shelf }: { shelf: ShelfSpot | null }) {
  // Quilmes / Maradona jersey (IMG_7442). On this wall local x = −world z.
  const jersey = useMemo(() => jerseyTexture(), []);
  return (
    <Wall position={[-W / 2, 0, 0]} rotationY={Math.PI / 2} width={D}>
      <Picture texture={jersey} size={[0.6, 0.66]} position={[-0.15, 1.72, 0.012]} transparent />
      {shelf?.wall === "west" && (
        <group position={[shelf.localX, 0, 0]}>
          <FloatingShelf length={shelf.length} />
        </group>
      )}
    </Wall>
  );
}

export function RoomShell({
  turf,
  shelf,
  colors,
  closetOpen,
}: {
  turf: boolean;
  shelf: ShelfSpot | null;
  colors: RoomColors;
  closetOpen: boolean;
}) {
  const paint = useMemo(() => ({ walls: colors.walls, curtains: colors.curtains }), [colors.walls, colors.curtains]);
  return (
    <Paint.Provider value={paint}>
      <Floor turf={turf} />
      <Ceiling />
      <NorthWall shelf={shelf} />
      <EastWall shelf={shelf} closetOpen={closetOpen} />
      <SouthWall shelf={shelf} />
      <WestWall shelf={shelf} />
    </Paint.Provider>
  );
}
