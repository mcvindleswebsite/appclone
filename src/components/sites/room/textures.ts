import * as THREE from "three";

// Surface textures are painted onto a canvas at runtime so the scene has
// no network dependencies (no HDRs, no image downloads).

function makeCanvas(w: number, h: number) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2D canvas unavailable");
  return { canvas, ctx };
}

function toTexture(canvas: HTMLCanvasElement, repeat?: [number, number]) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

// Deterministic PRNG so the room looks the same on every load.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function noiseTexture(base: string, speck: string[], seed: number, repeat: [number, number], strands = false) {
  const { canvas, ctx } = makeCanvas(256, 256);
  const rand = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) {
    ctx.fillStyle = speck[Math.floor(rand() * speck.length)];
    const x = rand() * 256;
    const y = rand() * 256;
    if (strands) {
      ctx.fillRect(x, y, 1, 2 + rand() * 4);
    } else {
      ctx.fillRect(x, y, 1.5, 1.5);
    }
  }
  return toTexture(canvas, repeat);
}

export function blindsTexture() {
  const { canvas, ctx } = makeCanvas(64, 256);
  for (let i = 0; i < 32; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#e2cfa6" : "#b99c6c";
    ctx.fillRect(0, i * 8, 64, i % 2 === 0 ? 6 : 2);
  }
  return toTexture(canvas);
}
