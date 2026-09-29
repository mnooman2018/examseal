import { type Decision, type EvidenceReport, type Extraction, type Hex, parsePastedText, reasonHash } from "examseal-core";
import type { TelegramApi, TgMessage, TgUpdate } from "./telegram";

// Leak hotline v2 (D10, D14). Someone sends a photo or pasted text of a leaked paper to a Telegram bot
// running on the authority's laptop, or posts a photo in a group the bot watches. The bot traces it
// against every exam it has secret files for, with the same matcher as /trace, and judges it against
// CHAIN time. The sender only ever gets "Report received, thank you" (a leaker must not be able to use
// the bot to validate a paper); the verdict goes to the alert chat. On a MATCH it records the evidence
// on MST, and revokes only with --auto-revoke for a report from an allowed chat. Every dependency is
// injected so the whole flow is tested with fakes.

export type TxInfo = { hash: Hex; block: bigint; link: string };
export type SeatScore = { seat: number; matched: number; observed: number; runnerUpSeat?: number; runnerUpMatched?: number };
export type MatchOutcome = {
  decision: Decision;
  seat?: SeatScore;
  report: EvidenceReport;
  hash: Hex;
  identified: number;
};
export type CentreStatusName = "None" | "Sealed" | "Released" | "Compromised";

/** One exam the hotline can attribute leaks to: its secret files are on this laptop. */
export type ExamTarget = {
  id: bigint;
  title: string;
  /** Chain time (unix seconds) from getExam. */
  releaseTime: number;
  /** Deterministic match against this exam's codebook (and seat file, if present). */
  match(extraction: Extraction, sha256: Hex, createdAt: string): MatchOutcome;
};

export type HotlineDeps = {
  tg: TelegramApi;
  /** AI-assisted transcription of a photo (Gemini with fallback, same code as /api/extract). */
  transcribePhoto(bytes: Uint8Array, mediaType: string): Promise<{ extraction: Extraction; provider: string; model: string }>;
  chain: {
    /** Latest block timestamp (unix seconds). Never the laptop clock. */
    now(): Promise<number>;
    recordLeak(examId: bigint, centreId: number, evidenceHash: Hex, matched: number, observed: number): Promise<TxInfo>;
    revokeCentre(examId: bigint, centreId: number, reasonHash: Hex): Promise<TxInfo>;
    centreStatus(examId: bigint, centreId: number): Promise<CentreStatusName>;
  };
  sha256(bytes: Uint8Array): Hex;
  saveReport(examId: bigint, hash: Hex, report: EvidenceReport): string;
  /** Only for the report's createdAt field; verdicts use chain.now(). */
  now(): Date;
  log(line: string): void;
};

export type HotlineOpts = {
  exams: ExamTarget[];
  autoRevoke: boolean;
  /** Chats whose reports may trigger --auto-revoke; null = none. Anyone may send a report. */
  allowedChats: Set<string> | null;
  /** Where verdicts go. Required: the sender never sees one. */
  alertChatId: string;
  maxPhotoBytes: number;
};

export const VERDICT = {
  preExam: "CONFIRMED PRE-EXAM LEAK",
  afterStart: "Leak after exam start",
  noMatch: "Not a match, possibly a fake paper",
} as const;

export const ACK = "Report received, thank you.";

export const HELP = [
  "ExamSeal leak hotline.",
  "Send a photo or screenshot of a leaked exam paper, or paste its text. Your report goes to the exam authority.",
  "You will get a confirmation that it was received. The result of the check is not sent back to you.",
  "/id shows this chat's id.",
].join("\n");

type Source = { chatId: number; chatType: string; chatTitle?: string; from?: string; messageId: number };
type Job = Source & ({ kind: "photo"; fileId: string; mediaType: string; size?: number } | { kind: "text"; text: string });

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const pad = (n: number) => String(n).padStart(2, "0");
const isGroup = (type: string) => type === "group" || type === "supergroup";
const utc = (ts: number) => `${new Date(ts * 1000).toISOString().slice(0, 19).replace("T", " ")} UTC`;

