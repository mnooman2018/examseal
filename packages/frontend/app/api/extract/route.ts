import { ExtractRequestSchema, ExtractorError, type ProviderPlan, extractWithFallback, geminiPlan, groqPlan } from "examseal-core";
import { loadRootEnvForDev } from "./devEnv";

// §10: Node runtime, up to 60 s for the vision call.
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Tried = { provider: string; model: string; attempt: number; ok: boolean; error?: string };
type Reply =
  | { ok: true; provider: "gemini" | "groq"; model: string; attempts: number; tried: Tried[]; extraction: unknown }
  | { ok: false; error: string };

const json = (body: Reply, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/**
 * POST /api/extract { imageBase64, mediaType } → { ok, provider, model, extraction }.
 * The vision model only transcribes text (§10). This route receives only the compressed photo:
 * no codebook, no keys, no exam data. Matching happens in the browser.
 * Providers: Gemini (GEMINI_MODEL first, then the free vision models), then Groq as a last
 * resort when GROQ_API_KEY is set (D6, D7). EXTRACTOR_PROVIDER=groq uses Groq only.
 */
export async function POST(req: Request): Promise<Response> {
  // Same-origin only: this route spends the team's API quota.
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) {
    return json({ ok: false, error: "Cross-origin requests are not allowed." }, 403);
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ ok: false, error: "Request body must be JSON: { imageBase64, mediaType }." }, 400);
  }
  const parsed = ExtractRequestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return json({ ok: false, error: `Invalid request: ${issue.path.join(".") || "body"}: ${issue.message}` }, 400);
  }

  loadRootEnvForDev();
  const provider = (process.env.EXTRACTOR_PROVIDER || "gemini").trim();
  if (provider !== "gemini" && provider !== "groq") {
    return json({ ok: false, error: `EXTRACTOR_PROVIDER=${provider} is not available in this build. Use gemini (Groq as fallback) or groq.` }, 501);
  }
  const image = { imageBase64: parsed.data.imageBase64, mediaType: parsed.data.mediaType };
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const groqKey = process.env.GROQ_API_KEY?.trim();
  const providers: ProviderPlan[] = [];
  if (provider === "gemini" && geminiKey) providers.push(geminiPlan({ apiKey: geminiKey, model: process.env.GEMINI_MODEL, ...image }));
  if (groqKey) providers.push(groqPlan({ apiKey: groqKey, model: process.env.GROQ_MODEL, ...image }));
  if (providers.length === 0) {
    return json({ ok: false, error: `The server is missing ${provider === "groq" ? "GROQ_API_KEY" : "GEMINI_API_KEY"}, so photos cannot be transcribed.` }, 500);
  }

  try {
    const r = await extractWithFallback({ providers, budgetMs: 50_000 }); // maxDuration is 60 s
    const tried = r.tried.map(({ provider, model, attempt, ok, error }) => ({ provider, model, attempt, ok, error }));
    return json({ ok: true, provider: r.provider, model: r.model, attempts: r.attempts, tried, extraction: r.extraction }, 200);
  } catch (e) {
    const message = e instanceof ExtractorError ? e.message : "Unexpected error while transcribing the photo.";
    return json({ ok: false, error: message }, 502);
  }
}
