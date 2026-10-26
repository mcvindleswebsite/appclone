"use client";

import { RoundedBox } from "@react-three/drei";

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

function Bed() {
  // 1.91 × 1.37 full bed, headboard end at local −x (against the west wall).
  return (
    <group>
      <Block args={[1.91, 0.2, 1.37]} position={[0, 0.1, 0]} color="#2a2a2d" />
      <Soft args={[1.88, 0.24, 1.35]} position={[0, 0.32, 0]} color={COLORS.sheets} radius={0.06} />
      {/* Beige quilted comforter, draped over the side and foot */}
      <Soft args={[1.4, 0.07, 1.43]} position={[0.25, 0.47, 0.01]} color={COLORS.comforter} />
      <Block args={[1.4, 0.36, 0.02]} position={[0.25, 0.3, 0.725]} color={COLORS.comforter} roughness={1} />
      <Block args={[0.02, 0.36, 1.4]} position={[0.95, 0.3, 0.01]} color={COLORS.comforter} roughness={1} />
      {/* Pillows */}
      <Soft args={[0.42, 0.15, 0.62]} position={[-0.7, 0.53, -0.33]} color="#b7c4b9" radius={0.06} />
      <Soft args={[0.4, 0.13, 0.6]} position={[-0.72, 0.52, 0.32]} color="#e5dccb" radius={0.06} />
    </group>
  );
}

function Nightstand() {
  // Low dark-wood console table with a lower shelf.
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
    </group>
  );
}

function Desk() {
  // Black top on metal legs with a wood drawer pedestal.
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
      <Block args={[0.38, top - 0.03, 0.56]} position={[0.39, (top - 0.03) / 2, 0]} color="#5d3f2a" />
      <Block args={[0.34, 0.2, 0.01]} position={[0.39, 0.55, 0.285]} color="#6b4a33" />
      <Block args={[0.34, 0.3, 0.01]} position={[0.39, 0.22, 0.285]} color="#6b4a33" />
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
    </group>
  );
}

const MODELS: Record<FurnitureKind, () => React.JSX.Element> = {
  bed: Bed,
  nightstand: Nightstand,
  desk: Desk,
  gamingChair: GamingChair,
  dresser: Dresser,
};

export function FurnitureModel({ kind }: { kind: FurnitureKind }) {
  const Model = MODELS[kind];
  return <Model />;
}
