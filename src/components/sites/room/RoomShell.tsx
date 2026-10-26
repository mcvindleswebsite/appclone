"use client";

import { useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

import { COLORS, ROOM } from "./roomData";
import { blindsTexture, noiseTexture } from "./textures";

const W = ROOM.width;
const D = ROOM.depth;
const H = ROOM.height;

const tmp = new THREE.Vector3();

/**
 * A wall whose local +z faces into the room. Children are placed in wall space:
 * x along the wall, y up from the floor, z out from the wall surface.
 * The whole wall (and anything mounted on it) hides when the camera is behind it.
 */
function Wall({
  position,
  rotationY,
  width,
  children,
}: {
  position: [number, number, number];
  rotationY: number;
  width: number;
  children?: ReactNode;
}) {
  const ref = useRef<THREE.Group>(null);
  const normal = useMemo(() => new THREE.Vector3(Math.sin(rotationY), 0, Math.cos(rotationY)), [rotationY]);
  const origin = useMemo(() => new THREE.Vector3(...position), [position]);

  useFrame(({ camera }) => {
    if (!ref.current) return;
    ref.current.visible = tmp.copy(camera.position).sub(origin).dot(normal) > 0;
  });

  return (
    <group ref={ref} position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, H / 2, 0]} receiveShadow>
        <planeGeometry args={[width, H]} />
        <meshStandardMaterial color={COLORS.wall} roughness={0.95} />
      </mesh>
      {/* Baseboard */}
      <mesh position={[0, 0.045, 0.006]} receiveShadow>
        <boxGeometry args={[width, 0.09, 0.012]} />
        <meshStandardMaterial color={COLORS.trim} roughness={0.6} />
      </mesh>
      {children}
    </group>
  );
}

function Ceiling() {
  const ref = useRef<THREE.Mesh>(null);
  const tex = useMemo(() => noiseTexture(COLORS.ceiling, ["#f7f5ef", "#dcd8ce", "#e6e2d8"], 3, [6, 6]), []);
  useFrame(({ camera }) => {
    if (ref.current) ref.current.visible = camera.position.y < H;
  });
  return (
    <mesh ref={ref} position={[0, H, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <planeGeometry args={[W, D]} />
      <meshStandardMaterial map={tex} roughness={1} />
    </mesh>
  );
}

function Floor() {
  const carpet = useMemo(
    () => noiseTexture(COLORS.carpet, ["#4a3d30", "#6a5947", "#544636", "#72604c"], 11, [8, 9]),
    [],
  );
  const turf = useMemo(
    () => noiseTexture(COLORS.turf, ["#3c7a2c", "#24501b", "#46862f", "#2a5a1f"], 23, [6, 6], true),
    [],
  );

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial map={carpet} roughness={1} />
      </mesh>
      {/* Artificial-turf rug covering the middle of the room */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0.45, 0.004, -0.4]} receiveShadow>
        <planeGeometry args={[2.3, 2.2]} />
        <meshStandardMaterial map={turf} roughness={1} />
      </mesh>
    </group>
  );
}

function NorthWall() {
  // Window wall (IMG_7442): blinds and olive blackout curtains.
  const blinds = useMemo(() => blindsTexture(), []);
  const winX = -0.05;
  return (
    <Wall position={[0, 0, -D / 2]} rotationY={0} width={W}>
      {/* Window glow + blinds + sill */}
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
      {/* Curtain rod */}
      <mesh position={[winX, 2.17, 0.09]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.012, 0.012, 1.75, 12]} />
        <meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.4} />
      </mesh>
      {/* Two olive curtain panels, pleated */}
      {[winX - 0.62, winX + 0.66].map((cx, i) => (
        <group key={cx} position={[cx, 1.2, 0.09]}>
          {Array.from({ length: 6 }, (_, k) => (
            <mesh key={k} position={[(k - 2.5) * 0.085, 0, Math.sin(k * 1.7 + i) * 0.015]} castShadow receiveShadow>
              <cylinderGeometry args={[0.05, 0.055, 1.94, 10, 1, true]} />
              <meshStandardMaterial color={COLORS.curtain} roughness={0.95} side={THREE.DoubleSide} />
            </mesh>
          ))}
        </group>
      ))}
    </Wall>
  );
}

function EastWall() {
  // Sliding closet with chalkboard-painted doors (IMG_7444).
  return (
    <Wall position={[W / 2, 0, 0]} rotationY={-Math.PI / 2} width={D}>
      <mesh position={[-0.25, 1.06, 0.01]}>
        <planeGeometry args={[1.88, 2.12]} />
        <meshStandardMaterial color={COLORS.trim} />
      </mesh>
      <mesh position={[-0.25, 1.03, 0.025]} receiveShadow>
        <boxGeometry args={[1.8, 2.05, 0.02]} />
        <meshStandardMaterial color="#1d201f" roughness={0.9} />
      </mesh>
      {/* Door seam */}
      <mesh position={[-0.25, 1.03, 0.037]}>
        <boxGeometry args={[0.02, 2.05, 0.004]} />
        <meshStandardMaterial color="#cfcac0" metalness={0.4} />
      </mesh>
    </Wall>
  );
}

function SouthWall() {
  // Entry door + two floating espresso shelves above the bed (IMG_7443).
  // On this wall local x = −world x.
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
      {/* Six raised panels */}
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
    </Wall>
  );
}

export function RoomShell() {
  return (
    <group>
      <Floor />
      <Ceiling />
      <NorthWall />
      <EastWall />
      <SouthWall />
      <Wall position={[-W / 2, 0, 0]} rotationY={Math.PI / 2} width={D} />
    </group>
  );
}
