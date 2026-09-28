import { z } from "zod";
import type { Extraction } from "./types";

/** System prompt from CLAUDE.md §10. The vision model only transcribes; it never decides. */
export const EXTRACTION_SYSTEM_PROMPT = `You transcribe printed exam question papers from photos. Output ONLY a JSON object, no prose, no code fences:
{"questions":[{"printedNumber":<int or null>,"text":"<question text>","options":[{"label":"A"|"B"|"C"|"D"|null,"text":"<option text>"}]}],"legibility":"good"|"partial"|"poor"}
Rules:
- Transcribe exactly as printed. Do not correct spelling, paraphrase, translate, or complete cut-off text.
- Keep questions and options in the order they appear on the page.
- If a question or option is unreadable or cut off, omit it rather than guessing.
- printedNumber is the number printed before the question, or null if not visible.
- Ignore headers, instructions, watermarks, and handwriting.`;

export const ExtractionSchema = z
  .object({
    questions: z.array(
      z.object({
        printedNumber: z.number().int().nullable(),
        text: z.string(),
        options: z.array(
          z.object({
            label: z.enum(["A", "B", "C", "D"]).nullable(),
            text: z.string(),
          }),
        ),
      }),
    ),
    legibility: z.enum(["good", "partial", "poor"]),
  })
  .strict();

/** Parse and validate the model's raw text output. Throws with a readable reason. */
export function parseExtraction(raw: string): Extraction {
  let json: unknown;
  try {
    json = JSON.parse(raw.trim());
  } catch {
    throw new Error("extractor output is not valid JSON");
  }
  const r = ExtractionSchema.safeParse(json);
  if (!r.success) {
    const first = r.error.issues[0];
    throw new Error(`extractor output does not match the schema: ${first.path.join(".") || "(root)"}: ${first.message}`);
  }
  return r.data;
}

/** §10: the browser compresses to ≤ 3 MB, keeping the request under Vercel's ~4.5 MB body limit. */
export const EXTRACT_MAX_IMAGE_BYTES = 3 * 1024 * 1024;
export const EXTRACT_MEDIA_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Body of POST /api/extract. */
export const ExtractRequestSchema = z
  .object({
    imageBase64: z
      .string()
      .min(16, "image is empty")
      .max(Math.ceil((EXTRACT_MAX_IMAGE_BYTES * 4) / 3) + 4, "image is larger than 3 MB after compression")
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, "imageBase64 must be plain base64 (no data: prefix)"),
    mediaType: z.enum(EXTRACT_MEDIA_TYPES),
  })
  .strict();
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>;
