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
