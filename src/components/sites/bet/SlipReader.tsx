"use client";

import { ImageUp, Loader2, ScanText } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { parseSlipText } from "@/lib/bet/parse-slip";
import { cn } from "@/lib/utils";
import type { BetSlip } from "@/types/bet";

import { T } from "./theme";

/**
 * Upscales and grayscales the screenshot on a canvas, then boosts contrast.
 * Kalshi's dark UI (light text on navy) OCRs far better inverted to dark-on-light.
 */
const preprocess = async (file: Blob) => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(3, Math.max(1, 2000 / bitmap.width));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const px = image.data;
  let total = 0;
  for (let i = 0; i < px.length; i += 4) total += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
  const invert = total / (px.length / 4) < 128;
  for (let i = 0; i < px.length; i += 4) {
    let y = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (invert) y = 255 - y;
    y = Math.min(255, Math.max(0, (y - 128) * 1.6 + 128));
    px[i] = px[i + 1] = px[i + 2] = y;
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
};

export function SlipReader({ onParsed }: { onParsed: (slip: BetSlip, rawText: string) => void }) {
  const [preview, setPreview] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const read = useCallback(
    async (file: Blob) => {
      setError(null);
      setPreview((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(file);
      });
      setProgress(0);
      try {
        const [{ createWorker }, canvas] = await Promise.all([import("tesseract.js"), preprocess(file)]);
        const worker = await createWorker("eng", 1, {
          logger: (m: { status: string; progress: number }) => {
            if (m.status === "recognizing text") setProgress(m.progress);
          },
        });
        const { data } = await worker.recognize(canvas);
        await worker.terminate();
        onParsed(parseSlipText(data.text), data.text);
      } catch {
        setError("Couldn't read that image — fill the fields in manually.");
      } finally {
        setProgress(null);
      }
    },
    [onParsed]
  );

  // Paste a screenshot anywhere on the page.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const item = [...(event.clipboardData?.items ?? [])].find((i) => i.type.startsWith("image/"));
      const file = item?.getAsFile();
      if (file) {
        event.preventDefault();
        void read(file);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [read]);

  const busy = progress !== null;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = [...e.dataTransfer.files].find((f) => f.type.startsWith("image/"));
        if (file) void read(file);
      }}
      className={cn(
        "relative flex items-center gap-4 overflow-hidden rounded-xl border border-dashed p-4 transition-colors",
        dragging ? "border-[#00DD94] bg-[#014737]/40" : "border-[#1E2638] bg-[#050D0A]"
      )}
    >
      <div className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#121824]">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- local blob preview
          <img src={preview} alt="Uploaded bet slip" className="size-full object-cover" />
        ) : (
          <ImageUp className="size-6 text-[#F5F7F4]/35" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-white">
          {busy ? "Reading slip…" : "Scan a Kalshi screenshot"}
        </p>
        <p className={cn("text-xs", T.muted)}>
          {busy
            ? `${Math.round((progress ?? 0) * 100)}% — first scan downloads the OCR model`
            : "Drop an image, browse, or paste (Ctrl/⌘+V)"}
        </p>
        {error && <p className="mt-1 text-xs text-[#FF3B30]">{error}</p>}
        {busy && (
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-[#1E2638]">
            <div className="h-full bg-[#00DD94] transition-all" style={{ width: `${(progress ?? 0) * 100}%` }} />
          </div>
        )}
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="flex shrink-0 items-center gap-1.5 rounded-lg bg-[#1E2638] px-3 py-2 text-xs font-semibold text-white hover:bg-[#014737] disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <ScanText className="size-3.5" />}
        Browse
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void read(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
