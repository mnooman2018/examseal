import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type CandidateCode,
  type Extraction,
  type Hex,
  buildVariant,
  canonicalJson,
  deriveCandidateSeed,
  generateCandidates,
  generateCentreKeypair,
  generateCodebook,
  reasonHash,
  syntheticExtraction,
  validateMasterPaper,
} from "examseal-core";
import { keccak256, toBytes } from "viem";
import { describe, expect, it } from "vitest";
import { type CentreStatusName, Hotline, type HotlineOpts, type TxInfo } from "../src/hotline/hotline";
import { makeMatcher } from "../src/hotline/matcher";
import { type TelegramApi, type TgUpdate, scrubToken, telegramApi } from "../src/hotline/telegram";

const paper = validateMasterPaper(JSON.parse(readFileSync(fileURLToPath(new URL("../../../demo-data/master-paper.json", import.meta.url)), "utf8")));
if (!paper.ok) throw new Error("master paper invalid");
const master = paper.paper;
const ids = Array.from({ length: 20 }, (_, i) => i + 1);
const codebook = generateCodebook(master, ids, new Uint8Array(32).fill(5));
const seats = Array.from({ length: 30 }, (_, i) => i + 1);
const candidates: CandidateCode[] = codebook.flatMap((c) => generateCandidates(master, c, deriveCandidateSeed(generateCentreKeypair().privateKey), seats));
const seat7 = candidates.find((c) => c.centreId === 14 && c.seat === 7)!;

const OWNER = 1001;
const STRANGER = 2002;
const ALERT = "-3003";
const FAKE_TX = (n: number): TxInfo => ({ hash: `0x${n.toString(16).padStart(64, "0")}` as Hex, block: BigInt(5_000_000 + n), link: `https://example.test/tx/${n}` });

function setup(over: Partial<HotlineOpts> = {}, photoExtraction: Extraction = syntheticExtraction(master, seat7), chainFails = false) {
  const sent: { chatId: string; text: string }[] = [];
  const calls: { fn: string; args: unknown[] }[] = [];
  const logs: string[] = [];
  let status: CentreStatusName = "Released";
  let n = 0;
  const tg: TelegramApi = {
    getUpdates: async () => [],
    sendMessage: async (chatId, text) => void sent.push({ chatId: String(chatId), text }),
    downloadFile: async () => new Uint8Array([1, 2, 3]),
  };
  const reports: Record<string, string> = {};
  const bot = new Hotline(
    {
      tg,
      transcribePhoto: async () => ({ extraction: photoExtraction, provider: "Gemini", model: "gemini-test" }),
      match: makeMatcher(master, codebook, candidates, "4"),
      chain: {
        recordLeak: async (...args) => {
          calls.push({ fn: "recordLeak", args });
          if (chainFails) throw new Error("NotAuthority");
          return FAKE_TX(++n);
        },
        revokeCentre: async (...args) => {
          calls.push({ fn: "revokeCentre", args });
          status = "Compromised";
          return FAKE_TX(++n);
        },
        centreStatus: async () => status,
      },
      sha256: () => `0x${"11".repeat(32)}` as Hex,
      saveReport: (hash, report) => {
        reports[hash] = canonicalJson(report);
        return `evidence/${hash}.json`;
      },
      now: () => new Date("2026-09-29T05:30:00Z"),
      log: (l) => logs.push(l),
    },
    { examId: 4n, autoRevoke: false, allowedChats: new Set([String(OWNER)]), maxPhotoBytes: 15e6, ...over },
  );
  let uid = 0;
  const photo = (chat = OWNER): TgUpdate => ({
    update_id: ++uid,
    message: { message_id: uid, date: 0, chat: { id: chat, type: "private" }, photo: [{ file_id: "small", width: 90, height: 90 }, { file_id: "big", width: 1280, height: 960 }] },
  });
  const text = (t: string, chat = OWNER): TgUpdate => ({ update_id: ++uid, message: { message_id: uid, date: 0, chat: { id: chat, type: "private" }, text: t } });
  return { bot, sent, calls, logs, reports, photo, text, setStatus: (s: CentreStatusName) => (status = s) };
}

const pastedVariant = (code: Parameters<typeof buildVariant>[1], keep?: number[]) =>
  buildVariant(master, code)
    .questions.filter((q) => !keep || keep.includes(q.number))
    .map((q) => `${q.number}. ${q.text}\n${q.options.map((o) => `(${o.label}) ${o.text}`).join("\n")}`)
    .join("\n\n");

