import { EXTRACTION_SYSTEM_PROMPT, parseExtraction } from "./extraction";
import { type AttemptInfo, type CallOnce, type ExtractResult, ExtractorError, type ProviderPlan, extractWithFallback } from "./extractor";

// Stable Gemini models with image input and a free tier, newest first (ai.google.dev/gemini-api/docs
// models + pricing, re-checked 29 Sep 2026). The 2.5 series is excluded: Google now limits it to
// accounts that used it before. Preview models are excluded as unstable. See docs/DECISIONS.md D1, D6.
export const GEMINI_VISION_MODELS = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash",
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
] as const;
export const DEFAULT_GEMINI_MODEL = GEMINI_VISION_MODELS[0];

const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// Higher than Claude's 4000 in §10: on Gemini, thinking tokens count toward this limit.
const MAX_OUTPUT_TOKENS = 8192;

type GeminiResponse = {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: Record<string, number>;
  error?: { message?: string; status?: string; details?: { retryDelay?: string }[] };
};

function retryDelayMs(body: GeminiResponse, res: Response): number | undefined {
  const d = body.error?.details?.find((x) => typeof x.retryDelay === "string")?.retryDelay;
  const m = d ? /^([\d.]+)s$/.exec(d) : null;
  if (m) return Math.round(Number(m[1]) * 1000);
  const h = res.headers.get("retry-after");
  return h && /^\d+$/.test(h) ? Number(h) * 1000 : undefined;
}

/** One generateContent call with the §10 prompt. The key travels only in the x-goog-api-key header. */
export function geminiCallOnce(args: { apiKey: string; imageBase64: string; mediaType: string; fetchImpl?: typeof fetch }): CallOnce {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  return async (model) => {
    let res: Response;
    try {
      res = await fetchImpl(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": args.apiKey },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: EXTRACTION_SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ inlineData: { mimeType: args.mediaType, data: args.imageBase64 } }] }],
          generationConfig: { temperature: 0, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: "application/json" },
        }),
      });
    } catch (e) {
      throw new ExtractorError(`could not reach the Gemini API (${(e as Error).message})`, "busy");
    }
    const body = (await res.json().catch(() => ({}))) as GeminiResponse;
    if (!res.ok) {
      const msg = `${res.status}${body.error?.status ? ` ${body.error.status}` : ""}: ${body.error?.message ?? res.statusText}`;
      const kind = res.status === 429 || res.status >= 500 ? "busy" : res.status === 404 || res.status === 403 ? "unavailable" : "fatal";
      throw new ExtractorError(msg, kind, retryDelayMs(body, res));
    }
    if (body.promptFeedback?.blockReason) throw new ExtractorError(`blocked the image (${body.promptFeedback.blockReason})`, "fatal");
    const cand = body.candidates?.[0];
    const text = (cand?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
    if (!text) throw new ExtractorError(`returned no text (finishReason: ${cand?.finishReason ?? "none"})`, "invalid");
    try {
      return { extraction: parseExtraction(text), usage: body.usageMetadata };
    } catch (e) {
      throw new ExtractorError((e as Error).message, "invalid");
    }
  };
}

/** Gemini provider plan: `model` (e.g. GEMINI_MODEL) first, then GEMINI_VISION_MODELS. */
export function geminiPlan(args: { apiKey: string; imageBase64: string; mediaType: string; model?: string; models?: readonly string[]; fetchImpl?: typeof fetch }): ProviderPlan {
  return {
    name: "gemini",
    models: [args.model?.trim(), ...(args.models ?? GEMINI_VISION_MODELS)].filter((m): m is string => !!m),
    callOnce: geminiCallOnce(args),
  };
}

/** Gemini only (no Groq), with retries and model fallback. */
export function extractWithGemini(args: {
  apiKey: string;
  imageBase64: string;
  mediaType: string;
  model?: string;
  models?: readonly string[];
  budgetMs?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onAttempt?: (info: AttemptInfo) => void;
}): Promise<ExtractResult> {
  return extractWithFallback({ providers: [geminiPlan(args)], budgetMs: args.budgetMs, sleep: args.sleep, now: args.now, onAttempt: args.onAttempt });
}
