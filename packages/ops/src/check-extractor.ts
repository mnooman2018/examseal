import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { DEFAULT_GEMINI_MODEL, EXTRACT_MAX_IMAGE_BYTES, ExtractorError, extractWithGemini } from "examseal-core";
import { UserError, loadEnv, userPath } from "./env";

/**
 * pnpm ops check-extractor <image-path>
 *
 * Sends one photo to Gemini with the §10 prompt (same code as /api/extract) and prints the
 * validated Extraction JSON. GEMINI_API_KEY is read from .env.local and only ever sent in
 * the x-goog-api-key request header; it is never printed or logged.
 */

// The web app compresses to ≤ 3 MB (§10). The CLI sends the file as-is, so allow more here;
// inline Gemini requests are capped at 20 MB.
const MAX_IMAGE_BYTES = Math.max(EXTRACT_MAX_IMAGE_BYTES, 15 * 1024 * 1024);

const MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

export async function checkExtractor(imagePath: string | undefined): Promise<number> {
  if (!imagePath) throw new UserError("Usage: pnpm ops check-extractor <image-path>");
  const file = userPath(imagePath);
  let size: number;
  try {
    size = statSync(file).size;
  } catch {
    throw new UserError(`Image not found: ${file}`);
  }
  const mediaType = MEDIA_TYPES[path.extname(file).toLowerCase()];
  if (!mediaType) throw new UserError(`Unsupported image type ${path.extname(file)}; use .jpg, .png, .webp or .heic`);
  if (size > MAX_IMAGE_BYTES) throw new UserError(`Image is ${(size / 1e6).toFixed(1)} MB; max 15 MB`);

  loadEnv();
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new UserError("GEMINI_API_KEY is not set in .env.local");
  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

  console.error(`Sending ${path.basename(file)} (${(size / 1e6).toFixed(2)} MB, ${mediaType}) to ${model}…`);
  const started = Date.now();
  try {
    const r = await extractWithGemini({
      apiKey,
      model,
      imageBase64: readFileSync(file).toString("base64"),
      mediaType,
      onAttempt: (n, err) => console.error(`  attempt ${n}: ${err ?? "valid Extraction"}`),
    });
    console.log(JSON.stringify(r.extraction, null, 2));
    const x = r.extraction;
    if (r.usage) console.error(`  tokens: ${JSON.stringify(r.usage)}`);
    console.error(
      `\n${x.questions.length} question(s), ${x.questions.reduce((n, q) => n + q.options.length, 0)} option(s), legibility: ${x.legibility}` +
        ` · ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
    return 0;
  } catch (e) {
    if (e instanceof ExtractorError) throw new UserError(e.message);
    throw e;
  }
}