describe("leak hotline", () => {
  it("photo → instant 'Received. Tracing…', then Centre 14, Seat 7 with the score, evidence recorded, not revoked", async () => {
    const h = setup();
    await h.bot.handle(h.photo());
    expect(h.sent[0].text).toBe("Received. Tracing…");
    await h.bot.drain();
    const reply = h.sent[1].text;
    expect(reply).toMatch(/^Leak traced to Centre 14, Seat 7\./);
    expect(reply).toMatch(/Centre 14, Seat 7: 36 of 36 observed features match/);
    expect(reply).toMatch(/AI-assisted transcription \(Gemini gemini-test\)/);
    expect(reply).toMatch(/not to a person/);
    expect(reply).toMatch(/Evidence recorded on MST \(block 5000001\): https:\/\/example\.test\/tx\/1/);
    expect(reply).toMatch(/Not revoked: auto-revoke is off/);
    expect(reply).not.toMatch(/proof|proves|leak-proof/i);
    expect(h.calls.map((c) => c.fn)).toEqual(["recordLeak"]);
    const [centreId, hash, matched, observed] = h.calls[0].args as [number, Hex, number, number];
    expect([centreId, matched, observed]).toEqual([14, 36, 36]);
    // The saved report is exactly the bytes whose keccak256 was recorded.
    expect(keccak256(toBytes(h.reports[hash]))).toBe(hash);
  });

  it("--auto-revoke revokes with keccak256(reason) and posts the alert", async () => {
    const h = setup({ autoRevoke: true, alertChatId: ALERT });
    await h.bot.handle(h.photo());
    await h.bot.drain();
    expect(h.calls.map((c) => c.fn)).toEqual(["recordLeak", "revokeCentre"]);
    const evidence = h.calls[0].args[1] as Hex;
    expect(h.calls[1].args).toEqual([14, reasonHash(`Leak traced to Centre 14. Evidence ${evidence}`)]);
    expect(h.sent.find((m) => m.chatId === ALERT)?.text).toMatch(/^Centre 14 revoked, do not distribute\. Exam #4\. https:\/\/example\.test\/tx\/2$/);
    expect(h.sent.at(-1)!.text).toMatch(/Centre 14 revoked on MST \(block 5000002\)/);
  });

  it("an already revoked centre is not revoked again", async () => {
    const h = setup({ autoRevoke: true });
    h.setStatus("Compromised");
    await h.bot.handle(h.photo());
    await h.bot.drain();
    expect(h.calls.map((c) => c.fn)).toEqual(["recordLeak"]);
    expect(h.sent.at(-1)!.text).toMatch(/already revoked/);
  });

  it("refuses --auto-revoke without an allowlist", () => {
    expect(() => setup({ autoRevoke: true, allowedChats: null })).toThrow(/TELEGRAM_ALLOWED_CHAT_IDS/);
  });

  it("INCONCLUSIVE (two questions) → honest reply, nothing on-chain", async () => {
    const h = setup({}, syntheticExtraction(master, seat7, [1, 2]));
    await h.bot.handle(h.photo());
    await h.bot.drain();
    expect(h.sent.at(-1)!.text).toMatch(/^Could not attribute this leak to a centre\./);
    expect(h.sent.at(-1)!.text).toMatch(/Nothing was recorded on MST/);
    expect(h.calls).toEqual([]);
  });

  it("pasted text uses the no-AI parser and traces to the seat", async () => {
    const h = setup();
    await h.bot.handle(h.text(pastedVariant(seat7)));
    await h.bot.drain();
    const reply = h.sent.at(-1)!.text;
    expect(reply).toMatch(/^Leak traced to Centre 14, Seat 7\./);
    expect(reply).toMatch(/pasted text read by a fixed parser \(no AI\)/);
  });

  it("a printed (centre) copy traces to the centre only", async () => {
    const h = setup();
    await h.bot.handle(h.text(pastedVariant(codebook[13])));
    await h.bot.drain();
    expect(h.sent.at(-1)!.text).toMatch(/^Leak traced to Centre 14\./);
    expect(h.sent.at(-1)!.text).not.toMatch(/Seat \d+\./);
  });

  it("unrelated text → not this exam, nothing on-chain", async () => {
    const h = setup();
    await h.bot.handle(h.text("1. Who painted the Mona Lisa?\n(A) Da Vinci\n(B) Monet\n(C) Picasso\n(D) Dali"));
    await h.bot.drain();
    expect(h.sent.at(-1)!.text).toMatch(/does not look like exam #4's paper/);
    expect(h.calls).toEqual([]);
  });

  it("records evidence once per centre per run", async () => {
    const h = setup();
    await h.bot.handle(h.photo());
    await h.bot.handle(h.photo());
    await h.bot.drain();
    expect(h.calls.filter((c) => c.fn === "recordLeak")).toHaveLength(1);
    expect(h.sent.at(-1)!.text).toMatch(/already recorded on MST in this session \(block 5000001\)/);
  });

  it("a chain failure is reported and nothing is revoked", async () => {
    const h = setup({ autoRevoke: true }, undefined, true);
    await h.bot.handle(h.photo());
    await h.bot.drain();
    expect(h.calls.map((c) => c.fn)).toEqual(["recordLeak"]);
    expect(h.sent.at(-1)!.text).toMatch(/Recording the evidence on MST failed: NotAuthority\. Nothing was revoked\./);
  });

  it("chats outside the allowlist are refused; /id always answers", async () => {
    const h = setup();
    await h.bot.handle(h.photo(STRANGER));
    await h.bot.handle(h.text("/id", STRANGER));
    await h.bot.drain();
    expect(h.sent.map((m) => m.text)).toEqual(["This hotline only accepts reports from registered chats.", `This chat's id is ${STRANGER}.`]);
    expect(h.calls).toEqual([]);
  });
});

describe("Telegram client", () => {
  const TOKEN = "123456789:AAFakeTokenForTestsOnly_abcdefghij";

  it("never lets the token into error messages", async () => {
    const leaky = (async (url: string) => {
      throw new Error(`connect ECONNREFUSED while fetching ${url}`);
    }) as unknown as typeof fetch;
    const err = await telegramApi(TOKEN, leaky)
      .sendMessage(1, "hi")
      .then(
        () => new Error("expected sendMessage to fail"),
        (e: unknown) => e as Error,
      );
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).toContain("<token>");
    expect(scrubToken(`x ${TOKEN} y`, TOKEN)).toBe("x <token> y");
  });

  it("rejects something that is not a bot token", () => {
    expect(() => telegramApi("not-a-token")).toThrow(/does not look like a bot token/);
  });
});
