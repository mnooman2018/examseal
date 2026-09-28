import { EXTRACTION_SYSTEM_PROMPT, parseExtraction } from "./extraction";
import { type CallOnce, ExtractorError, type ProviderPlan } from "./extractor";

// Groq vision models (console.groq.com/docs/vision, /models and /rate-limits, checked 29 Sep 2026).
// qwen/qwen3.8-27b is the only vision model; it is on the free plan (30 RPM, 1K RPD, 8K TPM)
// but Groq marks it PREVIEW ("may be discontinued at short notice"). Last resort only; see D7.
export const GROQ_VISION_MODELS = ["qwen/qwen3.8-27b"] as const;

const ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
// An image costs 2048 input tokens; with the prompt and this cap a call stays under the 8K TPM limit.
const MAX_COMPLETION_TOKENS = 4000;
/** Time kept back for Groq when it runs after Gemini. */
export const GROQ_RESERVE_MS = 15_000;

type GroqResponse = {
  choices?: { message?: { content?: string | null }; finish_reason?: string }[];
  usage?: Record<string, number>;
  error?: { message?: string; type?: string; code?: string };
};

/**
 * One chat-completions call with the §10 prompt as the system message and the photo as a data URL.
 * JSON mode requires reasoning_format "hidden" (or "parsed"); reasoning is also switched off to save
 * tokens. The key travels only in the Authorization header.
 */
export function groqCallOnce(args: { apiKey: string; imageBase64: string; mediaType: string; fetchImpl?: typeof fetch }): CallOnce {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  return async (model) => {
    let res: Response;
    try {
      res = await fetchImpl(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${args.apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
            { role: "user", content: [{ type: "image_url", image_url: { url: `data:${args.mediaType};base64,${args.imageBase64}` } }] },
          ],
          temperature: 0,
          max_completion_tokens: MAX_COMPLETION_TOKENS,
          response_format: { type: "json_object" },
          reasoning_format: "hidden",
          reasoning_effort: "none",
        }),
      });
    } catch (e) {
      throw new ExtractorError(`could not reach the Groq API (${(e as Error).message})`, "busy");
    }
    const body = (await res.json().catch(() => ({}))) as GroqResponse;
    if (!res.ok) {
      const code = body.error?.code ?? body.error?.type;
      const msg = `${res.status}${code ? ` ${code}` : ""}: ${body.error?.message ?? res.statusText}`;
      const kind = res.status === 429 || res.status >= 500 ? "busy" : res.status === 404 || res.status === 403 ? "unavailable" : "fatal";
      const h = res.headers.get("retry-after");
      throw new ExtractorError(msg, kind, h && /^[\d.]+$/.test(h) ? Math.round(Number(h) * 1000) : undefined);
    }
    const choice = body.choices?.[0];
    // Defensive: strip any reasoning block if one slips through.
    const text = (choice?.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "").trim();
    if (!text) throw new ExtractorError(`returned no text (finish_reason: ${choice?.finish_reason ?? "none"})`, "invalid");
    try {
      return { extraction: parseExtraction(text), usage: body.usage };
    } catch (e) {
      throw new ExtractorError((e as Error).message, "invalid");
    }
  };
}

/** Groq provider plan: `model` (e.g. GROQ_MODEL) first, then GROQ_VISION_MODELS. */
export function groqPlan(args: { apiKey: string; imageBase64: string; mediaType: string; model?: string; fetchImpl?: typeof fetch }): ProviderPlan {
  return {
    name: "groq",
    models: [args.model?.trim(), ...GROQ_VISION_MODELS].filter((m): m is string => !!m),
    callOnce: groqCallOnce(args),
    reserveMs: GROQ_RESERVE_MS,
  };
}
