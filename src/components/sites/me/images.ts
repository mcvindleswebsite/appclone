import type { ImageInput } from "@/types/me";

/** Claude reads images up to about this long edge; bigger only costs upload time. */
const MAX_EDGE = 1568;

/** Shrinks a screenshot to a JPEG the API reads well and the request limit allows. */
export const toImageInput = async (file: Blob): Promise<ImageInput> => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return { media_type: "image/jpeg", data: dataUrl.slice(dataUrl.indexOf(",") + 1) };
};

export const previewUrl = (image: ImageInput) => `data:${image.media_type};base64,${image.data}`;

/** JSON fetch against /api/me that throws the server's error message. */
export const meFetch = async <T,>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
  const { json, ...rest } = init ?? {};
  const response = await fetch(path, {
    ...rest,
    ...(json !== undefined ? { body: JSON.stringify(json), headers: { "Content-Type": "application/json" } } : {}),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw Object.assign(new Error(data.error ?? "Something went wrong"), { status: response.status });
  return data;
};
