import type { SupabaseClient } from "@supabase/supabase-js";
import { barUploadPath, fitWithin } from "./bar";

/**
 * Reference photos for the cocktail station, uploaded from the recipe editor. Browser only.
 * Every photo is shrunk to a JPEG (1200px on the long side) before it leaves the device: a 12 MB phone photo becomes
 * about 150 KB, so the iPad loads it instantly and the offline copy stays small.
 */

export const BAR_PHOTO_BUCKET = "bar-photos";
const MAX_SIDE = 1200;
const MAX_INPUT_BYTES = 40 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024; // matches the bucket's own cap
const QUALITIES = [0.82, 0.7, 0.58];

/** An error whose message is fit to show a person as is. */
export class BarPhotoError extends Error {}

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; done: () => void }> {
  try {
    // "from-image" applies the phone's rotation tag so a portrait shot isn't saved sideways
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { source: bmp, width: bmp.width, height: bmp.height, done: () => bmp.close() };
  } catch {
    // older browsers: decode through an <img>
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, done: () => URL.revokeObjectURL(url) };
  } catch {
    URL.revokeObjectURL(url);
    throw new BarPhotoError("This browser can't read that photo. Try a JPEG or PNG.");
  }
}

/** Shrinks a photo to a JPEG no larger than 1200px on its long side. */
export async function shrinkToJpeg(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new BarPhotoError("That file isn't a photo. Choose a JPEG or PNG.");
  if (file.size > MAX_INPUT_BYTES) throw new BarPhotoError("That photo is too big. Choose one under 40 MB.");
  const img = await decode(file);
  try {
    const { width, height } = fitWithin(img.width, img.height, MAX_SIDE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new BarPhotoError("This browser can't prepare the photo.");
    ctx.fillStyle = "#0E0E10"; // a PNG with see-through areas would otherwise turn black, so the station's own background shows through
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img.source, 0, 0, width, height);
    for (const q of QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", q));
      if (blob && blob.size <= MAX_OUTPUT_BYTES) return blob;
    }
    throw new BarPhotoError("That photo is still too big after shrinking. Try a simpler picture.");
  } finally {
    img.done();
  }
}

function friendly(message: string): string {
  if (/row-level security|not authorized|permission|jwt/i.test(message)) return "You don't have permission to upload photos. Sign in again and retry.";
  if (/exceeded the maximum allowed size|payload too large/i.test(message)) return "That photo is too big.";
  if (/failed to fetch|network|load failed/i.test(message)) return "Couldn't reach the server. Check your connection and try again.";
  return `Couldn't upload the photo (${message}).`;
}

/** Shrinks and uploads a photo for one menu item; resolves to its storage path (store it as `bar_photo`). */
export async function uploadBarPhoto(sb: SupabaseClient, itemId: string, file: File): Promise<string> {
  const blob = await shrinkToJpeg(file);
  const path = barUploadPath(itemId, Date.now());
  const { error } = await sb.storage.from(BAR_PHOTO_BUCKET).upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
  if (error) throw new BarPhotoError(friendly(error.message));
  return path;
}
