import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type Hex, type ProviderPlan, canonicalJson, extractWithFallback, geminiPlan, groqPlan, toHexBytes, validateMasterPaper } from "examseal-core";
import type { Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainTime, confirm, connect, registryAbi, wallet } from "../chain";
import { ROOT, UserError, loadEnv, readJson, rel, resolvePaperPath } from "../env";
import { discoverExams } from "./exams";
import { type CentreStatusName, type ExamTarget, Hotline, type TxInfo } from "./hotline";
import { makeMatcher } from "./matcher";
import { scrubToken, telegramApi } from "./telegram";

const MAX_PHOTO_BYTES = 15 * 1024 * 1024; // Gemini inline limit is 20 MB
const STATUS: CentreStatusName[] = ["None", "Sealed", "Released", "Compromised"];

/**
 * pnpm ops hotline [--exam <id>] [--auto-revoke] [--secrets-root <dir>]
 * Telegram leak hotline on this laptop (long polling). Checks every leak against every exam that has
 * secret files under demo-data/secrets (or only --exam <id>). Env: TELEGRAM_BOT_TOKEN,
 * TELEGRAM_ALERT_CHAT_ID (required), AUTHORITY_PRIVATE_KEY, GEMINI_API_KEY (GROQ_API_KEY optional),
 * TELEGRAM_ALLOWED_CHAT_IDS (required for --auto-revoke). Nothing secret is printed.
 */
export async function hotline(opts: { exam?: string; autoRevoke?: boolean; secretsRoot?: string }): Promise<number> {
  if (opts.exam !== undefined && !/^\d+$/.test(opts.exam)) throw new UserError("--exam must be an exam number, e.g. --exam 4");
  const only = opts.exam !== undefined ? BigInt(opts.exam) : undefined;
  loadEnv();
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) throw new UserError("TELEGRAM_BOT_TOKEN is not set in .env.local");
  const alertChatId = process.env.TELEGRAM_ALERT_CHAT_ID?.trim();
  if (!alertChatId) {
    throw new UserError(
      "TELEGRAM_ALERT_CHAT_ID is not set in .env.local. Verdicts go only to the alert chat (senders just get 'Report received'), so the hotline will not start without it. Send /id to the bot from the alert chat to get its id.",
    );
  }
  const pkRaw = process.env.AUTHORITY_PRIVATE_KEY?.trim();
  if (!pkRaw) throw new UserError("AUTHORITY_PRIVATE_KEY is not set in .env.local");
  const pk = (pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`) as Hex;
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) throw new UserError("AUTHORITY_PRIVATE_KEY must be 32 bytes of hex");
  const account = privateKeyToAccount(pk);
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const groqKey = process.env.GROQ_API_KEY?.trim();
  const allowed = (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean);

  const check = validateMasterPaper(readJson(resolvePaperPath(undefined)));
  if (!check.ok) throw new UserError("The master paper does not pass validate-paper");
  const master = check.paper;

  // Every exam with secret files on this laptop (the files never leave it).
  const secretsDir = opts.secretsRoot ? path.resolve(opts.secretsRoot) : path.join(ROOT, "demo-data", "secrets");
  const found = discoverExams(secretsDir, only);
  for (const s of found.skipped) console.log(`  skipped ${s}`);
  if (found.exams.length === 0) {
    throw new UserError(only !== undefined ? `No usable secret files for exam ${only} under ${rel(secretsDir)}` : `No exams with a codebook under ${rel(secretsDir)}. Run pnpm ops seed first.`);
  }

  // Chain: keep only exams on this registry whose authority is this key, or recordLeak would revert.
  const conn = await connect();
  const pc = conn.publicClient;
  const exams: (ExamTarget & { dir: string; centres: number; seats: number })[] = [];
  for (const f of found.exams) {
    let e: { authority: Address; title: string; releaseTime: bigint };
    try {
      e = (await pc.readContract({ address: conn.registry, abi: registryAbi, functionName: "getExam", args: [f.id] })) as typeof e;
    } catch {
      console.log(`  skipped exam ${f.id}: not found on registry ${conn.registry}`);
      continue;
    }
    if (e.authority.toLowerCase() !== account.address.toLowerCase()) {
      console.log(`  skipped exam ${f.id}: its authority is ${e.authority}, not this key (${account.address})`);
      continue;
    }
    exams.push({
      id: f.id,
      title: e.title,
      releaseTime: Number(e.releaseTime),
      match: makeMatcher(master, f.codebook, f.candidates, f.id.toString()),
      dir: f.dir,
      centres: f.codebook.length,
      seats: f.candidates?.length ?? 0,
    });
  }
  if (exams.length === 0) throw new UserError("None of the exams with secret files can be used with this key on this registry (see the skipped lines above).");
  if ((await pc.getBalance({ address: account.address })) === 0n) throw new UserError(`${account.address} has no funds for recordLeak`);
  const wc = wallet(conn, account);
  const dirOf = new Map(exams.map((e) => [e.id, e.dir]));

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
      chain: {
        now: async () => Number(await chainTime(conn)),
        recordLeak: (examId, centreId, hash, matched, observed) => tx("recordLeak", [examId, centreId, hash, matched, observed]),
        revokeCentre: (examId, centreId, reason) => tx("revokeCentre", [examId, centreId, reason]),
        async centreStatus(examId, centreId) {
          const c = (await pc.readContract({ address: conn.registry, abi: registryAbi, functionName: "getCentre", args: [examId, centreId] })) as { status: number };
          return STATUS[c.status] ?? "None";
        },
      },
      sha256: (bytes) => toHexBytes(new Uint8Array(createHash("sha256").update(bytes).digest())),
      saveReport(examId, hash, report) {
        // The exact bytes whose keccak256 is the evidence hash, so the on-chain record can always be checked.
        const evDir = path.join(dirOf.get(examId)!, "evidence");
        mkdirSync(evDir, { recursive: true });
        const file = path.join(evDir, `${hash}.json`);
        writeFileSync(file, canonicalJson(report));
        return rel(file);
      },
      now: () => new Date(),
      log,
    },
    {
      exams,
      autoRevoke: !!opts.autoRevoke,
      allowedChats: allowed.length ? new Set(allowed) : null,
      alertChatId,
      maxPhotoBytes: MAX_PHOTO_BYTES,
    },
  );

  const nowTs = Number(await chainTime(conn));
  console.log(`ExamSeal leak hotline v2 · registry ${conn.registry} · authority ${account.address}`);
  for (const e of exams) {
    const when = e.releaseTime > nowTs ? `release in ${Math.round((e.releaseTime - nowTs) / 60)} min` : "release open";
    console.log(`  exam #${e.id} "${e.title}" · ${e.centres} centres · ${e.seats ? `${e.seats} seats` : "no seat file"} · ${when} (chain time)`);
  }
  console.log(`  alert chat: set · auto-revoke: ${opts.autoRevoke ? "ON (allowed chats only)" : "off"} · allowed chats: ${allowed.length || "none"}`);
  console.log(`  photo transcription: ${geminiKey ? "Gemini" : "none"}${groqKey ? " + Groq" : ""}`);
  console.log("  Senders only get 'Report received'. Groups are watched silently (the bot needs privacy mode off in @BotFather to see all photos).");

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
