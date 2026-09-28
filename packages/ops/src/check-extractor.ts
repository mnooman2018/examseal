import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import {
  EXTRACT_MAX_IMAGE_BYTES,
  ExtractorError,
  type ProviderPlan,
  extractWithFallback,
  geminiPlan,
  groqPlan,
} from "examseal-core";
import { UserError, loadEnv, userPath } from "./env";

/**
 * pnpm ops check-extractor <image-path> [--provider auto|gemini|groq]
 *
 * Sends one photo with the §10 prompt (same code as /api/extract) and prints the validated
 * Extraction JSON. auto (default) = Gemini with model fallback, then Groq as a last resort if
 * GROQ_API_KEY is set. Keys are read from .env.local and only ever sent in request headers;
 * they are never printed or logged.
 */

// The web app compresses to ≤ 3 MB (§10). The CLI sends the file as-is, so allow more here;
// inline Gemini requests are capped at 20 MB, Groq image requests at 20 MB.
const MAX_IMAGE_BYTES = Math.max(EXTRACT_MAX_IMAGE_BYTES, 15 * 1024 * 1024);

const MEDIA_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
};

const LABEL: Record<string, string> = { gemini: "Gemini", groq: "Groq" };

export async function checkExtractor(imagePath: string | undefined, opts: { provider?: string } = {}): Promise<number> {
  if (!imagePath) throw new UserError("Usage: pnpm ops check-extractor <image-path> [--provider auto|gemini|groq]");
  const which = (opts.provider ?? "auto").toLowerCase();
  if (!["auto", "gemini", "groq"].includes(which)) throw new UserError("--provider must be auto, gemini or groq");
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
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const groqKey = process.env.GROQ_API_KEY?.trim();
  const image = { imageBase64: readFileSync(file).toString("base64"), mediaType };
  const providers: ProviderPlan[] = [];
  if (which !== "groq") {
    if (!geminiKey) throw new UserError("GEMINI_API_KEY is not set in .env.local");
    providers.push(geminiPlan({ apiKey: geminiKey, model: process.env.GEMINI_MODEL, ...image }));
  }
  if (which !== "gemini") {
    if (groqKey) providers.push(groqPlan({ apiKey: groqKey, model: process.env.GROQ_MODEL, ...image }));
    else if (which === "groq") throw new UserError("GROQ_API_KEY is not set in .env.local");
  }

  console.error(`Sending ${path.basename(file)} (${(size / 1e6).toFixed(2)} MB, ${mediaType})`);
  for (const p of providers) console.error(`  ${LABEL[p.name]}: ${[...new Set(p.models)].join(" → ")}`);
  const started = Date.now();
  try {
    const r = await extractWithFallback({
      providers,
      budgetMs: 120_000, // the CLI can wait longer than the 60 s web route
      onAttempt: (a) =>
        console.error(`  ${LABEL[a.provider]} ${a.model} attempt ${a.attempt}: ${a.ok ? "valid Extraction" : `${a.kind}: ${a.error}`}`),
    });
    console.log(JSON.stringify(r.extraction, null, 2));
    const x = r.extraction;
    if (r.usage) console.error(`  tokens: ${JSON.stringify(r.usage)}`);
    console.error(
      `\nModel that answered: ${LABEL[r.provider]} ${r.model} (${r.attempts} call${r.attempts === 1 ? "" : "s"} in total)` +
        `\n${x.questions.length} question(s), ${x.questions.reduce((n, q) => n + q.options.length, 0)} option(s), legibility: ${x.legibility}` +
        ` · ${((Date.now() - started) / 1000).toFixed(1)} s`,
    );
    return 0;
  } catch (e) {
    if (e instanceof ExtractorError) throw new UserError(e.message);
    throw e;
  }
}
