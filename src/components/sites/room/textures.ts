import * as THREE from "three";

// Every surface detail is painted onto a canvas at runtime so the scene has
// no network dependencies (no HDRs, no font CDNs, no image downloads).

const MARKER = '"Marker Felt", "Comic Sans MS", "Chalkboard SE", cursive';
const BLOCK = '"Arial Black", "Helvetica Neue", Arial, sans-serif';

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

function chalk(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, color: string, font = MARKER) {
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

export function chalkboardTexture() {
  // Two sliding doors side by side, 1.8 m × 2.05 m.
  const W = 1440;
  const H = 1640;
  const { canvas, ctx } = makeCanvas(W, H);
  const rand = rng(7);
  ctx.fillStyle = "#1c1f1e";
  ctx.fillRect(0, 0, W, H);
  // Eraser haze.
  for (let i = 0; i < 40; i++) {
    const g = ctx.createRadialGradient(rand() * W, rand() * H, 0, rand() * W, rand() * H, 120 + rand() * 200);
    g.addColorStop(0, "rgba(120,125,120,0.08)");
    g.addColorStop(1, "rgba(120,125,120,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  // Left door: big outlined VINCE + names.
  ctx.textBaseline = "alphabetic";
  const letters: [string, string][] = [
    ["V", "#e9e2f0"],
    ["I", "#d9d35a"],
    ["N", "#9ccf6a"],
    ["C", "#e86aa0"],
    ["E", "#f0a0c4"],
  ];
  ctx.font = `bold 180px ${BLOCK}`;
  let lx = 40;
  for (const [ch, color] of letters) {
    ctx.lineWidth = 8;
    ctx.strokeStyle = color;
    ctx.strokeText(ch, lx, 340);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = color;
    ctx.fillText(ch, lx, 340);
    ctx.globalAlpha = 1;
    lx += ctx.measureText(ch).width + 4;
  }
  ctx.fillStyle = "rgba(220,220,220,0.55)";
  ctx.fillRect(60, 380, 560, 16);

  const names = ["MICA", "CENSO☺", "EMI♥", "*TIA*", "PHIL", "LELA"];
  names.forEach((n, i) => chalk(ctx, n, 300, 560 + i * 62, 50, "#d7e4f2"));

  // Right door: signatures and doodles.
  chalk(ctx, "Sandro", 760, 300, 72, "#e48aa8");
  chalk(ctx, "Phil ♥", 860, 380, 60, "#c9d7e8");
  chalk(ctx, "FL", 1160, 340, 80, "#8fd06a");
  chalk(ctx, "★     ★", 880, 560, 44, "#e8d84a");
  chalk(ctx, "☺Emi♡", 870, 630, 64, "#d9a0e0");
  chalk(ctx, "★     ★", 880, 700, 44, "#e8d84a");
  chalk(ctx, "HELL☺", 840, 900, 54, "#9fd0ea");
  ctx.strokeStyle = "rgba(150,170,220,0.7)";
  ctx.lineWidth = 4;
  for (let i = 0; i < 14; i++) {
    ctx.beginPath();
    const cx = 840 + rand() * 400;
    const cy = 1080 + rand() * 300;
    ctx.moveTo(cx, cy);
    ctx.bezierCurveTo(cx + rand() * 160 - 80, cy - rand() * 140, cx + rand() * 200 - 100, cy + rand() * 140, cx + rand() * 180 - 90, cy + rand() * 60);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(200,140,220,0.6)";
  for (let i = 0; i < 6; i++) {
    ctx.beginPath();
    ctx.arc(360 + rand() * 200, 1050 + rand() * 200, 30 + rand() * 50, 0, Math.PI * 1.7);
    ctx.stroke();
  }
  return toTexture(canvas);
}

export function jerseyTexture() {
  // Retro Boca "Quilmes" #10 Maradona shirt, pinned flat to the wall.
  const { canvas, ctx } = makeCanvas(512, 560);
  ctx.clearRect(0, 0, 512, 560);
  const shirt = new Path2D();
  shirt.moveTo(176, 20);
  shirt.lineTo(336, 20);
  shirt.lineTo(500, 120);
  shirt.lineTo(450, 230);
  shirt.lineTo(400, 200);
  shirt.lineTo(400, 545);
  shirt.lineTo(112, 545);
  shirt.lineTo(112, 200);
  shirt.lineTo(62, 230);
  shirt.lineTo(12, 120);
  shirt.closePath();
  ctx.fillStyle = "#1f3a86";
  ctx.fill(shirt);
  ctx.save();
  ctx.clip(shirt);
  ctx.fillStyle = "#f2b630";
  ctx.fillRect(0, 230, 512, 110);
  ctx.fillStyle = "#14295e";
  ctx.fillRect(0, 0, 512, 6);
  ctx.restore();
  ctx.fillStyle = "#f2b630";
  ctx.beginPath();
  ctx.moveTo(206, 20);
  ctx.quadraticCurveTo(256, 70, 306, 20);
  ctx.lineTo(296, 20);
  ctx.quadraticCurveTo(256, 56, 216, 20);
  ctx.fill();
  ctx.font = `italic bold 64px Georgia, serif`;
  ctx.textAlign = "center";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#14295e";
  ctx.fillStyle = "#f6f1e6";
  ctx.strokeText("Quilmes", 256, 160);
  ctx.fillText("Quilmes", 256, 160);
  ctx.font = `bold 150px ${BLOCK}`;
  ctx.fillStyle = "#f6f1e6";
  ctx.strokeText("10", 256, 345);
  ctx.fillText("10", 256, 345);
  ctx.font = `bold 46px ${BLOCK}`;
  ctx.fillStyle = "#f2b630";
  ctx.fillText("MARADONA", 256, 420);
  ctx.font = `bold 38px ${BLOCK}`;
  ctx.fillStyle = "#f6f1e6";
  ctx.fillText("XENEIZE", 256, 478);
  return toTexture(canvas);
}

export function pennantTexture() {
  // Boca "Rey de Copas" trophy pennant.
  const { canvas, ctx } = makeCanvas(400, 480);
  const shape = new Path2D();
  shape.moveTo(10, 10);
  shape.lineTo(390, 10);
  shape.lineTo(390, 340);
  shape.quadraticCurveTo(390, 420, 200, 470);
  shape.quadraticCurveTo(10, 420, 10, 340);
  shape.closePath();
  ctx.fillStyle = "#f0c330";
  ctx.fill(shape);
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#1f3a86";
  ctx.stroke(shape);
  ctx.fillStyle = "#1f3a86";
  ctx.textAlign = "center";
  ctx.font = `bold 72px ${BLOCK}`;
  ctx.fillText("BOCA", 200, 90);
  ctx.font = `bold 28px ${BLOCK}`;
  ctx.fillText("REY DE COPAS", 200, 130);
  // Rows of little trophy shields.
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      if (r === 3 && (c === 0 || c === 5)) continue;
      const x = 55 + c * 58;
      const y = 170 + r * 60;
      ctx.beginPath();
      ctx.arc(x, y, 18, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.fillStyle = "#14295e";
  ctx.beginPath();
  ctx.moveTo(160, 330);
  ctx.lineTo(240, 330);
  ctx.lineTo(240, 380);
  ctx.quadraticCurveTo(200, 420, 160, 380);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#f0c330";
  ctx.font = `bold 22px ${BLOCK}`;
  ctx.fillText("CABJ", 200, 365);
  return toTexture(canvas);
}

export function xmenPosterTexture() {
  const { canvas, ctx } = makeCanvas(400, 540);
  ctx.fillStyle = "#3a2b1f";
  ctx.fillRect(0, 0, 400, 540);
  ctx.fillStyle = "#cfe3ee";
  ctx.fillRect(16, 16, 368, 508);
  const sky = ctx.createLinearGradient(0, 120, 0, 520);
  sky.addColorStop(0, "#58a7c9");
  sky.addColorStop(1, "#2f6a8e");
  ctx.fillStyle = sky;
  ctx.fillRect(16, 120, 368, 404);
  ctx.fillStyle = "#e9c13a";
  ctx.fillRect(16, 16, 368, 104);
  ctx.font = `bold italic 84px ${BLOCK}`;
  ctx.textAlign = "center";
  ctx.lineWidth = 8;
  ctx.strokeStyle = "#b21e1e";
  ctx.strokeText("X-MEN", 200, 98);
  ctx.fillStyle = "#fbe36b";
  ctx.fillText("X-MEN", 200, 98);
  // Phoenix silhouette.
  ctx.fillStyle = "#2c7a3a";
  ctx.beginPath();
  ctx.ellipse(200, 330, 70, 150, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d8352a";
  ctx.beginPath();
  ctx.moveTo(200, 170);
  ctx.bezierCurveTo(90, 160, 60, 260, 120, 300);
  ctx.bezierCurveTo(150, 240, 250, 240, 280, 300);
  ctx.bezierCurveTo(340, 260, 310, 160, 200, 170);
  ctx.fill();
  ctx.fillStyle = "#e9c13a";
  ctx.beginPath();
  ctx.arc(200, 330, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#8a6a4a";
  ctx.fillRect(16, 460, 368, 64);
  return toTexture(canvas);
}

export function plateTexture() {
  const { canvas, ctx } = makeCanvas(512, 120);
  ctx.fillStyle = "#f3f1ea";
  ctx.fillRect(0, 0, 512, 120);
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 108);
  ctx.fillStyle = "#1a1a1a";
  ctx.font = `bold 84px ${BLOCK}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("M 2871 L", 256, 64);
  return toTexture(canvas);
}

export function blindsTexture() {
  const { canvas, ctx } = makeCanvas(64, 256);
  for (let i = 0; i < 32; i++) {
    ctx.fillStyle = i % 2 === 0 ? "#e2cfa6" : "#b99c6c";
    ctx.fillRect(0, i * 8, 64, i % 2 === 0 ? 6 : 2);
  }
  return toTexture(canvas);
}
