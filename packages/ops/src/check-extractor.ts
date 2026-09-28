import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { EXTRACTION_SYSTEM_PROMPT, type Extraction, parseExtraction } from "examseal-core";
import { UserError, loadEnv, userPath } from "./env";

/**
 * pnpm ops check-extractor <image-path>
 *
 * Sends one photo to the Gemini vision model with the §10 prompt and prints the
 * validated Extraction JSON. GEMINI_API_KEY is read from .env.local and only ever
 * sent in the x-goog-api-key request header; it is never printed or logged.
 */

// gemini-3.8-flash: newest stable Gemini model with image input on the free tier
// (ai.google.dev/gemini-api/docs/models and /pricing, checked 28 Sep 2026).
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// Inline requests are capped at 20 MB; the web app compresses to ≤ 3 MB first (§10).
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
// Higher than Claude's 4000 in §10: on Gemini, thinking tokens count toward this limit.
const MAX_OUTPUT_TOKENS = 8192;

const MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: Record<string, number>;
  error?: { code?: number; message?: string; status?: string };
};

async function callGemini(apiKey: string, model: string, imageBase64: string, mediaType: string): Promise<string> {
  const res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_PROMPT }] },
      contents: [{ role: "user", parts: [{ inlineData: { mimeType: mediaType, data: imageBase64 } }] }],
      generationConfig: { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: "application/json" },
    }),
  });
  const body = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    throw new UserError(`Gemini API error ${res.status} ${body.error?.status ?? ""}: ${body.error?.message ?? res.statusText}`);
  }
  if (body.promptFeedback?.blockReason) throw new UserError(`Gemini blocked the request: ${body.promptFeedback.blockReason}`);
  const cand = body.candidates?.[0];
  const text = (cand?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
  if (body.usageMetadata) console.error(`  tokens: ${JSON.stringify(body.usageMetadata)}`);
  if (cand?.finishReason && cand.finishReason !== "STOP") console.error(`  finishReason: ${cand.finishReason}`);
  if (!text) throw new Error(`empty response (finishReason: ${cand?.finishReason ?? "none"})`);
  return text;
}

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

  const imageBase64 = readFileSync(file).toString("base64");
  console.error(`Sending ${path.basename(file)} (${(size / 1e6).toFixed(2)} MB, ${mediaType}) to ${model}…`);

  // §10: invalid output gets one retry, then a clear error.
  let extraction: Extraction | undefined;
  for (let attempt = 1; attempt <= 2 && !extraction; attempt++) {
    const started = Date.now();
    try {
      const raw = await callGemini(apiKey, model, imageBase64, mediaType);
      extraction = parseExtraction(raw);
      console.error(`  attempt ${attempt}: valid Extraction in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    } catch (e) {
      if (e instanceof UserError) throw e;
      console.error(`  attempt ${attempt}: ${(e as Error).message}`);
      if (attempt === 2) throw new UserError("The model did not return a valid Extraction after one retry.");
    }
  }

  console.log(JSON.stringify(extraction, null, 2));
  const x = extraction!;
  console.error(
    `\n${x.questions.length} question(s), ${x.questions.reduce((n, q) => n + q.options.length, 0)} option(s), legibility: ${x.legibility}`,
  );
  return 0;
}
