import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
import { afterAll, describe, expect, it } from "vitest";
import { discoverExams } from "../src/hotline/exams";
import { ACK, type CentreStatusName, type ExamTarget, Hotline, type HotlineOpts, type TxInfo, VERDICT } from "../src/hotline/hotline";
import { makeMatcher } from "../src/hotline/matcher";
import { type TelegramApi, type TgUpdate, scrubToken, telegramApi } from "../src/hotline/telegram";

// Synthetic data only: the committed master paper plus codebooks generated here from fixed test seeds.
const paper = validateMasterPaper(JSON.parse(readFileSync(fileURLToPath(new URL("../../../demo-data/master-paper.json", import.meta.url)), "utf8")));
if (!paper.ok) throw new Error("master paper invalid");
const master = paper.paper;
const ids = Array.from({ length: 20 }, (_, i) => i + 1);
const bookA = generateCodebook(master, ids, new Uint8Array(32).fill(5)); // exam 4 (and exam 6 in the tie test)
const bookB = generateCodebook(master, ids, new Uint8Array(32).fill(9)); // exam 5
const bookFake = generateCodebook(master, ids, new Uint8Array(32).fill(13)); // in no exam: a fake paper
const seats = Array.from({ length: 30 }, (_, i) => i + 1);
const candidatesA: CandidateCode[] = bookA.flatMap((c) => generateCandidates(master, c, deriveCandidateSeed(generateCentreKeypair().privateKey), seats));
const seat7 = candidatesA.find((c) => c.centreId === 14 && c.seat === 7)!;

const OWNER = 1001;
const STRANGER = 2002;
const ALERT = "-3003";
const GROUP = -4004;
const RELEASE = 1_790_700_000; // chain time of exam 4's release
const FAKE_TX = (n: number): TxInfo => ({ hash: `0x${n.toString(16).padStart(64, "0")}` as Hex, block: BigInt(5_000_000 + n), link: `https://example.test/tx/${n}` });

const exam = (id: bigint, book = bookA, cands: CandidateCode[] | null = null, releaseTime = RELEASE): ExamTarget => ({
  id,
  title: `Demo exam ${id}`,
  releaseTime,
  match: makeMatcher(master, book, cands, id.toString()),
});

function setup(
  over: Partial<HotlineOpts> = {},
  photoExtraction: Extraction = syntheticExtraction(master, seat7),
  chain: { now?: number; fails?: boolean; timeFails?: boolean } = {},
) {
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
      chain: {
        now: async () => {
          if (chain.timeFails) throw new Error("RPC unreachable");
          return chain.now ?? RELEASE - 1800;
        },
        recordLeak: async (...args) => {
          calls.push({ fn: "recordLeak", args });
          if (chain.fails) throw new Error("NotAuthority");
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
      saveReport: (_examId, hash, report) => {
        reports[hash] = canonicalJson(report);
        return `evidence/${hash}.json`;
      },
      now: () => new Date("2026-09-29T05:30:00Z"),
      log: (l) => logs.push(l),
    },
    {
      exams: [exam(4n, bookA, candidatesA), exam(5n, bookB)],
      autoRevoke: false,
      allowedChats: new Set([String(OWNER)]),
      alertChatId: ALERT,
      maxPhotoBytes: 15e6,
      ...over,
    },
  );
  let uid = 0;
  const photo = (chat = OWNER, type = "private"): TgUpdate => ({
    update_id: ++uid,
    message: {
      message_id: uid,
      date: 0,
      chat: { id: chat, type, ...(type === "private" ? {} : { title: "Exam chatter" }) },
      from: { id: 77, username: "someone" },
      photo: [{ file_id: "small", width: 90, height: 90 }, { file_id: "big", width: 1280, height: 960 }],
    },
  });
  const text = (t: string, chat = OWNER, type = "private"): TgUpdate => ({ update_id: ++uid, message: { message_id: uid, date: 0, chat: { id: chat, type }, text: t } });
  const to = (chat: number | string) => sent.filter((m) => m.chatId === String(chat)).map((m) => m.text);
  return { bot, sent, calls, logs, reports, photo, text, to, setStatus: (s: CentreStatusName) => (status = s) };
}

const pastedVariant = (code: Parameters<typeof buildVariant>[1], keep?: number[]) =>
  buildVariant(master, code)
    .questions.filter((q) => !keep || keep.includes(q.number))
    .map((q) => `${q.number}. ${q.text}\n${q.options.map((o) => `(${o.label}) ${o.text}`).join("\n")}`)
    .join("\n\n");

