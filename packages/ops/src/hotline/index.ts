import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  type CandidateCode,
  type CentreCode,
  type Hex,
  type ProviderPlan,
  canonicalJson,
  extractWithFallback,
  geminiPlan,
  groqPlan,
  toHexBytes,
  validateMasterPaper,
} from "examseal-core";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { confirm, connect, registryAbi, wallet } from "../chain";
import { ROOT, UserError, loadEnv, readJson, rel, resolvePaperPath } from "../env";
import { type CentreStatusName, Hotline, type TxInfo } from "./hotline";
import { makeMatcher } from "./matcher";
import { scrubToken, telegramApi } from "./telegram";

const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // Gemini inline limit is 20 MB
const STATUS: CentreStatusName[] = ["None", "Sealed", "Released", "Compromised"];

/**
 * pnpm ops hotline --exam <id> [--auto-revoke]
 * Telegram leak hotline on this laptop (long polling). Env: TELEGRAM_BOT_TOKEN, AUTHORITY_PRIVATE_KEY,
 * GEMINI_API_KEY (GROQ_API_KEY optional), TELEGRAM_ALLOWED_CHAT_IDS (required for --auto-revoke),
 * TELEGRAM_ALERT_CHAT_ID (optional). Nothing secret is printed.
 */
export async function hotline(opts: { exam?: string; autoRevoke?: boolean }): Promise<number> {
  if (!opts.exam || !/^\d+$/.test(opts.exam)) throw new UserError("--exam <id> is required, e.g. --exam 4");
  const examId = BigInt(opts.exam);
  loadEnv();
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new UserError("TELEGRAM_BOT_TOKEN is not set in .env.local");
  const pkRaw = process.env.AUTHORITY_PRIVATE_KEY?.trim();
  if (!pkRaw) throw new UserError("AUTHORITY_PRIVATE_KEY is not set in .env.local");
  const pk = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new UserError("AUTHORITY_PRIVATE_KEY must be 32 bytes of hex");
  const account = privateKeyToAccount(pk);
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const groqKey = process.env.GROQ_API_KEY?.trim();
  const allowed = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const alertChatId = process.env.TELEGRAM_ALERT_CHAT_ID?.trim() || undefined;

  // Exam files: they never leave this laptop.
  const dir = path.join(ROOT, "demo-data", "secrets", `exam-${opts.exam}`);
  const bookFile = path.join(dir, "codebook.secret.json");
  if (!existsSync(bookFile)) throw new UserError(`No codebook for exam ${opts.exam} at ${rel(bookFile)}`);
  const check = validateMasterPaper(readJson(resolvePaperPath(undefined)));
  if (!check.ok) throw new UserError("The master paper does not pass validate-paper");
  const master = check.paper;
  const codebook = (readJson(bookFile) as { centres?: CentreCode[] }).centres;
  if (!Array.isArray(codebook) || codebook.length === 0) throw new UserError(`${rel(bookFile)} has no centres`);
  let candidates: CandidateCode[] | null = null;
  const candFile = path.join(dir, "candidates.secret.json");
  if (existsSync(candFile)) {
    const c = readJson(candFile) as { examId?: string; candidates?: CandidateCode[] };
    if (String(c.examId) !== opts.exam) throw new UserError(`${rel(candFile)} is for exam ${c.examId}, not ${opts.exam}`);
    candidates = c.candidates ?? null;
  }

  // Chain: this key must be the exam's authority, or recordLeak would revert.
  const conn = await connect();
  const pc = conn.publicClient;
  const exam = (await pc.readContract({ address: conn.registry, abi: registryAbi, functionName: "getExam", args: [examId] })) as { authority: Address; title: string };
  if (exam.authority.toLowerCase() !== account.address.toLowerCase()) {
    throw new UserError(`AUTHORITY_PRIVATE_KEY is for ${account.address}, but exam ${opts.exam}'s authority is ${exam.authority}`);
  }
  if ((await pc.getBalance({ address: account.address })) === 0n) throw new UserError(`${account.address} has no funds for recordLeak`);
  const wc = wallet(conn, account);

  const tx = async (functionName: "recordLeak" | "revokeCentre", args: readonly unknown[]): Promise<TxInfo> => {
    const hash = await wc.writeContract({ address: conn.registry, abi: registryAbi, functionName, args: args as never });
    const r = await confirm(conn, hash, functionName);
    return { hash, block: r.blockNumber, link: conn.explorerTx(hash) };
  };

  const log = (line: string) => console.log(`[${new Date().toTimeString().slice(0, 8)}] ${scrubToken(line, token)}`);
  const tg = telegramApi(token);

  const bot = new Hotline(
    {
      tg,
      async transcribePhoto(bytes, mediaType) {
        const image = { imageBase64: Buffer.from(bytes).toString("base64"), mediaType };
        const providers: ProviderPlan[] = [];
        if (geminiKey) providers.push(geminiPlan({ apiKey: geminiKey, model: process.env.GEMINI_MODEL, ...image }));
        if (groqKey) providers.push(groqPlan({ apiKey: groqKey, model: process.env.GROQ_MODEL, ...image }));
        if (providers.length === 0) throw new Error("no transcription key (GEMINI_API_KEY) is set on the hotline laptop");
        const r = await extractWithFallback({ providers, budgetMs: 90_000, onAttempt: (a) => !a.ok && log(`  ${a.provider} ${a.model} attempt ${a.attempt}: ${a.kind}`) });
        return { extraction: r.extraction, provider: r.provider === "gemini" ? "Gemini" : "Groq", model: r.model };
      },
      match: makeMatcher(master, codebook, candidates, opts.exam),
      chain: {
        recordLeak: (centreId, hash, matched, observed) => tx("recordLeak", [examId, centreId, hash, matched, observed]),
        revokeCentre: (centreId, reason) => tx("revokeCentre", [examId, centreId, reason]),
        async centreStatus(centreId) {
          const c = (await pc.readContract({ address: conn.registry, abi: registryAbi, functionName: "getCentre", args: [examId, centreId] })) as { status: number };
          return STATUS[c.status] ?? "None";
        },
      },
      sha256: (bytes) => toHexBytes(new Uint8Array(createHash("sha256").update(bytes).digest())),
      saveReport(hash, report) {
        // The exact bytes whose keccak256 is the evidence hash, so the on-chain record can always be checked.
        const evDir = path.join(dir, "evidence");
        mkdirSync(evDir, { recursive: true });
        const file = path.join(evDir, `${hash}.json`);
        writeFileSync(file, canonicalJson(report));
        return rel(file);
      },
      now: () => new Date(),
      log,
    },
    {
      examId,
      autoRevoke: !!opts.autoRevoke,
      allowedChats: allowed.length ? new Set(allowed) : null,
      alertChatId,
      maxPhotoBytes: MAX_PHOTO_BYTES,
    },
  );

  console.log(`ExamSeal leak hotline · exam #${examId} "${exam.title}" · registry ${conn.registry}`);
  console.log(`  authority ${account.address} · ${codebook.length} centres · seat file: ${candidates ? `${candidates.length} seats` : "none (centre-level only)"}`);
  console.log(`  auto-revoke: ${opts.autoRevoke ? "ON" : "off"} · allowed chats: ${allowed.length || "anyone"} · alert chat: ${alertChatId ? "set" : "none"}`);
  console.log(`  photo transcription: ${geminiKey ? "Gemini" : "none"}${groqKey ? " + Groq" : ""}`);
  if (!allowed.length) console.log("  WARNING: anyone who finds this bot can make it record evidence on MST. Set TELEGRAM_ALLOWED_CHAT_IDS to limit it.");

  // Skip anything sent while the hotline was offline, then long-poll.
  let offset = 0;
  const backlog = await tg.getUpdates(0, 0);
  if (backlog.length) {
    offset = backlog[backlog.length - 1].update_id + 1;
    log(`skipped ${backlog.length} message(s) sent while the hotline was offline`);
  }
  log("listening (Ctrl+C to stop)");
  for (;;) {
    try {
      const updates = await tg.getUpdates(offset, 30);
      for (const u of updates) {
        offset = u.update_id + 1;
        await bot.handle(u).catch((e) => log(`update ${u.update_id}: ${(e as Error).message}`));
      }
    } catch (e) {
      log(`polling error: ${(e as Error).message}; retrying in 3 s`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
