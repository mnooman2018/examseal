import type { Extraction } from "./types";

// Provider-neutral retry and fallback for photo transcription (§10). A provider only knows how
// to make one call; everything about retries, fallbacks and time budgets lives here.

/**
 * kind: busy = 429/5xx/network (retry, then next model) · unavailable = model not found or not
 * allowed for this key (next model) · invalid = output failed validation (§10: one retry in total)
 * · fatal = bad key, bad image, blocked (stop this provider).
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

export type ProviderName = "gemini" | "groq";
export type CallOnce = (model: string) => Promise<{ extraction: Extraction; usage?: Record<string, number> }>;

export type ProviderPlan = {
  name: ProviderName;
  /** Tried in order, without duplicates. */
  models: readonly string[];
  callOnce: CallOnce;
  /** Time kept back from earlier providers so this one always gets a turn. */
  reserveMs?: number;
};

export type AttemptInfo = { provider: ProviderName; model: string; attempt: number; ok: boolean; error?: string; kind?: FailureKind };
export type ExtractResult = {
  extraction: Extraction;
  provider: ProviderName;
  model: string;
  attempts: number;
  tried: AttemptInfo[];
  usage?: Record<string, number>;
};

/** Busy: attempts per model, and the waits before attempts 2 and 3. */
const BUSY_ATTEMPTS_PER_MODEL = 3;
const BUSY_WAITS_MS = [1_000, 2_000];
/** If a server asks us to wait longer than this, move to the next model instead. */
const MAX_HONOURED_RETRY_DELAY_MS = 4_000;
/** Don't start a call with less time than this left. */
const MIN_CALL_BUDGET_MS = 8_000;

const PROVIDER_LABEL: Record<ProviderName, string> = { gemini: "Gemini", groq: "Groq" };

function summarise(tried: AttemptInfo[]): string {
  const byModel = new Map<string, string[]>();
  for (const t of tried) {
    if (t.ok) continue;
    const code = /^(\d{3}(?: [A-Za-z_]+)?)/.exec(t.error ?? "")?.[1] ?? t.kind ?? "error";
    const key = `${PROVIDER_LABEL[t.provider]} ${t.model}`;
    byModel.set(key, [...(byModel.get(key) ?? []), code]);
  }
  return [...byModel].map(([m, codes]) => `${m} (${codes.length > 1 && new Set(codes).size === 1 ? `${codes[0]} ×${codes.length}` : codes.join(", ")})`).join("; ");
}

/**
 * Try each provider's models in order until one returns a valid Extraction.
 * - busy: up to 3 attempts per model (waits 1 s, 2 s), then the next model
 * - unavailable: the next model
 * - invalid output: one retry in total across everything (§10), then a clear error
 * - fatal (bad key, bad image, blocked): stop this provider, go to the next provider
 * Each provider must finish before the time reserved for the providers after it.
 */
export async function extractWithFallback(args: {
  providers: ProviderPlan[];
  budgetMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  onAttempt?: (info: AttemptInfo) => void;
}): Promise<ExtractResult> {
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = args.now ?? Date.now;
  const deadline = now() + (args.budgetMs ?? 50_000);
  if (args.providers.length === 0) throw new ExtractorError("No transcription provider is configured.", "fatal");

  const tried: AttemptInfo[] = [];
  let invalidRetryUsed = false;
  let last: ExtractorError | undefined;

  for (let p = 0; p < args.providers.length; p++) {
    const plan = args.providers[p];
    const reservedLater = args.providers.slice(p + 1).reduce((t, x) => t + (x.reserveMs ?? 0), 0);
    const providerDeadline = deadline - reservedLater;
    const models = [...new Set(plan.models.map((m) => m.trim()).filter(Boolean))];

    provider: for (const model of models) {
      for (let attempt = 1; attempt <= BUSY_ATTEMPTS_PER_MODEL; attempt++) {
        if (providerDeadline - now() < MIN_CALL_BUDGET_MS) break provider;
        try {
          const r = await plan.callOnce(model);
          const info: AttemptInfo = { provider: plan.name, model, attempt, ok: true };
          tried.push(info);
          args.onAttempt?.(info);
          return { ...r, provider: plan.name, model, attempts: tried.length, tried };
        } catch (e) {
          last = e instanceof ExtractorError ? e : new ExtractorError(String(e), "fatal");
          const info: AttemptInfo = { provider: plan.name, model, attempt, ok: false, error: last.message, kind: last.kind };
          tried.push(info);
          args.onAttempt?.(info);
          if (last.kind === "fatal") break provider;
          if (last.kind === "unavailable") continue provider;
          if (last.kind === "invalid") {
            if (invalidRetryUsed) {
              throw new ExtractorError(
                `The vision model did not return a valid transcription after one retry (${PROVIDER_LABEL[plan.name]} ${model}: ${last.message}).`,
                "invalid",
              );
            }
            invalidRetryUsed = true;
            attempt--; // the §10 retry does not use up a busy attempt
            continue;
          }
          // busy
          if (attempt === BUSY_ATTEMPTS_PER_MODEL) continue provider;
          if (last.retryDelayMs !== undefined && last.retryDelayMs > MAX_HONOURED_RETRY_DELAY_MS) continue provider;
          const wait = Math.max(BUSY_WAITS_MS[attempt - 1] ?? 2_000, last.retryDelayMs ?? 0);
          if (providerDeadline - now() - wait < MIN_CALL_BUDGET_MS) continue provider;
          await sleep(wait);
        }
      }
    }
  }

  const allBusy = tried.length > 0 && tried.every((t) => t.kind === "busy" || t.kind === "unavailable");
  if (tried.length === 1 && last?.kind === "fatal") {
    throw new ExtractorError(`Extraction failed on ${PROVIDER_LABEL[tried[0].provider]} ${tried[0].model}: ${last.message}`, "fatal");
  }
  throw new ExtractorError(
    allBusy
      ? `Every vision model is busy or unavailable right now. Tried: ${summarise(tried)}. Try again in a minute.`
      : `Extraction failed. Tried: ${summarise(tried) || "no model (out of time)"}.${last ? ` Last error: ${last.message}` : ""}`,
    last?.kind ?? "busy",
  );
}
