import { describe, expect, it } from "vitest";
import { EXTRACTION_SYSTEM_PROMPT } from "../src/forensic/extraction";
import { extractWithFallback } from "../src/forensic/extractor";
import { GEMINI_VISION_MODELS, geminiPlan } from "../src/forensic/gemini";
import { GROQ_VISION_MODELS, groqPlan } from "../src/forensic/groq";

const GOOD = '{"questions":[{"printedNumber":1,"text":"Which gate?","options":[{"label":"A","text":"AND"}]}],"legibility":"good"}';
const GEMINI_KEY = "gemini-test-key";
const GROQ_KEY = "groq-test-key";

type R = { status: number; body: unknown };
const geminiReply = (text: string): R => ({ status: 200, body: { candidates: [{ content: { parts: [{ text }] } }] } });
const groqReply = (content: string): R => ({ status: 200, body: { choices: [{ message: { content }, finish_reason: "stop" }] } });
const gemini503: R = { status: 503, body: { error: { status: "UNAVAILABLE", message: "high demand" } } };
const groq429: R = { status: 429, body: { error: { code: "rate_limit_exceeded", message: "Rate limit reached" } } };

/** One fake fetch serving both APIs. */
function fake(opts: { gemini: (model: string, n: number) => R; groq: (model: string, n: number) => R }) {
  const calls: { api: "gemini" | "groq"; model: string; init: RequestInit; url: string }[] = [];
  const count = new Map<string, number>();
  const impl = (async (url: string, init: RequestInit) => {
    const api = url.includes("groq.com") ? "groq" : "gemini";
    const model = api === "groq" ? JSON.parse(init.body as string).model : decodeURIComponent(/models\/([^:]+):/.exec(url)![1]);
    const n = (count.get(`${api}:${model}`) ?? 0) + 1;
    count.set(`${api}:${model}`, n);
    calls.push({ api, model, init, url });
    const r = opts[api](model, n);
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  let clock = 0;
  const image = { imageBase64: "aGVsbG8=", mediaType: "image/jpeg" };
  return {
    calls,
    run: (budgetMs = 50_000) =>
      extractWithFallback({
        providers: [geminiPlan({ apiKey: GEMINI_KEY, ...image, fetchImpl: impl }), groqPlan({ apiKey: GROQ_KEY, ...image, fetchImpl: impl })],
        budgetMs,
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      }),
  };
}

describe("Groq last-resort provider", () => {
  it("is not called when Gemini answers", async () => {
    const f = fake({ gemini: () => geminiReply(GOOD), groq: () => groqReply(GOOD) });
    const r = await f.run();
    expect(r.provider).toBe("gemini");
    expect(f.calls.every((c) => c.api === "gemini")).toBe(true);
  });

  it("answers when every Gemini model is busy, and names itself", async () => {
    const f = fake({ gemini: () => gemini503, groq: () => groqReply(GOOD) });
    const r = await f.run(10 * 60_000);
    expect(r.provider).toBe("groq");
    expect(r.model).toBe(GROQ_VISION_MODELS[0]);
    expect(f.calls.filter((c) => c.api === "gemini")).toHaveLength(GEMINI_VISION_MODELS.length * 3);
  });

  it("still gets its reserved time when Gemini uses up its share of a 50 s budget", async () => {
    const f = fake({ gemini: () => gemini503, groq: () => groqReply(GOOD) });
    const r = await f.run(50_000);
    expect(r.provider).toBe("groq");
  });

  it("is tried when the Gemini key is bad", async () => {
    const f = fake({ gemini: () => ({ status: 400, body: { error: { status: "INVALID_ARGUMENT", message: "API key not valid" } } }), groq: () => groqReply(GOOD) });
    const r = await f.run();
    expect(r.provider).toBe("groq");
    expect(r.tried[0]).toMatchObject({ provider: "gemini", ok: false, kind: "fatal" });
  });

  it("sends the §10 prompt, the photo as a data URL, JSON mode with hidden reasoning, and the key only in the header", async () => {
    const f = fake({ gemini: () => gemini503, groq: () => groqReply(GOOD) });
    await f.run(10 * 60_000);
    const g = f.calls.find((c) => c.api === "groq")!;
    expect(g.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect((g.init.headers as Record<string, string>).authorization).toBe(`Bearer ${GROQ_KEY}`);
    const body = JSON.parse(g.init.body as string);
    expect(body.messages[0]).toEqual({ role: "system", content: EXTRACTION_SYSTEM_PROMPT });
    expect(body.messages[1].content[0].image_url.url).toBe("data:image/jpeg;base64,aGVsbG8=");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.reasoning_format).toBe("hidden");
    expect(body.temperature).toBe(0);
    expect(g.init.body as string).not.toContain(GROQ_KEY);
    expect(g.init.body as string).not.toContain(GEMINI_KEY);
  });

  it("strips a stray <think> block and validates with zod", async () => {
    const f = fake({ gemini: () => gemini503, groq: () => groqReply(`<think>looking at the page</think>${GOOD}`) });
    expect((await f.run(10 * 60_000)).extraction.questions[0].text).toBe("Which gate?");
  });

  it("names both providers when everything fails", async () => {
    const f = fake({ gemini: () => gemini503, groq: () => groq429 });
    const err = await f.run(10 * 60_000).catch((e) => e);
    expect(err.message).toMatch(/Every vision model is busy/);
    expect(err.message).toContain("Gemini gemini-3.8-flash (503 UNAVAILABLE ×3)");
    expect(err.message).toContain(`Groq ${GROQ_VISION_MODELS[0]} (429 rate_limit_exceeded ×3)`);
  });
});
