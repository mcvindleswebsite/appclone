"use client";

import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";

import { COLORS, type FurnitureKind } from "./roomData";

type Vec3 = [number, number, number];

// Models are built in local space: footprint centered on the origin, floor at
// y = 0, front facing +z. Sizes mirror the `size` values in roomData.ts.

function Block({
  args,
  position,
  color,
  rotation,
  roughness = 0.8,
  metalness = 0,
}: {
  args: Vec3;
  position: Vec3;
  color: string;
  rotation?: Vec3;
  roughness?: number;
  metalness?: number;
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <boxGeometry args={args} />
      <meshStandardMaterial color={color} roughness={roughness} metalness={metalness} />
    </mesh>
  );
}

function Soft({
  args,
  position,
  color,
  rotation,
  radius = 0.04,
}: {
  args: Vec3;
  position: Vec3;
  color: string;
  rotation?: Vec3;
  radius?: number;
}) {
  return (
    <RoundedBox args={args} radius={radius} smoothness={3} position={position} rotation={rotation} castShadow receiveShadow>
      <meshStandardMaterial color={color} roughness={0.95} />
    </RoundedBox>
  );
}

function Lump({ position, scale, color, rotation }: { position: Vec3; scale: Vec3; color: string; rotation?: Vec3 }) {
  // Squash height so piles read as fabric rather than eggs.
  return (
    <mesh position={position} scale={[scale[0] * 1.1, scale[1] * 0.6, scale[2] * 1.1]} rotation={rotation} castShadow receiveShadow>
      <icosahedronGeometry args={[1, 2]} />
      <meshStandardMaterial color={color} roughness={1} />
    </mesh>
  );
}

const CAN_COLORS = ["#2f8a3c", "#c42127", "#c9ccd0", "#2f8a3c", "#e1b62b", "#c42127", "#3a6fb5"];

function Cans({ origin, cols, rows, step = 0.072 }: { origin: Vec3; cols: number; rows: number; step?: number }) {
  const cans = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      cans.push(
        <mesh
          key={i}
          position={[origin[0] + c * step + (r % 2) * 0.02, origin[1] + 0.061, origin[2] + r * step]}
          castShadow
        >
          <cylinderGeometry args={[0.033, 0.033, 0.122, 14]} />
          <meshStandardMaterial color={CAN_COLORS[(i * 3) % CAN_COLORS.length]} metalness={0.55} roughness={0.35} />
        </mesh>,
      );
    }
  }
  return <group>{cans}</group>;
}

function Bed() {
  // 1.91 × 1.37 full bed, headboard end at local −x (against the west wall).
  return (
    <group>
      <Block args={[1.91, 0.2, 1.37]} position={[0, 0.1, 0]} color="#2a2a2d" />
      <Soft args={[1.88, 0.24, 1.35]} position={[0, 0.32, 0]} color={COLORS.sheets} radius={0.06} />
      {/* Beige quilted comforter, pulled toward the foot and draped over the edges */}
      <Soft args={[1.4, 0.07, 1.43]} position={[0.25, 0.47, 0.01]} color={COLORS.comforter} rotation={[0, 0.03, 0]} />
      <Block args={[1.4, 0.36, 0.02]} position={[0.25, 0.3, 0.725]} color={COLORS.comforter} roughness={1} />
      <Block args={[0.02, 0.36, 1.4]} position={[0.95, 0.3, 0.01]} color={COLORS.comforter} roughness={1} />
      {/* Rumpled sage sheet */}
      <Soft args={[0.75, 0.08, 0.85]} position={[-0.25, 0.5, -0.2]} color="#b4c2b3" rotation={[0, -0.2, 0.02]} />
      {/* Pillows */}
      <Soft args={[0.42, 0.15, 0.62]} position={[-0.7, 0.53, -0.33]} color="#b7c4b9" radius={0.06} rotation={[0, 0.08, 0]} />
      <Soft args={[0.4, 0.13, 0.6]} position={[-0.72, 0.52, 0.32]} color="#e5dccb" radius={0.06} rotation={[0, -0.05, 0]} />
      {/* Backpack, clothes and a teal plush along the foot/wall side */}
      <Lump position={[0.55, 0.56, 0.4]} scale={[0.26, 0.1, 0.2]} color="#1f1f22" />
      <Lump position={[0.78, 0.55, 0.15]} scale={[0.16, 0.08, 0.14]} color="#4b5a6a" />
      <Lump position={[-0.35, 0.56, 0.52]} scale={[0.15, 0.08, 0.12]} color="#2bb0a6" />
      <mesh position={[0.05, 0.61, 0.5]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 0.2, 14]} />
        <meshStandardMaterial color="#3a1410" transparent opacity={0.9} roughness={0.2} />
      </mesh>
    </group>
  );
}

