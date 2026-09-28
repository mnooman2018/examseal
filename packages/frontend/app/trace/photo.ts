import { EXTRACT_MAX_IMAGE_BYTES, type Hex, toHexBytes } from "examseal-core";

export type CompressedPhoto = {
  blob: Blob;
  base64: string;
  sha256: Hex;
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
  originalName: string;
};

const LONGEST_SIDE = 1600; // §10
const JPEG_QUALITY = 0.85; // §10

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * §10 step 1, entirely in the browser: downscale to a longest side of 1600 px and re-encode as
 * JPEG 0.85 through a canvas (which also drops EXIF, including GPS). Reject anything still over
 * 3 MB. imageSha256 is the hash of these compressed bytes, the exact bytes sent for transcription.
 */
export async function compressPhoto(file: File): Promise<CompressedPhoto> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} is not an image.`);
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new Error(
      `This browser cannot decode ${file.name}${/hei[cf]/i.test(file.type) ? " (HEIC). On iPhone, share it as JPEG (Settings → Camera → Formats → Most Compatible)" : ""}.`,
    );
  }
  const scale = Math.min(1, LONGEST_SIDE / Math.max(bmp.width, bmp.height));
  const width = Math.max(1, Math.round(bmp.width * scale));
  const height = Math.max(1, Math.round(bmp.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser.");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bmp, 0, 0, width, height);
  bmp.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw new Error("Could not re-encode the photo as JPEG.");
  if (blob.size > EXTRACT_MAX_IMAGE_BYTES) {
    throw new Error(`The photo is ${(blob.size / 1e6).toFixed(1)} MB after compression; the limit is 3 MB.`);
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return {
    blob,
    base64: toBase64(bytes),
    sha256: toHexBytes(digest),
    width,
    height,
    bytes: blob.size,
    originalBytes: file.size,
    originalName: file.name,
  };
}
