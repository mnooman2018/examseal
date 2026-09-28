import { type Decision, type EvidenceReport, type Extraction, type Hex, parsePastedText, reasonHash } from "examseal-core";
import type { TelegramApi, TgMessage, TgUpdate } from "./telegram";

// Leak hotline (D10): someone sends a photo or pasted text of a leaked paper to a Telegram bot running
// on the authority's laptop; the bot traces it with the same matcher as /trace and, on a MATCH, records
// the evidence on MST (and revokes only with --auto-revoke). Every dependency is injected so the whole
// flow is tested with fakes.

export type TxInfo = { hash: Hex; block: bigint; link: string };
export type MatchOutcome = {
  decision: Decision;
  seat?: number;
  report: EvidenceReport;
  hash: Hex;
  identified: number;
};
export type CentreStatusName = "None" | "Sealed" | "Released" | "Compromised";

export type HotlineDeps = {
  tg: TelegramApi;
  /** AI-assisted transcription of a photo (Gemini with fallback, same code as /api/extract). */
  transcribePhoto(bytes: Uint8Array, mediaType: string): Promise<{ extraction: Extraction; provider: string; model: string }>;
  /** Deterministic match against the exam's codebook (and seat file, if present). */
  match(extraction: Extraction, sha256: Hex, createdAt: string): MatchOutcome;
  chain: {
    recordLeak(centreId: number, evidenceHash: Hex, matched: number, observed: number): Promise<TxInfo>;
    revokeCentre(centreId: number, reasonHash: Hex): Promise<TxInfo>;
    centreStatus(centreId: number): Promise<CentreStatusName>;
  };
  sha256(bytes: Uint8Array): Hex;
  saveReport(hash: Hex, report: EvidenceReport): string;
  now(): Date;
  log(line: string): void;
};

export type HotlineOpts = {
  examId: bigint;
  autoRevoke: boolean;
  /** Chat ids allowed to use the bot; null = anyone (then --auto-revoke is refused). */
  allowedChats: Set<string> | null;
  alertChatId?: string;
  maxPhotoBytes: number;
};

type Job = { chatId: number; replyTo: number } & ({ kind: "photo"; fileId: string; mediaType: string; size?: number } | { kind: "text"; text: string });

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const pad = (n: number) => String(n).padStart(2, "0");

export const HELP = [
  "ExamSeal leak hotline.",
  "Send a photo or screenshot of a leaked exam paper, or paste its text, and I will trace it to the exam centre (and seat, for digital exams).",
  "Photos are transcribed with AI assistance; pasted text is read by a fixed parser with no AI. The match itself is deterministic.",
  "/id shows this chat's id.",
].join("\n");

export class Hotline {
  private queue: Promise<void> = Promise.resolve();
  /** One on-chain evidence record per centre per run (spam guard). */
  private recorded = new Map<number, TxInfo>();

  constructor(
    private readonly deps: HotlineDeps,
    private readonly opts: HotlineOpts,
  ) {
    if (opts.autoRevoke && !opts.allowedChats) {
      throw new Error("--auto-revoke needs TELEGRAM_ALLOWED_CHAT_IDS: otherwise anyone who finds the bot could revoke a centre.");
    }
  }

  /** Wait until every queued job has been processed (tests, shutdown). */
  drain(): Promise<void> {
    return this.queue;
  }

  /** Handle one update: commands and the "Received" ack right away; tracing is queued and runs one at a time. */
  async handle(u: TgUpdate): Promise<void> {
    const m = u.message;
    if (!m) return;
    const chatId = m.chat.id;
    const text = (m.text ?? "").trim();

    if (text === "/id" || text.startsWith("/id@")) {
      await this.deps.tg.sendMessage(chatId, `This chat's id is ${chatId}.`, m.message_id);
      return;
    }
    if (this.opts.allowedChats && !this.opts.allowedChats.has(String(chatId))) {
      this.deps.log(`refused chat ${chatId} (not in TELEGRAM_ALLOWED_CHAT_IDS)`);
      await this.deps.tg.sendMessage(chatId, "This hotline only accepts reports from registered chats.", m.message_id);
      return;
    }
    if (text.startsWith("/start") || text.startsWith("/help")) {
      await this.deps.tg.sendMessage(chatId, HELP, m.message_id);
      return;
    }

    const job = this.toJob(m);
    if (!job) {
      await this.deps.tg.sendMessage(chatId, "Send a photo or screenshot of the leaked paper, or paste its text.", m.message_id);
      return;
    }
    await this.deps.tg.sendMessage(chatId, "Received. Tracing…", m.message_id);
    this.deps.log(`chat ${chatId}: ${job.kind} received, queued`);
    this.queue = this.queue.then(() => this.process(job)).catch((e) => this.deps.log(`job failed: ${(e as Error).message}`));
  }

  private toJob(m: TgMessage): Job | null {
    const base = { chatId: m.chat.id, replyTo: m.message_id };
    if (m.photo?.length) {
      const biggest = [...m.photo].sort((a, b) => b.width * b.height - a.width * a.height)[0];
      return { ...base, kind: "photo", fileId: biggest.file_id, mediaType: "image/jpeg", size: biggest.file_size };
    }
    if (m.document && IMAGE_TYPES.has(m.document.mime_type ?? "")) {
      return { ...base, kind: "photo", fileId: m.document.file_id, mediaType: m.document.mime_type!, size: m.document.file_size };
    }
    if (m.text && !m.text.startsWith("/")) return { ...base, kind: "text", text: m.text };
    return null;
  }

