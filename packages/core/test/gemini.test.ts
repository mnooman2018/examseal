import { describe, expect, it } from "vitest";
import { EXTRACTION_SYSTEM_PROMPT, ExtractRequestSchema } from "../src/forensic/extraction";
import { DEFAULT_GEMINI_MODEL, ExtractorError, extractWithGemini } from "../src/forensic/gemini";

const GOOD = '{"questions":[{"printedNumber":1,"text":"Which gate?","options":[{"label":"A","text":"AND"}]}],"legibility":"good"}';
const KEY = "test-key-not-real";

type Call = { url: string; init: RequestInit };
function fakeFetch(responses: { status: number; body: unknown }[]) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const reply = (text: string) => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] } });
const run = (f: ReturnType<typeof fakeFetch>) => extractWithGemini({ apiKey: KEY, imageBase64: "aGVsbG8=", mediaType: "image/jpeg", fetchImpl: f.impl });

describe("extractWithGemini (§10)", () => {
  it("sends the §10 prompt, temperature 0 and the key only in the header", async () => {
    const f = fakeFetch([reply(GOOD)]);
    const r = await run(f);
    expect(r.attempts).toBe(1);
    expect(r.model).toBe(DEFAULT_GEMINI_MODEL);
    expect(r.extraction.questions[0].text).toBe("Which gate?");
    const { url, init } = f.calls[0];
    expect(url).toContain(`/models/${DEFAULT_GEMINI_MODEL}:generateContent`);
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = JSON.parse(init.body as string);
    expect(body.systemInstruction.parts[0].text).toBe(EXTRACTION_SYSTEM_PROMPT);
    expect(body.generationConfig.temperature).toBe(0);
    expect(init.body as string).not.toContain(KEY);
  });

  it("retries once on invalid output, then succeeds", async () => {
    const f = fakeFetch([reply("Sure! Here is the JSON"), reply(GOOD)]);
    const r = await run(f);
    expect(r.attempts).toBe(2);
    expect(f.calls).toHaveLength(2);
  });

  it("gives a clear error after one retry, never a third call", async () => {
    const f = fakeFetch([reply('{"questions":[]}'), reply("not json")]);
    await expect(run(f)).rejects.toThrow(/did not return a valid transcription after one retry/);
    expect(f.calls).toHaveLength(2);
  });

  it("retries a 503 once but not a 400", async () => {
    const f503 = fakeFetch([{ status: 503, body: { error: { message: "overloaded" } } }, reply(GOOD)]);
    expect((await run(f503)).attempts).toBe(2);
    const f400 = fakeFetch([{ status: 400, body: { error: { message: "API key not valid", status: "INVALID_ARGUMENT" } } }]);
    const err = await run(f400).catch((e) => e);
    expect(err).toBeInstanceOf(ExtractorError);
    expect(err.message).toMatch(/400.*API key not valid/);
    expect(err.message).not.toContain(KEY);
    expect(f400.calls).toHaveLength(1);
  });

  it("ignores thought parts and reports blocked images", async () => {
    const f = fakeFetch([{ status: 200, body: { candidates: [{ content: { parts: [{ text: "thinking…", thought: true }, { text: GOOD }] } }] } }]);
    expect((await run(f)).extraction.legibility).toBe("good");
    const blocked = fakeFetch([{ status: 200, body: { promptFeedback: { blockReason: "SAFETY" } } }]);
    await expect(run(blocked)).rejects.toThrow(/blocked.*SAFETY/);
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