describe("leak hotline v2: verdicts go to the alert chat only", () => {
  it("before release (chain time): sender gets only the ack; alert says CONFIRMED PRE-EXAM LEAK with the matcher's numbers", async () => {
    const h = setup();
    await h.bot.handle(h.photo());
    await h.bot.drain();
    expect(h.to(OWNER)).toEqual([ACK]);
    const alert = h.to(ALERT);
    expect(alert).toHaveLength(1);
    const a = alert[0];
    expect(a.split("\n")[0]).toBe(VERDICT.preExam);
    expect(a).toMatch(/Exam #4 "Demo exam 4": Centre 14, Seat 7\./);
    expect(a).toMatch(/Score: 36 of 36 observed features match; runner-up Centre \d\d with \d+\./);
    expect(a).toMatch(/Seat 7: 36 of 36 observed features match; runner-up Seat \d+ with \d+\./);
    expect(a).toMatch(/Chain time 2026-\S+ \S+ UTC; release time \S+ \S+ UTC \(30 min 0 s before release\)\./);
    expect(a).toMatch(/Report from: private chat 1001 from @someone\./);
    expect(a).toMatch(/Evidence recorded on MST \(block 5000001\): https:\/\/example\.test\/tx\/1/);
    expect(a).toMatch(/Not revoked: auto-revoke is off/);
    expect(a).toMatch(/not to a person/);
    expect(a).not.toMatch(/proof|proves|confidence|%/i);
    expect(h.calls.map((c) => c.fn)).toEqual(["recordLeak"]);
    const [examId, centreId, hash, matched, observed] = h.calls[0].args as [bigint, number, Hex, number, number];
    expect([examId, centreId, matched, observed]).toEqual([4n, 14, 36, 36]);
    expect(keccak256(toBytes(h.reports[hash]))).toBe(hash);
  });

  it("after release (chain time): 'Leak after exam start'", async () => {
    const h = setup({}, undefined, { now: RELEASE + 125 });
    await h.bot.handle(h.photo());
    await h.bot.drain();
    const a = h.to(ALERT)[0];
    expect(a.split("\n")[0]).toBe(VERDICT.afterStart);
    expect(a).toMatch(/\(2 min 5 s after release\)/);
    expect(h.to(OWNER)).toEqual([ACK]);
  });

  it("the verdict uses chain time, never the laptop clock", async () => {
    // Laptop clock (deps.now) says 2026-09-29, long after RELEASE; the chain says 30 min before.
    const h = setup({}, undefined, { now: RELEASE - 1800 });
    await h.bot.handle(h.photo());
    await h.bot.drain();
    expect(h.to(ALERT)[0].split("\n")[0]).toBe(VERDICT.preExam);
  });

  it("auto-detects the exam: a leak from exam 5's paper is attributed to exam 5", async () => {
    const h = setup({}, syntheticExtraction(master, bookB[2]));
    await h.bot.handle(h.photo());
    await h.bot.drain();
    expect(h.to(ALERT)[0]).toMatch(/Exam #5 "Demo exam 5": Centre 03\./);
    expect(h.calls[0].args.slice(0, 2)).toEqual([5n, 3]);
  });

  it("a paper from no exam: 'Not a match, possibly a fake paper', nothing on-chain, sender only gets the ack", async () => {
    const h = setup({}, syntheticExtraction(master, bookFake[0]));
    await h.bot.handle(h.photo());
    await h.bot.drain();
    const a = h.to(ALERT)[0];
    expect(a.split("\n")[0]).toBe(VERDICT.noMatch);
    expect(a).toMatch(/Exam #4 "Demo exam 4": not attributed\./);
    expect(a).toMatch(/Exam #5 "Demo exam 5": not attributed\./);
    expect(a).toMatch(/Nothing was recorded on MST\./);
    expect(h.calls).toEqual([]);
    expect(h.to(OWNER)).toEqual([ACK]);
  });

  it("unrelated text and too few questions are 'Not a match' too", async () => {
    const h = setup({}, syntheticExtraction(master, seat7, [1, 2]));
    await h.bot.handle(h.text("1. Who painted the Mona Lisa?\n(A) Da Vinci\n(B) Monet\n(C) Picasso\n(D) Dali"));
    await h.bot.handle(h.photo());
    await h.bot.drain();
    const alerts = h.to(ALERT);
    expect(alerts).toHaveLength(2);
    for (const a of alerts) expect(a.split("\n")[0]).toBe(VERDICT.noMatch);
    expect(alerts[0]).toMatch(/not this exam/);
    expect(alerts[1]).toMatch(/Not enough visible features/);
    expect(h.calls).toEqual([]);
  });

  it("exams that share a codebook: the newest exam is used and the others are named", async () => {
    const h = setup({ exams: [exam(4n), exam(6n)] });
    await h.bot.handle(h.text(pastedVariant(bookA[13])));
    await h.bot.drain();
    const a = h.to(ALERT)[0];
    expect(a).toMatch(/Exam #6 "Demo exam 6": Centre 14\./);
    expect(a).toMatch(/Also matches exam #4 with the same centre \(demo exams share one codebook\), so the newest exam was used\./);
    expect(h.calls[0].args.slice(0, 2)).toEqual([6n, 14]);
  });

  it("a seat-level match picks the exam whose seat file matches, even when another exam ties on the centre", async () => {
    const h = setup({ exams: [exam(4n, bookA, candidatesA), exam(6n, bookA)] });
    await h.bot.handle(h.text(pastedVariant(seat7)));
    await h.bot.drain();
    expect(h.to(ALERT)[0]).toMatch(/Exam #4 "Demo exam 4": Centre 14, Seat 7\./);
  });

  it("pasted text uses the no-AI parser", async () => {
    const h = setup();
    await h.bot.handle(h.text(pastedVariant(seat7)));
    await h.bot.drain();
    expect(h.to(ALERT)[0]).toMatch(/pasted text read by a fixed parser \(no AI\)/);
    expect(h.to(OWNER)).toEqual([ACK]);
  });
});

describe("leak hotline v2: group watch", () => {
  it("scans photos posted in a group silently and alerts the alert chat", async () => {
    const h = setup();
    await h.bot.handle(h.photo(GROUP, "supergroup"));
    await h.bot.handle(h.text("anyone have the paper?", GROUP, "supergroup"));
    await h.bot.handle(h.text("/id", GROUP, "group"));
    await h.bot.drain();
    expect(h.to(GROUP)).toEqual([]);
    const a = h.to(ALERT);
    expect(a).toHaveLength(1);
    expect(a[0].split("\n")[0]).toBe(VERDICT.preExam);
    expect(a[0]).toMatch(/Report from: group "Exam chatter" \(chat -4004\) from @someone, message 1\./);
    expect(h.logs.some((l) => l.includes("has chat id -4004"))).toBe(true);
  });

  it("an oversized group image is skipped with a note to the alert chat, never a reply in the group", async () => {
    const h = setup({ maxPhotoBytes: 100 });
    const u = h.photo(GROUP, "group");
    u.message!.photo![1].file_size = 5_000_000;
    await h.bot.handle(u);
    await h.bot.drain();
    expect(h.to(GROUP)).toEqual([]);
    expect(h.to(ALERT)[0]).toMatch(/^Group watch: skipped a 5\.0 MB image/);
  });
});

describe("leak hotline v2: on-chain actions", () => {
  it("--auto-revoke revokes for a report from an allowed chat", async () => {
    const h = setup({ autoRevoke: true });
    await h.bot.handle(h.photo(OWNER));
    await h.bot.drain();
    expect(h.calls.map((c) => c.fn)).toEqual(["recordLeak", "revokeCentre"]);
    const evidence = h.calls[0].args[2] as Hex;
    expect(h.calls[1].args).toEqual([4n, 14, reasonHash(`Leak traced to Centre 14. Evidence ${evidence}`)]);
    expect(h.to(ALERT)[0]).toMatch(/Centre 14 revoked on MST \(block 5000002\), do not distribute: https:\/\/example\.test\/tx\/2/);
  });

  it("--auto-revoke does not revoke for a report from a chat outside the allowlist (evidence is still recorded)", async () => {
    const h = setup({ autoRevoke: true });
    await h.bot.handle(h.photo(STRANGER));
    await h.bot.drain();
    expect(h.calls.map((c) => c.fn)).toEqual(["recordLeak"]);
    expect(h.to(ALERT)[0]).toMatch(/Not revoked: the report came from a chat that is not in TELEGRAM_ALLOWED_CHAT_IDS/);
    expect(h.to(STRANGER)).toEqual([ACK]);
  });

  it("a group photo never triggers a revoke unless the group is allowed", async () => {
    const h = setup({ autoRevoke: true });
    await h.bot.handle(h.photo(GROUP, "supergroup"));
    await h.bot.drain();
    expect(h.calls.map((c) => c.fn)).toEqual(["recordLeak"]);
  });

  it("an already revoked centre is not revoked again", async () => {
    const h = setup({ autoRevoke: true });
    h.setStatus("Compromised");
    await h.bot.handle(h.photo());
    await h.bot.drain();
    expect(h.calls.map((c) => c.fn)).toEqual(["recordLeak"]);
    expect(h.to(ALERT)[0]).toMatch(/already revoked/);
  });

  it("records evidence once per exam and centre per run", async () => {
    const h = setup();
    await h.bot.handle(h.photo());
    await h.bot.handle(h.photo());
    await h.bot.drain();
    expect(h.calls.filter((c) => c.fn === "recordLeak")).toHaveLength(1);
    expect(h.to(ALERT)[1]).toMatch(/already recorded on MST in this session \(block 5000001\)/);
  });

  it("a chain failure is reported to the alert chat and nothing is revoked", async () => {
    const h = setup({ autoRevoke: true }, undefined, { fails: true });
    await h.bot.handle(h.photo());
    await h.bot.drain();
    expect(h.calls.map((c) => c.fn)).toEqual(["recordLeak"]);
    expect(h.to(ALERT)[0]).toMatch(/Recording the evidence on MST failed: NotAuthority\. Nothing was revoked\./);
    expect(h.to(OWNER)).toEqual([ACK]);
  });

  it("if chain time cannot be read, the alert says so instead of guessing", async () => {
    const h = setup({}, undefined, { timeFails: true });
    await h.bot.handle(h.photo());
    await h.bot.drain();
    const a = h.to(ALERT)[0];
    expect(a.split("\n")[0]).toBe("Match (chain time unavailable, so before or after release is not known)");
    expect(a).not.toMatch(new RegExp(`${VERDICT.preExam}|${VERDICT.afterStart}`));
  });
});

describe("leak hotline v2: startup rules and wording", () => {
  it("refuses to start without an alert chat", () => {
    expect(() => setup({ alertChatId: "" })).toThrow(/TELEGRAM_ALERT_CHAT_ID is not set/);
  });

  it("refuses --auto-revoke without an allowlist", () => {
    expect(() => setup({ autoRevoke: true, allowedChats: null })).toThrow(/TELEGRAM_ALLOWED_CHAT_IDS/);
  });

  it("/id and /help still answer in private chats; help does not promise a result", async () => {
    const h = setup();
    await h.bot.handle(h.text("/id", STRANGER));
    await h.bot.handle(h.text("/help", STRANGER));
    expect(h.to(STRANGER)[0]).toBe(`This chat's id is ${STRANGER}.`);
    expect(h.to(STRANGER)[1]).toMatch(/The result of the check is not sent back to you\./);
  });

  it("no message ever contains an em dash", async () => {
    const h = setup({ autoRevoke: true }, undefined, { now: RELEASE + 10 });
    await h.bot.handle(h.photo());
    await h.bot.handle(h.text("/help"));
    await h.bot.handle(h.text(pastedVariant(bookFake[1])));
    await h.bot.handle(h.photo(GROUP, "group"));
    await h.bot.drain();
    expect(h.sent.length).toBeGreaterThan(4);
    for (const m of h.sent) expect(m.text).not.toContain("—");
  });
});

describe("discoverExams (fixture files in a temp dir)", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "examseal-hotline-"));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  const put = (rel: string, body: string) => {
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), body);
  };
  put("exam-4/codebook.secret.json", JSON.stringify({ version: 1, centres: bookA }));
  put("exam-4/candidates.secret.json", JSON.stringify({ examId: "4", candidates: candidatesA.slice(0, 3) }));
  put("exam-12/codebook.secret.json", JSON.stringify({ version: 1, centres: bookB }));
  put("exam-5/codebook.secret.json", '{"centres": [ SECRET-LOOKING-CONTENT');
  put("exam-6/candidates.secret.json", "{}");
  put("exam-7/codebook.secret.json", JSON.stringify({ centres: bookA }));
  put("exam-7/candidates.secret.json", JSON.stringify({ examId: "8", candidates: [] }));
  put("not-an-exam/codebook.secret.json", "{}");

  it("finds every exam with a codebook, sorted by id, and explains the ones it skips", () => {
    const { exams, skipped } = discoverExams(root);
    expect(exams.map((e) => e.id)).toEqual([4n, 12n]);
    expect(exams[0].candidates).toHaveLength(3);
    expect(exams[1].candidates).toBeNull();
    expect(skipped.sort()).toEqual([
      "exam 5: could not read its files (not valid JSON)",
      "exam 6: no codebook.secret.json",
      "exam 7: candidates.secret.json is for exam 8",
    ]);
    expect(skipped.join(" ")).not.toContain("SECRET-LOOKING-CONTENT");
  });

  it("--exam keeps only that exam", () => {
    expect(discoverExams(root, 12n).exams.map((e) => e.id)).toEqual([12n]);
    expect(discoverExams(root, 99n).exams).toEqual([]);
  });

  it("a missing secrets folder gives no exams, not a crash", () => {
    expect(discoverExams(path.join(root, "nope")).exams).toEqual([]);
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
