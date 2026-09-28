import { EXTRACTION_SYSTEM_PROMPT, parseExtraction } from "./extraction";
import type { Extraction } from "./types";

// gemini-3.8-flash: newest stable Gemini model with image input on the free tier
// (ai.google.dev/gemini-api/docs/models and /pricing, checked 28 Sep 2026). See docs/DECISIONS.md D1.
export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// Higher than Claude's 4000 in §10: on Gemini, thinking tokens count toward this limit.
const MAX_OUTPUT_TOKENS = 8192;

export class ExtractorError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export type ExtractResult = { extraction: Extraction; model: string; attempts: number; usage?: Record<string, number> };

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: Record<string, number>;
  error?: { message?: string; status?: string };
};

async function callOnce(
  args: { apiKey: string; model: string; imageBase64: string; mediaType: string },
  fetchImpl: typeof fetch,
): Promise<{ extraction: Extraction; usage?: Record<string, number> }> {
  let res: Response;
  try {
    res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(args.model)}:generateContent`, {
      method: "POST",
      // The key travels only in this header. It is never logged or returned.
      headers: { "content-type": "application/json", "x-goog-api-key": args.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ inlineData: { mimeType: args.mediaType, data: args.imageBase64 } }] }],
        generationConfig: { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: "application/json" },
      }),
    });
  } catch (e) {
    throw new ExtractorError(`could not reach the Gemini API (${(e as Error).message})`, true);
  }
  const body = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    throw new ExtractorError(`Gemini API error ${res.status}${body.error?.status ? ` ${body.error.status}` : ""}: ${body.error?.message ?? res.statusText}`, retryable);
  }
  if (body.promptFeedback?.blockReason) throw new ExtractorError(`Gemini blocked the image: ${body.promptFeedback.blockReason}`, false);
  const cand = body.candidates?.[0];
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
  if (!text) throw new ExtractorError(`the model returned no text (finishReason: ${cand?.finishReason ?? "none"})`, true);
  try {
    return { extraction: parseExtraction(text), usage: body.usageMetadata };
  } catch (e) {
    throw new ExtractorError((e as Error).message, true);
  }
}

/**
 * Transcribe one photo with Gemini using the §10 prompt. The model only transcribes;
 * all matching happens elsewhere, deterministically. Invalid output or a transient
 * API failure gets exactly one retry (§10), then a clear ExtractorError.
 */
export async function extractWithGemini(args: {
  apiKey: string;
  imageBase64: string;
  mediaType: string;
  model?: string;
  fetchImpl?: typeof fetch;
  onAttempt?: (attempt: number, error?: string) => void;
}): Promise<ExtractResult> {
  const model = args.model || DEFAULT_GEMINI_MODEL;
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  let last: ExtractorError | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await callOnce({ apiKey: args.apiKey, model, imageBase64: args.imageBase64, mediaType: args.mediaType }, fetchImpl);
      args.onAttempt?.(attempt);
      return { ...r, model, attempts: attempt };
    } catch (e) {
      last = e instanceof ExtractorError ? e : new ExtractorError(String(e), false);
      args.onAttempt?.(attempt, last.message);
      if (!last.retryable) break;
    }
  }
  throw new ExtractorError(
    last?.retryable ? `The vision model did not return a valid transcription after one retry (${last.message}).` : `Extraction failed: ${last?.message}`,
    false,
  );
}