function span(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${s % 60} s`;
  return `${s} s`;
}

function describeSource(j: Source): string {
  const who = j.from ? ` from ${j.from}` : "";
  if (isGroup(j.chatType)) return `group${j.chatTitle ? ` "${j.chatTitle}"` : ""} (chat ${j.chatId})${who}, message ${j.messageId}`;
  return `private chat ${j.chatId}${who}`;
}

type Scored = { exam: ExamTarget; out: MatchOutcome };

/** Best attribution first: a seat-level match, then more matched features, then the newest exam. */
function rank(a: Scored, b: Scored): number {
  const seat = Number(b.out.seat !== undefined) - Number(a.out.seat !== undefined);
  if (seat) return seat;
  const score = (b.out.decision.best?.matched ?? 0) - (a.out.decision.best?.matched ?? 0);
  if (score) return score;
  return a.exam.id < b.exam.id ? 1 : a.exam.id > b.exam.id ? -1 : 0;
}

export class Hotline {
  private queue: Promise<void> = Promise.resolve();
  /** One on-chain evidence record per exam and centre per run (spam guard). */
  private recorded = new Map<string, TxInfo>();

  constructor(
    private readonly deps: HotlineDeps,
    private readonly opts: HotlineOpts,
  ) {
    if (!opts.alertChatId) {
      throw new Error("TELEGRAM_ALERT_CHAT_ID is not set. Verdicts only go to the alert chat, so the hotline will not start without it.");
    }
    if (opts.exams.length === 0) throw new Error("No exams to check leaks against.");
    if (opts.autoRevoke && !opts.allowedChats) {
      throw new Error("--auto-revoke needs TELEGRAM_ALLOWED_CHAT_IDS: otherwise anyone who finds the bot could revoke a centre.");
    }
  }

  /** Wait until every queued job has been processed (tests, shutdown). */
  drain(): Promise<void> {
    return this.queue;
  }

  /** Handle one update. Private chats get only an acknowledgement; groups are watched silently. */
  async handle(u: TgUpdate): Promise<void> {
    const m = u.message;
    if (!m) return;
    const chatId = m.chat.id;
    const group = isGroup(m.chat.type);
    const text = (m.text ?? "").trim();

    if (group) {
      // Silent in groups: never reply there. Scan photos and image files only.
      if (text === "/id" || text.startsWith("/id@")) {
        this.deps.log(`group "${m.chat.title ?? ""}" has chat id ${chatId}`);
        return;
      }
      const job = this.toJob(m);
      if (!job || job.kind !== "photo") return;
      if (job.size && job.size > this.opts.maxPhotoBytes) {
        await this.alert(`Group watch: skipped a ${(job.size / 1e6).toFixed(1)} MB image in ${describeSource(job)} (limit ${(this.opts.maxPhotoBytes / 1e6).toFixed(0)} MB).`);
        return;
      }
      this.deps.log(`group ${chatId}: photo seen, queued`);
      this.enqueue(job);
      return;
    }

    if (text === "/id" || text.startsWith("/id@")) {
      await this.deps.tg.sendMessage(chatId, `This chat's id is ${chatId}.`, m.message_id);
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
    if (job.kind === "photo" && job.size && job.size > this.opts.maxPhotoBytes) {
      await this.deps.tg.sendMessage(
        chatId,
        `That image is ${(job.size / 1e6).toFixed(1)} MB; the limit is ${(this.opts.maxPhotoBytes / 1e6).toFixed(0)} MB. Send it as a photo instead.`,
        m.message_id,
      );
      return;
    }
    await this.deps.tg.sendMessage(chatId, ACK, m.message_id);
    this.deps.log(`chat ${chatId}: ${job.kind} received, queued`);
    this.enqueue(job);
  }

  private enqueue(job: Job) {
    this.queue = this.queue.then(() => this.process(job)).catch((e) => this.deps.log(`job failed: ${(e as Error).message}`));
  }

  private toJob(m: TgMessage): Job | null {
    const base: Source = {
      chatId: m.chat.id,
      chatType: m.chat.type,
      chatTitle: m.chat.title,
      from: m.from ? (m.from.username ? `@${m.from.username}` : `user ${m.from.id}`) : undefined,
      messageId: m.message_id,
    };
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

  private alert(text: string): Promise<void> {
    return this.deps.tg.sendMessage(this.opts.alertChatId, text).catch((e) => this.deps.log(`alert failed: ${(e as Error).message}`));
  }

  private async process(job: Job): Promise<void> {
    const { deps, opts } = this;
    const createdAt = deps.now().toISOString();
    const source = `Report from: ${describeSource(job)}.`;

    // 1. Read the leak.
    let extraction: Extraction;
    let sha: Hex;
    let how: string;
    try {
      if (job.kind === "photo") {
        const bytes = await deps.tg.downloadFile(job.fileId);
        if (bytes.length > opts.maxPhotoBytes) throw new Error(`the image is too large (${(bytes.length / 1e6).toFixed(1)} MB)`);
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
      await this.alert([`Could not read a ${job.kind === "photo" ? "photo" : "text"} report: ${(e as Error).message}`, source, "Nothing was recorded on MST."].join("\n"));
      return;
    }
    if (extraction.questions.length === 0) {
      await this.alert([VERDICT.noMatch, "No exam questions were found in the report.", source, "Nothing was recorded on MST."].join("\n"));
      return;
    }

    // 2. Match against every exam (deterministic, on this laptop; the codebooks never leave it).
    const results: Scored[] = opts.exams.map((exam) => ({ exam, out: exam.match(extraction, sha, createdAt) }));
    const matches = results.filter((r) => r.out.decision.kind === "MATCH").sort(rank);

    if (matches.length === 0) {
      const lines = [VERDICT.noMatch, source, `How: ${how}.`];
      for (const r of [...results].sort(rank)) {
        const d = r.out.decision;
        lines.push(`Exam #${r.exam.id} "${r.exam.title}": ${d.kind === "NOT_THIS_EXAM" ? "not this exam" : "not attributed"}. ${d.reason} (${r.out.identified} of ${extraction.questions.length} questions identified.)`);
      }
      lines.push("Nothing was recorded on MST.");
      deps.log(`chat ${job.chatId}: no match in ${results.length} exam(s)`);
      await this.alert(lines.join("\n"));
      return;
    }

    // 3. MATCH: verdict against chain time, then record the evidence (once per exam and centre per run).
    const { exam, out } = matches[0];
    const d = out.decision;
    const centreId = d.centreId!;
    const best = d.best!;
    const label = `Centre ${pad(centreId)}${out.seat ? `, Seat ${out.seat.seat}` : ""}`;
    const file = deps.saveReport(exam.id, out.hash, out.report);
    deps.log(`chat ${job.chatId}: MATCH exam ${exam.id} ${label} · report ${file}`);

    let verdict: string;
    let timing: string;
    try {
      const now = await deps.chain.now();
      const delta = exam.releaseTime - now;
      verdict = delta > 0 ? VERDICT.preExam : VERDICT.afterStart;
      timing = `Chain time ${utc(now)}; release time ${utc(exam.releaseTime)} (${delta > 0 ? `${span(delta)} before release` : `${span(delta)} after release`}).`;
    } catch (e) {
      verdict = "Match (chain time unavailable, so before or after release is not known)";
      timing = `Could not read chain time: ${(e as Error).message}`;
    }

    const lines = [
      verdict,
      `Exam #${exam.id} "${exam.title}": ${label}.`,
      `Score: ${best.matched} of ${best.observed} observed features match${d.runnerUp ? `; runner-up Centre ${pad(d.runnerUp.centreId)} with ${d.runnerUp.matched}` : ""}.`,
    ];
    if (out.seat) {
      lines.push(
        `Seat ${out.seat.seat}: ${out.seat.matched} of ${out.seat.observed} observed features match${
          out.seat.runnerUpSeat !== undefined ? `; runner-up Seat ${out.seat.runnerUpSeat} with ${out.seat.runnerUpMatched}` : ""
        }.`,
      );
    }
    lines.push(timing, source, `How: ${how}. This points to the centre${out.seat ? " and the seat's copy" : ""}, not to a person.`);
    const others = matches.slice(1).filter((m) => m.out.decision.centreId === centreId);
    if (others.length) {
      lines.push(
        `Also matches ${others.map((m) => `exam #${m.exam.id}`).join(", ")} with the same centre (demo exams share one codebook), so the newest exam was used.`,
      );
    }

    const key = `${exam.id}:${centreId}`;
    let record = this.recorded.get(key);
    try {
      if (record) {
        lines.push(`Evidence for exam #${exam.id}, Centre ${pad(centreId)} was already recorded on MST in this session (block ${record.block}): ${record.link}`);
      } else {
        record = await deps.chain.recordLeak(exam.id, centreId, out.hash, best.matched, best.observed);
        this.recorded.set(key, record);
        lines.push(`Evidence recorded on MST (block ${record.block}): ${record.link}`);
      }
    } catch (e) {
      deps.log(`chat ${job.chatId}: recordLeak failed: ${(e as Error).message}`);
      lines.push(`Recording the evidence on MST failed: ${(e as Error).message}. Nothing was revoked.`, `Evidence hash: ${out.hash}`);
      await this.alert(lines.join("\n"));
      return;
    }

    // 4. Revoke only with --auto-revoke AND a report from an allowed chat.
    const allowed = !!opts.allowedChats?.has(String(job.chatId));
    if (opts.autoRevoke && allowed) {
      try {
        const status = await deps.chain.centreStatus(exam.id, centreId);
        if (status === "Compromised") {
          lines.push(`Centre ${pad(centreId)} was already revoked on MST.`);
        } else {
          const reason = `Leak traced to Centre ${pad(centreId)}. Evidence ${out.hash}`;
          const rev = await deps.chain.revokeCentre(exam.id, centreId, reasonHash(reason));
          lines.push(`Centre ${pad(centreId)} revoked on MST (block ${rev.block}), do not distribute: ${rev.link}`);
        }
      } catch (e) {
        deps.log(`chat ${job.chatId}: revoke failed: ${(e as Error).message}`);
        lines.push(`Revoking Centre ${pad(centreId)} on MST failed: ${(e as Error).message}`);
      }
    } else if (opts.autoRevoke) {
      lines.push(`Not revoked: the report came from a chat that is not in TELEGRAM_ALLOWED_CHAT_IDS. The authority can revoke Centre ${pad(centreId)} on /trace.`);
    } else {
      lines.push(`Not revoked: auto-revoke is off. The authority can revoke Centre ${pad(centreId)} on /trace.`);
    }
    lines.push(`Evidence hash: ${out.hash}`);
    await this.alert(lines.join("\n"));
  }
}
