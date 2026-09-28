import { EXTRACTION_SYSTEM_PROMPT, parseExtraction } from "./extraction";
import type { Extraction } from "./types";

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
/** Busy (429/5xx/network): attempts per model, and the waits before attempts 2 and 3. */
const BUSY_ATTEMPTS_PER_MODEL = 3;
const BUSY_WAITS_MS = [1_000, 2_000];
/** If Google asks us to wait longer than this, move to the next model instead. */
const MAX_HONOURED_RETRY_DELAY_MS = 4_000;
/** Don't start a call with less time than this left in the budget. */
const MIN_CALL_BUDGET_MS = 8_000;

/**
 * kind: busy = 429/5xx/network (retry, then next model) · unavailable = model not found or not
 * allowed for this key (next model) · invalid = output failed validation (§10: one retry) ·
 * fatal = bad key, bad image, blocked (stop).
 */
export type FailureKind = "busy" | "unavailable" | "invalid" | "fatal";

export class ExtractorError extends Error {
  constructor(
    message: string,
    readonly kind: FailureKind,
    readonly retryDelayMs?: number,
  ) {
    super(message);
  }
  /** Kept for callers of the earlier API. */
  get retryable(): boolean {
    return this.kind === "busy" || this.kind === "invalid";
  }
}

export type AttemptInfo = { model: string; attempt: number; ok: boolean; error?: string; kind?: FailureKind };
export type ExtractResult = { extraction: Extraction; model: string; attempts: number; tried: AttemptInfo[]; usage?: Record<string, number> };

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
    throw new ExtractorError(`could not reach the Gemini API (${(e as Error).message})`, "busy");
  }
  const body = (await res.json().catch(() => ({}))) as GeminiResponse;
  if (!res.ok) {
    const msg = `${res.status}${body.error?.status ? ` ${body.error.status}` : ""}: ${body.error?.message ?? res.statusText}`;
    const kind: FailureKind =
      res.status === 429 || res.status >= 500 ? "busy" : res.status === 404 || res.status === 403 ? "unavailable" : "fatal";
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
}

function summarise(tried: AttemptInfo[]): string {
  const byModel = new Map<string, string[]>();
  for (const t of tried) {
    if (t.ok) continue;
    const code = /^(\d{3}(?: [A-Z_]+)?)/.exec(t.error ?? "")?.[1] ?? t.kind ?? "error";
    byModel.set(t.model, [...(byModel.get(t.model) ?? []), code]);
  }
  return [...byModel].map(([m, codes]) => `${m} (${codes.length > 1 && new Set(codes).size === 1 ? `${codes[0]} ×${codes.length}` : codes.join(", ")})`).join("; ");
}

/**
 * Transcribe one photo with Gemini using the §10 prompt. The model only transcribes; matching
 * happens elsewhere, deterministically.
 * - Busy (429/5xx/network): up to 3 attempts per model with 1 s and 2 s waits, then the next model.
 * - Model not found / not allowed for this key: the next model.
 * - Invalid output: one retry in total (§10), then a clear error.
 * - Bad key, bad image, blocked: stop at once.
 * Models: `model` (e.g. GEMINI_MODEL) first, then GEMINI_VISION_MODELS, without duplicates.
 * Everything stays inside `budgetMs` (the /api/extract route has 60 s).
 */
export async function extractWithGemini(args: {
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
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = args.now ?? Date.now;
  const deadline = now() + (args.budgetMs ?? 50_000);
  const models = [...new Set([args.model?.trim(), ...(args.models ?? GEMINI_VISION_MODELS)].filter((m): m is string => !!m))];

  const tried: AttemptInfo[] = [];
  let invalidRetryUsed = false;
  let last: ExtractorError | undefined;
  const record = (info: AttemptInfo) => {
    tried.push(info);
    args.onAttempt?.(info);
  };

  outer: for (const model of models) {
    for (let attempt = 1; attempt <= BUSY_ATTEMPTS_PER_MODEL; attempt++) {
      if (deadline - now() < MIN_CALL_BUDGET_MS) break outer;
      try {
        const r = await callOnce({ apiKey: args.apiKey, model, imageBase64: args.imageBase64, mediaType: args.mediaType }, fetchImpl);
        record({ model, attempt, ok: true });
        return { ...r, model, attempts: tried.length, tried };
      } catch (e) {
        last = e instanceof ExtractorError ? e : new ExtractorError(String(e), "fatal");
        record({ model, attempt, ok: false, error: last.message, kind: last.kind });
        if (last.kind === "fatal") {
          throw new ExtractorError(`Extraction failed on ${model}: ${last.message}`, "fatal");
        }
        if (last.kind === "unavailable") continue outer;
        if (last.kind === "invalid") {
          if (invalidRetryUsed) {
            throw new ExtractorError(`The vision model did not return a valid transcription after one retry (${model}: ${last.message}).`, "invalid");
          }
          invalidRetryUsed = true;
          attempt--; // the §10 retry does not use up a busy attempt
          continue;
        }
        // busy
        if (attempt === BUSY_ATTEMPTS_PER_MODEL) continue outer;
        if (last.retryDelayMs !== undefined && last.retryDelayMs > MAX_HONOURED_RETRY_DELAY_MS) continue outer;
        const wait = Math.max(BUSY_WAITS_MS[attempt - 1] ?? 2_000, last.retryDelayMs ?? 0);
        if (deadline - now() - wait < MIN_CALL_BUDGET_MS) continue outer;
        await sleep(wait);
      }
    }
  }
  const allBusy = tried.length > 0 && tried.every((t) => t.kind === "busy" || t.kind === "unavailable");
  throw new ExtractorError(
    allBusy
      ? `Every Gemini model is busy or unavailable right now. Tried: ${summarise(tried)}. Try again in a minute.`
      : `Extraction failed. Tried: ${summarise(tried) || "no model (out of time)"}.${last ? ` Last error: ${last.message}` : ""}`,
    last?.kind ?? "busy",
  );
}