function Nightstand() {
  // Low dark-wood console: navy lamp, Echo, rows of cans, gold World Cup replica.
  const top = 0.6;
  return (
    <group>
      <Block args={[1.0, 0.04, 0.35]} position={[0, top - 0.02, 0]} color={COLORS.darkWood} roughness={0.6} />
      {[
        [-0.47, -0.15],
        [0.47, -0.15],
        [-0.47, 0.15],
        [0.47, 0.15],
      ].map(([x, z]) => (
        <Block key={`${x}-${z}`} args={[0.04, top - 0.04, 0.04]} position={[x, (top - 0.04) / 2, z]} color={COLORS.darkWood} />
      ))}
      <Block args={[0.94, 0.025, 0.3]} position={[0, 0.16, 0]} color={COLORS.darkWood} />
      {/* Lamp */}
      <mesh position={[-0.38, top + 0.015, -0.04]} castShadow>
        <cylinderGeometry args={[0.06, 0.07, 0.03, 20]} />
        <meshStandardMaterial color="#9a9a9a" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[-0.38, top + 0.15, -0.04]}>
        <cylinderGeometry args={[0.008, 0.008, 0.25, 8]} />
        <meshStandardMaterial color="#b0b0b0" metalness={0.7} />
      </mesh>
      <mesh position={[-0.38, top + 0.34, -0.04]} castShadow>
        <cylinderGeometry args={[0.12, 0.13, 0.2, 24, 1, true]} />
        <meshStandardMaterial color={COLORS.navy} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* Echo speaker */}
      <mesh position={[-0.2, top + 0.075, 0.07]} castShadow>
        <cylinderGeometry args={[0.044, 0.044, 0.15, 20]} />
        <meshStandardMaterial color="#141414" roughness={0.6} />
      </mesh>
      <Cans origin={[-0.1, top, -0.11]} cols={6} rows={3} />
      {/* Trophy */}
      <mesh position={[0.42, top + 0.06, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.045, 0.12, 16]} />
        <meshStandardMaterial color="#2f6a3a" />
      </mesh>
      <mesh position={[0.42, top + 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.03, 0.16, 16]} />
        <meshStandardMaterial color={COLORS.gold} metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh position={[0.42, top + 0.31, 0]} castShadow>
        <sphereGeometry args={[0.055, 20, 16]} />
        <meshStandardMaterial color={COLORS.gold} metalness={0.85} roughness={0.25} />
      </mesh>
    </group>
  );
}

function Purifier() {
  return (
    <group>
      <Soft args={[0.28, 0.26, 0.28]} position={[0, 0.13, 0]} color="#3a78c4" radius={0.03} />
      <Soft args={[0.28, 0.24, 0.28]} position={[0, 0.38, 0]} color="#eef0f1" radius={0.03} />
      <mesh position={[0, 0.501, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.1, 24]} />
        <meshStandardMaterial color="#c7cbcf" />
      </mesh>
    </group>
  );
}

