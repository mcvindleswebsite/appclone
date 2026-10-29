"use client";

import { ImagePlus, X } from "lucide-react";
import { useEffect, useRef } from "react";

import type { ImageInput } from "@/types/me";

import { previewUrl, toImageInput } from "./images";

const MAX = 6;

/** Screenshot picker: tap to choose, or paste (Ctrl/⌘+V) while the page is open. Up to six. */
export function ImagePicker({ images, onChange, label }: { images: ImageInput[]; onChange: (images: ImageInput[]) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef({ images, onChange });
  useEffect(() => {
    latest.current = { images, onChange };
  });

  const add = async (files: Blob[]) => {
    const picked = files.filter((f) => f.type.startsWith("image/")).slice(0, MAX - latest.current.images.length);
    if (!picked.length) return;
    const read = await Promise.all(picked.map((f) => toImageInput(f).catch(() => null)));
    latest.current.onChange([...latest.current.images, ...read.filter((i): i is ImageInput => i !== null)]);
  };

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])];
      if (files.some((f) => f.type.startsWith("image/"))) {
        event.preventDefault();
        void add(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div className="flex gap-2 overflow-x-auto pb-1">
      {images.map((image, i) => (
        <div key={i} className="relative h-36 w-[4.5rem] shrink-0 overflow-hidden rounded-xl border border-black/10">
          {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
          <img src={previewUrl(image)} alt="" className="size-full object-cover object-top" />
          <button
            type="button"
            aria-label="Remove screenshot"
            onClick={() => onChange(images.filter((_, j) => j !== i))}
            className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-black text-white"
          >
            <X className="size-3" />
          </button>
        </div>
      ))}
      {images.length < MAX && (
        <button
          type="button"
          onClick={() => input.current?.click()}
          className="flex h-36 min-w-[4.5rem] flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-black/15 text-[13px] text-black/50"
        >
          <ImagePlus className="size-5" />
          {images.length ? "Add" : label}
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          void add([...(event.target.files ?? [])]);
          event.target.value = "";
        }}
      />
    </div>
  );
}
