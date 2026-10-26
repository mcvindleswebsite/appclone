"use client";

import { useEffect, useMemo } from "react";
import * as THREE from "three";

import { GRID_NX, GRID_NZ } from "./designEngine";
import { ROOM, ZONES, type Rect } from "./roomData";

const RED = "#FF3B30";
const GREEN = "#00DD94";

function ZoneRect({ rect, color, opacity }: { rect: Rect; color: string; opacity: number }) {
  return (
    <mesh
      rotation={[-Math.PI / 2, 0, 0]}
      position={[(rect.x0 + rect.x1) / 2, 0.016, (rect.z0 + rect.z1) / 2]}
      raycast={() => null}
    >
      <planeGeometry args={[rect.x1 - rect.x0, rect.z1 - rect.z0]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} depthWrite={false} />
    </mesh>
  );
}

/** Walkway cells reachable from the door, painted as a soft green floor wash. */
function Walkway({ reachable }: { reachable: Uint8Array }) {
  const texture = useMemo(() => {
    const data = new Uint8Array(GRID_NX * GRID_NZ * 4);
    // Texture row 0 is the south edge of the plane; grid row 0 is the north wall.
    for (let j = 0; j < GRID_NZ; j++) {
      for (let i = 0; i < GRID_NX; i++) {
        const o = ((GRID_NZ - 1 - j) * GRID_NX + i) * 4;
        data[o] = 0x00;
        data[o + 1] = 0xdd;
        data[o + 2] = 0x94;
        data[o + 3] = reachable[j * GRID_NX + i] ? 120 : 0;
      }
    }
    const tex = new THREE.DataTexture(data, GRID_NX, GRID_NZ, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }, [reachable]);

  useEffect(() => () => texture.dispose(), [texture]);

  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.014, 0]} raycast={() => null}>
      <planeGeometry args={[ROOM.width, ROOM.depth]} />
      <meshBasicMaterial map={texture} transparent depthWrite={false} />
    </mesh>
  );
}

export function ZonesOverlay({ reachable }: { reachable: Uint8Array }) {
  const { x, z, radius } = ZONES.doorHinge;
  return (
    <group>
      <Walkway reachable={reachable} />
      {/* Door swing: quarter circle from the hinge, opening west into the room */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.017, z]} raycast={() => null}>
        <circleGeometry args={[radius, 32, Math.PI / 2, Math.PI / 2]} />
        <meshBasicMaterial color={RED} transparent opacity={0.22} depthWrite={false} />
      </mesh>
      <ZoneRect rect={ZONES.closet} color={RED} opacity={0.18} />
      <ZoneRect rect={ZONES.window} color="#ffd36b" opacity={0.22} />
    </group>
  );
}

export const FEEDBACK_COLORS = { bad: RED, good: GREEN } as const;