function Cap({ position, rotation, crown, brim }: { position: Vec3; rotation: Vec3; crown: string; brim: string }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh castShadow>
        <sphereGeometry args={[0.085, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshStandardMaterial color={crown} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0, 0.11]} castShadow>
        <boxGeometry args={[0.15, 0.01, 0.09]} />
        <meshStandardMaterial color={brim} />
      </mesh>
    </group>
  );
}

function FloorLamp() {
  return (
    <group>
      <mesh position={[0, 0.015, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.13, 0.14, 0.03, 24]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.5} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.82, 0]} castShadow>
        <cylinderGeometry args={[0.012, 0.012, 1.6, 10]} />
        <meshStandardMaterial color="#1a1a1a" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh position={[0.05, 1.64, 0]}>
        <sphereGeometry args={[0.06, 20, 16]} />
        <meshStandardMaterial color="#fff4d8" emissive="#ffe2a8" emissiveIntensity={3} toneMapped={false} />
      </mesh>
      <pointLight position={[0.05, 1.62, 0.05]} color="#ffd7a0" intensity={1.6} distance={4.5} decay={2} />
      {/* Hats hung on the pole */}
      <Cap position={[0.06, 1.42, 0.04]} rotation={[0.4, 0.6, -1.1]} crown="#2c3e6e" brim="#d6c8b0" />
      <Cap position={[-0.05, 1.28, 0.03]} rotation={[0.2, -0.5, 1.2]} crown="#8a2433" brim="#8a2433" />
      <Cap position={[0.06, 1.12, 0.05]} rotation={[0.5, 0.4, -1.0]} crown="#f2efe8" brim="#b52a2a" />
    </group>
  );
}

function Desk() {
  const top = 0.75;
  return (
    <group>
      <Block args={[1.2, 0.03, 0.6]} position={[0, top - 0.015, 0]} color="#1a1a1c" roughness={0.5} />
      {[
        [-0.57, -0.27],
        [-0.57, 0.27],
      ].map(([x, z]) => (
        <Block key={`${x}-${z}`} args={[0.03, top - 0.03, 0.03]} position={[x, (top - 0.03) / 2, z]} color="#2b2b2b" metalness={0.6} roughness={0.4} />
      ))}
      {/* Wood drawer pedestal */}
      <Block args={[0.38, top - 0.03, 0.56]} position={[0.39, (top - 0.03) / 2, 0]} color="#5d3f2a" />
      <Block args={[0.34, 0.2, 0.01]} position={[0.39, 0.55, 0.285]} color="#6b4a33" />
      <Block args={[0.34, 0.3, 0.01]} position={[0.39, 0.22, 0.285]} color="#6b4a33" />
      {/* Monitor */}
      <Block args={[0.24, 0.012, 0.16]} position={[-0.1, top + 0.006, -0.16]} color="#111" />
      <Block args={[0.04, 0.22, 0.03]} position={[-0.1, top + 0.12, -0.2]} color="#111" />
      <mesh position={[-0.1, top + 0.36, -0.18]} castShadow>
        <boxGeometry args={[0.7, 0.4, 0.03]} />
        <meshStandardMaterial color="#0d0e11" roughness={0.3} metalness={0.2} />
      </mesh>
      {/* White tower / speaker */}
      <Block args={[0.2, 0.38, 0.32]} position={[0.45, top + 0.19, -0.1]} color="#e9e9eb" roughness={0.5} />
      <Block args={[0.44, 0.02, 0.14]} position={[-0.12, top + 0.01, 0.12]} color="#222" />
      <mesh position={[0.18, top + 0.008, 0.16]} receiveShadow>
        <cylinderGeometry args={[0.1, 0.09, 0.015, 24]} />
        <meshStandardMaterial color="#f5f5f2" />
      </mesh>
      <Cans origin={[-0.5, top, -0.05]} cols={3} rows={2} />
      <Cans origin={[0.12, top, -0.24]} cols={3} rows={2} />
      <mesh position={[0.08, top + 0.13, 0.0]} castShadow>
        <cylinderGeometry args={[0.035, 0.035, 0.26, 14]} />
        <meshStandardMaterial color="#c42127" roughness={0.3} />
      </mesh>
    </group>
  );
}

