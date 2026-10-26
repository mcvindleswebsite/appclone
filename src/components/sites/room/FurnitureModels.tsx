"use client";

import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";

import { COLORS, type FurnitureItem } from "./roomData";

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

function Bed({ accentTextiles }: { accentTextiles: boolean }) {
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
      {accentTextiles && (
        <>
          {/* Suggested addition: Boca-gold throw across the foot + two shams */}
          <Soft args={[0.55, 0.03, 1.46]} position={[0.62, 0.52, 0.01]} color={COLORS.bocaGold} radius={0.012} />
          <Block args={[0.55, 0.3, 0.015]} position={[0.62, 0.38, 0.735]} color={COLORS.bocaGold} roughness={1} />
          <Soft args={[0.14, 0.3, 0.46]} position={[-0.42, 0.64, -0.3]} color={COLORS.bocaGold} radius={0.05} rotation={[0, 0, -0.35]} />
          <Soft args={[0.14, 0.3, 0.46]} position={[-0.44, 0.63, 0.3]} color={COLORS.bocaNavy} radius={0.05} rotation={[0, 0, -0.35]} />
        </>
      )}
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
      {/* Navy table lamp */}
      <mesh position={[-0.32, top + 0.015, 0]} castShadow>
        <cylinderGeometry args={[0.06, 0.07, 0.03, 20]} />
        <meshStandardMaterial color="#9a9a9a" metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[-0.32, top + 0.15, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.25, 8]} />
        <meshStandardMaterial color="#b0b0b0" metalness={0.7} />
      </mesh>
      <mesh position={[-0.32, top + 0.34, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.13, 0.2, 24, 1, true]} />
        <meshStandardMaterial color={COLORS.navy} roughness={0.9} side={THREE.DoubleSide} emissive="#ffcf8a" emissiveIntensity={0.08} />
      </mesh>
      <pointLight position={[-0.32, top + 0.3, 0]} color="#ffd9a6" intensity={0.5} distance={2.2} decay={2} />
      {/* Gold World Cup replica */}
      <mesh position={[0.3, top + 0.06, 0]} castShadow>
        <cylinderGeometry args={[0.035, 0.045, 0.12, 16]} />
        <meshStandardMaterial color="#2f6a3a" />
      </mesh>
      <mesh position={[0.3, top + 0.2, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.03, 0.16, 16]} />
        <meshStandardMaterial color={COLORS.bocaGold} metalness={0.85} roughness={0.25} />
      </mesh>
      <mesh position={[0.3, top + 0.31, 0]} castShadow>
        <sphereGeometry args={[0.055, 20, 16]} />
        <meshStandardMaterial color={COLORS.bocaGold} metalness={0.85} roughness={0.25} />
      </mesh>
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
      {/* Monitor + keyboard */}
      <Block args={[0.24, 0.012, 0.16]} position={[-0.1, top + 0.006, -0.16]} color="#111" />
      <Block args={[0.04, 0.22, 0.03]} position={[-0.1, top + 0.12, -0.2]} color="#111" />
      <Block args={[0.7, 0.4, 0.03]} position={[-0.1, top + 0.36, -0.18]} color="#0d0e11" roughness={0.3} metalness={0.2} />
      <Block args={[0.44, 0.02, 0.14]} position={[-0.1, top + 0.01, 0.12]} color="#222" />
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

function AreaRug({ w, d }: { w: number; d: number }) {
  // Suggested addition: low-pile sand wool rug with a tonal border.
  return (
    <group>
      <RoundedBox args={[w, 0.012, d]} radius={0.005} smoothness={2} position={[0, 0.008, 0]} receiveShadow>
        <meshStandardMaterial color={COLORS.sand} roughness={1} />
      </RoundedBox>
      <mesh position={[0, 0.0145, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[w - 0.16, d - 0.16]} />
        <meshStandardMaterial color="#d6c6a3" roughness={1} />
      </mesh>
    </group>
  );
}

function Uplight() {
  // Suggested addition: slim brass column uplight washing the ceiling.
  return (
    <group>
      <mesh position={[0, 0.015, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.11, 0.12, 0.03, 24]} />
        <meshStandardMaterial color="#b08d4a" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 0.72, 0]} castShadow>
        <cylinderGeometry args={[0.014, 0.014, 1.4, 10]} />
        <meshStandardMaterial color="#b08d4a" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 1.45, 0]} castShadow>
        <cylinderGeometry args={[0.13, 0.05, 0.1, 24, 1, true]} />
        <meshStandardMaterial color="#b08d4a" metalness={0.8} roughness={0.3} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 1.49, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.12, 24]} />
        <meshStandardMaterial color="#fff2d6" emissive="#ffd7a0" emissiveIntensity={2.5} toneMapped={false} />
      </mesh>
      <pointLight position={[0, 1.9, 0]} color="#ffd7a0" intensity={1.8} distance={4} decay={2} />
    </group>
  );
}

export function FurnitureModel({ item, accentTextiles }: { item: FurnitureItem; accentTextiles: boolean }) {
  switch (item.kind) {
    case "bed":
      return <Bed accentTextiles={accentTextiles} />;
    case "nightstand":
      return <Nightstand />;
    case "desk":
      return <Desk />;
    case "gamingChair":
      return <GamingChair />;
    case "dresser":
      return <Dresser />;
    case "floorLamp":
      return <FloorLamp />;
    case "acousticGuitar":
      return <AcousticGuitar />;
    case "electricGuitar":
      return <ElectricGuitar />;
    case "areaRug":
      return <AreaRug w={item.size.w} d={item.size.d} />;
    case "uplight":
      return <Uplight />;
  }
}
