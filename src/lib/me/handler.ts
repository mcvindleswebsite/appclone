import { requireSession } from "@/lib/inbox/auth";
import { aiError } from "@/lib/me/claude";
import { StoreMissing } from "@/lib/me/store";
import type { ImageInput } from "@/types/me";

/** Runs a /me request for a logged-in caller, mapping store and AI failures to JSON errors. */
export const meRoute = async (request: Request, run: () => Promise<Response>) => {
  const denied = await requireSession(request);
  if (denied) return denied;
  try {
    return await run();
  } catch (error) {
    if (error instanceof StoreMissing) return Response.json({ error: "Store not configured" }, { status: 503 });
    return aiError(error) ?? Response.json({ error: "Something went wrong — try again" }, { status: 502 });
  }
};

const MAX_IMAGES = 6;
/** Base64 characters per image; the page shrinks screenshots well under this before upload. */
const MAX_IMAGE_CHARS = 1_500_000;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

/** The valid images from a request body, or null when any is malformed or too big. */
export const readImages = (value: unknown): ImageInput[] | null => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IMAGES) return null;
  const ok = value.every(
    (i): i is ImageInput =>
      !!i &&
      typeof i === "object" &&
      TYPES.has((i as ImageInput).media_type) &&
      typeof (i as ImageInput).data === "string" &&
      (i as ImageInput).data.length <= MAX_IMAGE_CHARS
  );
  return ok ? value : null;
};

export const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max).trim() : "");