function GamingChair() {
  const color = "#1c1c1f";
  return (
    <group>
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <group key={i} rotation={[0, a, 0]}>
            <Block args={[0.04, 0.03, 0.3]} position={[0, 0.07, 0.15]} color="#222" metalness={0.4} roughness={0.5} />
            <mesh position={[0, 0.03, 0.29]} castShadow>
              <sphereGeometry args={[0.028, 12, 10]} />
              <meshStandardMaterial color="#111" />
            </mesh>
          </group>
        );
      })}
      <mesh position={[0, 0.25, 0]} castShadow>
        <cylinderGeometry args={[0.025, 0.03, 0.34, 12]} />
        <meshStandardMaterial color="#333" metalness={0.7} roughness={0.3} />
      </mesh>
      <Soft args={[0.54, 0.11, 0.52]} position={[0, 0.47, 0.02]} color={color} radius={0.04} />
      <Soft args={[0.52, 0.8, 0.11]} position={[0, 0.94, -0.25]} color={color} radius={0.05} rotation={[-0.12, 0, 0]} />
      <Soft args={[0.3, 0.14, 0.06]} position={[0, 1.2, -0.27]} color="#2a2a2e" radius={0.03} rotation={[-0.12, 0, 0]} />
      {[-0.3, 0.3].map((x) => (
        <group key={x}>
          <Block args={[0.03, 0.18, 0.03]} position={[x, 0.6, -0.02]} color="#222" />
          <Soft args={[0.08, 0.035, 0.28]} position={[x, 0.7, 0.0]} color="#222" radius={0.015} />
        </group>
      ))}
    </group>
  );
}

function Dresser() {
  const wood = COLORS.cherryWood;
  return (
    <group>
      <Block args={[0.9, 0.82, 0.48]} position={[0, 0.41, 0]} color={wood} roughness={0.55} />
      <Block args={[0.94, 0.03, 0.5]} position={[0, 0.835, 0]} color="#4f2318" roughness={0.45} />
      {[0.15, 0.42, 0.68].map((y) =>
        [-0.215, 0.215].map((x) => (
          <group key={`${x}-${y}`}>
            <Block args={[0.41, 0.22, 0.012]} position={[x, y, 0.245]} color="#6a3222" roughness={0.5} />
            <mesh position={[x, y, 0.258]}>
              <sphereGeometry args={[0.014, 10, 8]} />
              <meshStandardMaterial color="#c9b27a" metalness={0.8} roughness={0.3} />
            </mesh>
          </group>
        )),
      )}
      {/* Helmets, masks and a stack of books on top */}
      <Lump position={[-0.25, 0.92, 0.02]} scale={[0.13, 0.08, 0.1]} color="#f0eee9" />
      <Lump position={[0.25, 0.92, -0.05]} scale={[0.12, 0.08, 0.1]} color="#e8e6e2" />
      <Block args={[0.26, 0.05, 0.2]} position={[0.02, 0.875, 0.08]} color="#7a2a24" />
      <Block args={[0.22, 0.03, 0.18]} position={[0.03, 0.915, 0.08]} color="#f1e6c8" />
    </group>
  );
}

function AcousticGuitar() {
  return (
    <group rotation={[-0.2, 0, 0]} position={[0, 0, 0.06]}>
      <mesh position={[0, 0.24, 0]} scale={[1, 1, 0.27]} castShadow>
        <sphereGeometry args={[0.19, 28, 20]} />
        <meshStandardMaterial color="#b5202b" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.46, 0]} scale={[1, 1, 0.3]} castShadow>
        <sphereGeometry args={[0.14, 28, 20]} />
        <meshStandardMaterial color="#8c1820" roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.38, 0.044]}>
        <circleGeometry args={[0.045, 24]} />
        <meshStandardMaterial color="#0c0c0c" />
      </mesh>
      <Block args={[0.05, 0.42, 0.03]} position={[0, 0.78, 0]} color="#2a1a12" />
      <Block args={[0.075, 0.14, 0.025]} position={[0, 1.05, 0]} color="#b5202b" />
    </group>
  );
}