  private reply(job: Job, text: string) {
    return this.deps.tg.sendMessage(job.chatId, text, job.replyTo);
  }

  private async process(job: Job): Promise<void> {
    const { deps, opts } = this;
    const createdAt = deps.now().toISOString();

    // 1. Read the leak.
    let extraction: Extraction;
    let sha: Hex;
    let how: string;
    try {
      if (job.kind === "photo") {
        if (job.size && job.size > opts.maxPhotoBytes) {
          await this.reply(job, `That image is ${(job.size / 1e6).toFixed(1)} MB; the limit is ${(opts.maxPhotoBytes / 1e6).toFixed(0)} MB. Send it as a photo instead.`);
          return;
        }
        const bytes = await deps.tg.downloadFile(job.fileId);
        if (bytes.length > opts.maxPhotoBytes) {
          await this.reply(job, `That image is too large (${(bytes.length / 1e6).toFixed(1)} MB). Send it as a photo instead.`);
          return;
        }
        sha = deps.sha256(bytes);
        const t = await deps.transcribePhoto(bytes, job.mediaType);
        extraction = t.extraction;
        how = `AI-assisted transcription (${t.provider} ${t.model}), then a deterministic match against the secret copies`;
      } else {
        extraction = parsePastedText(job.text);
        sha = deps.sha256(new TextEncoder().encode(job.text));
        how = "pasted text read by a fixed parser (no AI), then a deterministic match against the secret copies";
      }
    } catch (e) {
      deps.log(`chat ${job.chatId}: could not read the leak: ${(e as Error).message}`);
      await this.reply(job, `Could not read that ${job.kind === "photo" ? "photo" : "text"}: ${(e as Error).message}\nNothing was recorded on MST.`);
      return;
    }
    if (extraction.questions.length === 0) {
      await this.reply(job, "No exam questions found in that. Nothing was recorded on MST.");
      return;
    }

    // 2. Match (deterministic, on this laptop; the codebook never leaves it).
    const out = deps.match(extraction, sha, createdAt);
    const file = deps.saveReport(out.hash, out.report);
    const d = out.decision;
    deps.log(`chat ${job.chatId}: ${d.kind}${d.kind === "MATCH" ? ` centre ${d.centreId}${out.seat ? ` seat ${out.seat}` : ""}` : ""} · report ${file}`);

    if (d.kind === "NOT_THIS_EXAM") {
      await this.reply(job, `This does not look like exam #${opts.examId}'s paper: ${d.reason}\nNothing was recorded on MST.`);
      return;
    }
    if (d.kind === "INCONCLUSIVE") {
      await this.reply(
        job,
        [
          "Could not attribute this leak to a centre.",
          d.reason,
          `(${how}; ${out.identified} of ${extraction.questions.length} questions identified.)`,
          "Nothing was recorded on MST. A clearer photo showing more questions may be enough.",
        ].join("\n"),
      );
      return;
    }

    // 3. MATCH: record the evidence (once per centre per run), revoke only with --auto-revoke.
    const centreId = d.centreId!;
    const label = `Centre ${pad(centreId)}${out.seat !== undefined ? `, Seat ${out.seat}` : ""}`;
    const lines = [`Leak traced to ${label}.`, d.reason, `How: ${how}. This points to the centre${out.seat !== undefined ? " and the seat's copy" : ""}, not to a person.`];

    let record: TxInfo | undefined = this.recorded.get(centreId);
    try {
      if (record) {
        lines.push(`Evidence for Centre ${pad(centreId)} was already recorded on MST in this session (block ${record.block}): ${record.link}`);
      } else {
        record = await deps.chain.recordLeak(centreId, out.hash, d.best!.matched, d.best!.observed);
        this.recorded.set(centreId, record);
        lines.push(`Evidence recorded on MST (block ${record.block}): ${record.link}`);
      }
    } catch (e) {
      deps.log(`chat ${job.chatId}: recordLeak failed: ${(e as Error).message}`);
      lines.push(`Recording the evidence on MST failed: ${(e as Error).message}. Nothing was revoked.`);
      lines.push(`Evidence hash: ${out.hash}`);
      await this.reply(job, lines.join("\n"));
      return;
    }

    if (opts.autoRevoke) {
      try {
        const status = await deps.chain.centreStatus(centreId);
        if (status === "Compromised") {
          lines.push(`Centre ${pad(centreId)} was already revoked on MST.`);
        } else {
          const reason = `Leak traced to Centre ${pad(centreId)}. Evidence ${out.hash}`;
          const rev = await deps.chain.revokeCentre(centreId, reasonHash(reason));
          lines.push(`Centre ${pad(centreId)} revoked on MST (block ${rev.block}): ${rev.link}`);
          if (opts.alertChatId) {
            await deps.tg
              .sendMessage(opts.alertChatId, `Centre ${pad(centreId)} revoked, do not distribute. Exam #${opts.examId}. ${rev.link}`)
              .catch((e) => deps.log(`alert failed: ${(e as Error).message}`));
          }
        }
      } catch (e) {
        deps.log(`chat ${job.chatId}: revoke failed: ${(e as Error).message}`);
        lines.push(`Revoking Centre ${pad(centreId)} on MST failed: ${(e as Error).message}`);
      }
    } else {
      lines.push(`Not revoked: auto-revoke is off. The authority can revoke Centre ${pad(centreId)} on /trace.`);
    }
    lines.push(`Evidence hash: ${out.hash}`);
    await this.reply(job, lines.join("\n"));
  }
}
