import { describe, expect, it } from "vitest";
import { EXTRACTION_SYSTEM_PROMPT, ExtractRequestSchema } from "../src/forensic/extraction";
import { ExtractorError } from "../src/forensic/extractor";
import { DEFAULT_GEMINI_MODEL, GEMINI_VISION_MODELS, extractWithGemini } from "../src/forensic/gemini";

const GOOD = '{"questions":[{"printedNumber":1,"text":"Which gate?","options":[{"label":"A","text":"AND"}]}],"legibility":"good"}';
const KEY = "test-key-not-real";

type R = { status: number; body: unknown };
const reply = (text: string): R => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] } });
const busy503: R = { status: 503, body: { error: { status: "UNAVAILABLE", message: "This model is currently experiencing high demand" } } };
const quota429 = (retryDelay?: string): R => ({
  status: 429,
  body: { error: { status: "RESOURCE_EXHAUSTED", message: "quota", details: retryDelay ? [{ retryDelay }] : [] } },
});
const notFound: R = { status: 404, body: { error: { status: "NOT_FOUND", message: "model not found" } } };

/** Fake Gemini: `script(model, n)` returns the response for the n-th call to that model. */
function fake(script: (model: string, n: number) => R) {
  const calls: { model: string; init: RequestInit; url: string }[] = [];
  const perModel = new Map<string, number>();
  const impl = (async (url: string, init: RequestInit) => {
    const model = decodeURIComponent(/models\/([^:]+):/.exec(url)![1]);
    const n = (perModel.get(model) ?? 0) + 1;
    perModel.set(model, n);
    calls.push({ model, init, url });
    const r = script(model, n);
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  let clock = 0;
  const slept: number[] = [];
  return {
    calls,
    slept,
    run: (extra: Partial<Parameters<typeof extractWithGemini>[0]> = {}) =>
      extractWithGemini({
        apiKey: KEY,
        imageBase64: "aGVsbG8=",
        mediaType: "image/jpeg",
        fetchImpl: impl,
        now: () => clock,
        sleep: async (ms) => {
          slept.push(ms);
          clock += ms;
        },
        ...extra,
      }),
  };
}

describe("extractWithGemini (§10 + fallback)", () => {
  it("sends the §10 prompt, temperature 0 and the key only in the header", async () => {
    const f = fake(() => reply(GOOD));
    const r = await f.run();
    expect(r.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(r.attempts).toBe(1);
    const { url, init } = f.calls[0];
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe(EXTRACTION_SYSTEM_PROMPT);
    expect(body.generationConfig.temperature).toBe(0);
    expect(init.body as string).not.toContain(KEY);
  });

  it("uses GEMINI_MODEL first, then the fallback list without duplicates", async () => {
    const f = fake((m) => (m === "gemini-3.7-flash" ? reply(GOOD) : notFound));
    const r = await f.run({ model: "gemini-3.5-flash" });
    expect(f.calls.map((c) => c.model)).toEqual(["gemini-3.5-flash", "gemini-3.8-flash", "gemini-3.7-flash"]);
    expect(r.model).toBe("gemini-3.7-flash");
  });

  it("retries a busy model 3 times with 1 s and 2 s waits, then falls back", async () => {
    const f = fake((m) => (m === "gemini-3.8-flash" ? busy503 : reply(GOOD)));
    const r = await f.run();
    expect(f.calls.map((c) => c.model)).toEqual(["gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.8-flash", "gemini-3.7-flash"]);
    expect(f.slept).toEqual([1000, 2000]);
    expect(r.model).toBe("gemini-3.7-flash");
    expect(r.tried.filter((t) => !t.ok).every((t) => t.kind === "busy")).toBe(true);
  });

  it("recovers on the same model when a 503 clears", async () => {
    const f = fake((_m, n) => (n === 1 ? busy503 : reply(GOOD)));
    const r = await f.run();
    expect(r.model).toBe("gemini-3.8-flash");
    expect(r.attempts).toBe(2);
  });

  it("skips to the next model when a 429 asks for a long wait", async () => {
    const f = fake((m) => (m === "gemini-3.8-flash" ? quota429("33s") : reply(GOOD)));
    const r = await f.run();
    expect(f.calls.map((c) => c.model)).toEqual(["gemini-3.8-flash", "gemini-3.7-flash"]);
    expect(f.slept).toEqual([]);
    expect(r.model).toBe("gemini-3.7-flash");
  });

  it("names every model tried when all are busy", async () => {
    const f = fake(() => busy503);
    const err = await f.run({ budgetMs: 10 * 60_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(ExtractorError);
    expect(err.message).toMatch(/Every vision model is busy/);
    for (const m of GEMINI_VISION_MODELS) expect(err.message).toContain(`${m} (503 UNAVAILABLE ×3)`);
    expect(f.calls).toHaveLength(GEMINI_VISION_MODELS.length * 3);
  });

  it("stays inside the time budget", async () => {
    const f = fake(() => busy503);
    await f.run({ budgetMs: 20_000 }).catch(() => undefined);
    expect(f.slept.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(20_000);
  });

  it("invalid output: one retry in total (§10), then a clear error; no model fallback", async () => {
    const ok = fake((_m, n) => (n === 1 ? reply("Sure! Here is the JSON") : reply(GOOD)));
    expect((await ok.run()).attempts).toBe(2);
    const bad = fake(() => reply('{"questions":[]}'));
    await expect(bad.run()).rejects.toThrow(/did not return a valid transcription after one retry \(Gemini gemini-3\.8-flash/);
    expect(bad.calls).toHaveLength(2);
  });

  it("stops at once on a bad key (400), without leaking the key", async () => {
    const f = fake(() => ({ status: 400, body: { error: { status: "INVALID_ARGUMENT", message: "API key not valid" } } }));
    const err = await f.run().catch((e) => e);
    expect(err.message).toMatch(/gemini-3\.8-flash: 400 INVALID_ARGUMENT: API key not valid/);
    expect(err.message).not.toContain(KEY);
    expect(f.calls).toHaveLength(1);
  });

  it("ignores thought parts and stops on blocked images", async () => {
    const f = fake(() => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: GOOD }] } }] } }));
    expect((await f.run()).extraction.legibility).toBe("good");
    const blocked = fake(() => ({ status: 200, body: { promptFeedback: { blockReason: "SAFETY" } } }));
    await expect(blocked.run()).rejects.toThrow(/blocked.*SAFETY/);
  });
});

describe("ExtractRequestSchema", () => {
  it("accepts plain base64 JPEG/PNG/WebP and rejects the rest", () => {
    expect(ExtractRequestSchema.safeParse({ imageBase64: "aGVsbG8gd29ybGQh", mediaType: "image/jpeg" }).success).toBe(true);
    expect(ExtractRequestSchema.safeParse({ imageBase64: "data:image/jpeg;base64,aGVsbG8=", mediaType: "image/jpeg" }).success).toBe(false);
    expect(ExtractRequestSchema.safeParse({ imageBase64: "aGVsbG8gd29ybGQh", mediaType: "image/gif" }).success).toBe(false);
    expect(ExtractRequestSchema.safeParse({ imageBase64: "aGVsbG8gd29ybGQh", mediaType: "image/jpeg", codebook: {} }).success).toBe(false);
  });
});