function ElectricGuitar() {
  return (
    <group rotation={[-0.18, 0.2, 0]} position={[0, 0, 0.05]}>
      <Soft args={[0.32, 0.42, 0.045]} position={[0, 0.24, 0]} color="#f1efe8" radius={0.02} />
      <Block args={[0.13, 0.2, 0.006]} position={[0.03, 0.26, 0.025]} color="#1b1b1d" roughness={0.4} />
      <Block args={[0.06, 0.008, 0.008]} position={[0.03, 0.2, 0.03]} color="#c9c9c9" metalness={0.8} />
      <Block args={[0.06, 0.008, 0.008]} position={[0.03, 0.29, 0.03]} color="#c9c9c9" metalness={0.8} />
      <Block args={[0.045, 0.5, 0.025]} position={[0, 0.7, 0]} color="#d8b07a" />
      <Block args={[0.07, 0.15, 0.02]} position={[0.01, 1.0, 0]} color="#d8b07a" />
    </group>
  );
}

function LaundryBasket() {
  const h = 0.3;
  const c = "#8d9297";
  return (
    <group>
      <Block args={[0.56, 0.02, 0.42]} position={[0, 0.01, 0]} color={c} />
      <Block args={[0.56, h, 0.015]} position={[0, h / 2, 0.2]} color={c} />
      <Block args={[0.56, h, 0.015]} position={[0, h / 2, -0.2]} color={c} />
      <Block args={[0.015, h, 0.42]} position={[0.275, h / 2, 0]} color={c} />
      <Block args={[0.015, h, 0.42]} position={[-0.275, h / 2, 0]} color={c} />
      <Lump position={[0, 0.32, 0]} scale={[0.27, 0.12, 0.2]} color="#5b4637" />
      <Lump position={[-0.08, 0.42, 0.05]} scale={[0.22, 0.1, 0.17]} color="#9ec2e4" />
      <Lump position={[0.12, 0.47, -0.04]} scale={[0.2, 0.13, 0.16]} color="#c8952e" />
      <Lump position={[0.04, 0.55, 0.02]} scale={[0.14, 0.07, 0.12]} color="#e9e6df" />
    </group>
  );
}

function ClothesPile() {
  return (
    <group>
      <Lump position={[-0.18, 0.11, 0]} scale={[0.25, 0.11, 0.24]} color="#6e6e73" />
      <Lump position={[0.15, 0.1, 0.06]} scale={[0.26, 0.1, 0.22]} color="#3b2f28" />
      <Lump position={[0.02, 0.2, -0.06]} scale={[0.2, 0.09, 0.17]} color="#ece9e1" />
      <Lump position={[0.24, 0.17, -0.12]} scale={[0.14, 0.08, 0.13]} color="#141416" />
      <Lump position={[-0.26, 0.2, 0.08]} scale={[0.12, 0.07, 0.12]} color="#a58b6c" />
    </group>
  );
}

const MODELS: Record<FurnitureKind, () => React.JSX.Element> = {
  bed: Bed,
  nightstand: Nightstand,
  purifier: Purifier,
  floorLamp: FloorLamp,
  desk: Desk,
  gamingChair: GamingChair,
  dresser: Dresser,
  acousticGuitar: AcousticGuitar,
  electricGuitar: ElectricGuitar,
  laundryBasket: LaundryBasket,
  clothesPile: ClothesPile,
};

export function FurnitureModel({ kind }: { kind: FurnitureKind }) {
  const Model = MODELS[kind];
  return <Model />;
}
