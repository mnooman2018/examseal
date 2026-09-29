"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  type CandidateCode,
  type CentreCode,
  type Extraction,
  ExtractionSchema,
  type Hex,
  type MasterPaper,
  buildEvidenceReport,
  decide,
  decideWithCandidates,
  evidenceHash,
  identifyQuestions,
  parsePastedText,
  scoreCentres,
  toHexBytes,
} from "examseal-core";
import { parseExamId, useExam, useLatestExamId } from "@/hooks/useExam";
import { FileLoader } from "@/components/FileLoader";
import { ErrorBanner, WarningBanner } from "@/components/ErrorBanner";
import { StatusPill } from "@/components/StatusPill";
import { AddressLink } from "@/components/TxLink";
import { centreLabel } from "@/lib/format";
import { type CompressedPhoto, compressPhoto } from "./photo";
import { parseCandidatesFile, parseCodebookFile, parseMasterPaperFile } from "./files";
import { EvidencePanel, FeatureTable, RankingTable, ResultCard } from "./Result";
import { Accountability } from "./Accountability";
import { EliminationGrid } from "./EliminationGrid";
import styles from "./trace.module.css";

export default function TracePage() {
  return (
    <Suspense fallback={<main className="muted">Loading…</main>}>
      <Trace />
    </Suspense>
  );
}

/** Where the transcription came from. "pasted" involves no AI and is always labelled as such. */
type Transcription = {
  source: "photo" | "pasted";
  extraction: Extraction;
  provider: string;
  model: string;
  attempts: number;
  fallbacks: string[];
  /** SHA-256 of the exact bytes analysed: the compressed photo, or the UTF-8 of the pasted text. */
  sha256: Hex;
  createdAt: string;
};
const PROVIDER_LABEL: Record<string, string> = { gemini: "Gemini", groq: "Groq" };

async function sha256Hex(bytes: Uint8Array): Promise<Hex> {
  return toHexBytes(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))));
}

function Trace() {
  const search = useSearchParams();
  const latest = useLatestExamId();
  const [examText, setExamText] = useState<string>(search.get("exam") ?? "");
  useEffect(() => {
    if (!examText && latest.data && latest.data > 0n) setExamText(latest.data.toString());
  }, [latest.data, examText]);
  const examId = parseExamId(examText);
  const examQ = useExam(examId);

  // Authority files: memory only (React state). Never persisted, never uploaded.
  const [master, setMaster] = useState<{ name: string; paper: MasterPaper } | null>(null);
  const [codebook, setCodebook] = useState<{ name: string; centres: CentreCode[] } | null>(null);
  const [candidates, setCandidates] = useState<{ name: string; list: CandidateCode[]; examId: string } | null>(null);

  const [mode, setMode] = useState<"photo" | "pasted">("photo");
  const [photo, setPhoto] = useState<CompressedPhoto | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [busy, setBusy] = useState<"compress" | "extract" | null>(null);
  const [transcription, setTranscription] = useState<Transcription | null>(null);
  const [extractError, setExtractError] = useState<string | null>(null);

  useEffect(() => () => void (photoUrl && URL.revokeObjectURL(photoUrl)), [photoUrl]);

  async function onPhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    setExtractError(null);
    setTranscription(null);
    setBusy("compress");
    try {
      const p = await compressPhoto(file);
      setPhoto(p);
      setPhotoUrl(URL.createObjectURL(p.blob));
    } catch (e) {
      setPhoto(null);
      setPhotoUrl(null);
      setPhotoError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function transcribe() {
    if (!photo) return;
    setBusy("extract");
    setExtractError(null);
    setTranscription(null);
    try {
      // Only the compressed photo leaves the browser. The codebook, seat file and master paper never do.
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64: photo.base64, mediaType: "image/jpeg" }),
      });
      const body = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        extraction?: unknown;
        model?: string;
        attempts?: number;
        provider?: string;
        tried?: { provider: string; model: string; ok: boolean }[];
      } | null;
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `The transcription service answered HTTP ${res.status}.`);
      const parsed = ExtractionSchema.safeParse(body.extraction);
      if (!parsed.success) throw new Error("The transcription came back in an unexpected shape.");
      const fallbacks = [
        ...new Set((body.tried ?? []).filter((t) => !t.ok && t.model !== body.model).map((t) => `${PROVIDER_LABEL[t.provider] ?? t.provider} ${t.model}`)),
      ];
      setTranscription({
        source: "photo",
        extraction: parsed.data,
        provider: PROVIDER_LABEL[body.provider ?? ""] ?? body.provider ?? "unknown",
        model: body.model ?? "unknown",
        attempts: body.attempts ?? 1,
        fallbacks,
        sha256: photo.sha256,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      setExtractError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Pasted text is parsed here, deterministically, with no AI and no network call.
  async function usePasted() {
    setExtractError(null);
    setTranscription(null);
    const extraction = parsePastedText(pasted);
    if (extraction.questions.length === 0) {
      setExtractError("No questions found in the pasted text. Paste the questions and options as they appear.");
      return;
    }
    setTranscription({
      source: "pasted",
      extraction,
      provider: "pasted",
      model: "",
      attempts: 0,
      fallbacks: [],
      sha256: await sha256Hex(new TextEncoder().encode(pasted)),
      createdAt: new Date().toISOString(),
    });
  }

  // Matching runs here, in the browser, deterministically (§10 step 4). With a seat file: centre first, then seat (D9).
  const seatsActive = !!candidates && !!examId && candidates.examId === examId.toString();
  const result = useMemo(() => {
    if (!transcription || !master || !codebook || !examId) return null;
    const observations = identifyQuestions(transcription.extraction, master.paper);
    let scores;
    let decision;
    let seat;
    if (seatsActive) {
      const r = decideWithCandidates(observations, codebook.centres, candidates!.list);
      scores = r.scores;
      decision = r.decision;
      seat = r.seat;
    } else {
      scores = scoreCentres(observations, codebook.centres);
      decision = decide(scores, observations.length);
    }
    // §8 EvidenceReport is unchanged: imageSha256 holds the SHA-256 of whatever was analysed; the seat, if any, is in decision.reason.
    const report = buildEvidenceReport({
      examId: examId.toString(),
      imageSha256: transcription.sha256,
      extraction: transcription.extraction,
      observations,
      scores,
      decision,
      createdAt: transcription.createdAt,
    });
    return { observations, scores, decision, seat, report, hash: evidenceHash(report) };
  }, [transcription, master, codebook, candidates, seatsActive, examId]);

  const exam = examQ.data?.exam;
  const chainCentres = examQ.data?.centres;
  const codebookMismatch =
    codebook && chainCentres
      ? codebook.centres.filter((c) => !chainCentres.some((x) => x.id === c.centreId)).map((c) => c.centreId)
      : [];
  const matchedCentre = result?.decision.kind === "MATCH" ? chainCentres?.find((c) => c.id === result.decision.centreId) : undefined;

  return (
    <main>
      <div className="muted small">EXAM AUTHORITY</div>
      <h1>Trace a leaked paper</h1>
      <p className="muted">
        A vision model only transcribes the text in a photo; pasted text is not sent anywhere. Which centre (and, for digital exams, which seat) it
        came from is decided here, in this browser, by comparing question order, option order and wording with each secret copy.
      </p>

      <section className="panel stack">
        <h2>1 · Exam</h2>
        <label className="row">
          <span>Exam #</span>
          <input inputMode="numeric" value={examText} onChange={(e) => setExamText(e.target.value.trim())} style={{ width: "6rem" }} />
          {exam && <Link href={`/exam/${exam.id}`}>{exam.title}</Link>}
        </label>
        {examQ.error ? <ErrorBanner title={`Could not read exam #${examText}`} error={examQ.error} onRetry={() => examQ.refetch()} /> : null}
        {exam && (
          <div className="muted small">
            {exam.centreCount} centres · authority <AddressLink address={exam.authority} />
          </div>
        )}
      </section>

      <section className="panel stack">
        <h2>2 · Authority files</h2>
        <FileLoader
          label="Load the master paper (master-paper.json)"
          hint="Needed to recognise the questions. It stays in this tab's memory and is never uploaded."
          loadedName={master?.name}
          onClear={() => {
            setMaster(null);
            setCodebook(null);
            setCandidates(null);
          }}
          onLoad={(json, name) => {
            const r = parseMasterPaperFile(json);
            if (!r.ok) return r.error;
            setMaster({ name, paper: r.value });
            setCodebook(null);
            setCandidates(null);
            return null;
          }}
        />
        {master && (
          <FileLoader
            label="Load the codebook (codebook.secret.json)"
            hint="Each centre's secret order, option order and wording. It stays in this tab's memory and is never uploaded."
            loadedName={codebook ? `${codebook.name} · ${codebook.centres.length} centres` : null}
            onClear={() => {
              setCodebook(null);
              setCandidates(null);
            }}
            onLoad={(json, name) => {
              const r = parseCodebookFile(json, master.paper);
              if (!r.ok) return r.error;
              setCodebook({ name, centres: r.value });
              setCandidates(null);
              return null;
            }}
          />
        )}
        {master && codebook && (
          <FileLoader
            label="Optional: load the seat variants (candidates.secret.json) to trace to a seat"
            hint="Written by ops seed or ops candidates for this exam. Without it, results are per centre. Memory only, never uploaded."
            loadedName={candidates ? `${candidates.name} · ${candidates.list.length} seats · exam #${candidates.examId}` : null}
            onClear={() => setCandidates(null)}
            onLoad={(json, name) => {
              if (!examId) return "Enter the exam number first: seat variants differ per exam.";
              const r = parseCandidatesFile(json, master.paper, codebook.centres, examId.toString());
              if (!r.ok) return r.error;
              setCandidates({ name, list: r.value, examId: examId.toString() });
              return null;
            }}
          />
        )}
        {candidates && examId && candidates.examId !== examId.toString() && (
          <WarningBanner>
            The seat file is for exam #{candidates.examId}; seat tracing is off for exam #{examText}. Load that exam&apos;s seat file.
          </WarningBanner>
        )}
        {codebookMismatch.length > 0 && (
          <WarningBanner>
            The codebook has centre(s) {codebookMismatch.join(", ")} that are not registered for exam #{examText}. Check you picked the right exam.
          </WarningBanner>
        )}
      </section>

      <section className="panel stack">
        <h2>3 · The leak</h2>
        <div className="row" role="tablist">
          <button type="button" className={mode === "photo" ? "btn-primary" : ""} aria-pressed={mode === "photo"} onClick={() => setMode("photo")}>
            Photo or screenshot
          </button>
          <button type="button" className={mode === "pasted" ? "btn-primary" : ""} aria-pressed={mode === "pasted"} onClick={() => setMode("pasted")}>
            Paste leaked text
          </button>
        </div>

        {mode === "photo" ? (
          <>
            <label className="fileloader">
              <input type="file" accept="image/*" hidden disabled={busy !== null} onChange={(e) => onPhoto(e.target.files?.[0])} />
              <strong>{photo ? "Choose a different photo" : "Choose the leaked photo or screenshot"}</strong>
              <span className="muted">Resized to 1600 px and re-encoded as JPEG here, which also removes location and camera metadata.</span>
            </label>
            {busy === "compress" && <div className="muted">Compressing…</div>}
            {photoError && <p className="field-error">{photoError}</p>}
            {photo && photoUrl && (
              <div className="stack">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photoUrl} alt="Leaked photo after compression" className={styles.photo} />
                <div className="muted small">
                  {photo.originalName}: {(photo.originalBytes / 1e6).toFixed(2)} MB → {photo.width}×{photo.height} JPEG, {(photo.bytes / 1e6).toFixed(2)} MB ·
                  SHA-256 <span className="mono">{photo.sha256.slice(0, 18)}…</span>
                </div>
                <div className="row">
                  <button type="button" className="btn-primary" disabled={busy !== null} onClick={transcribe}>
                    {busy === "extract" ? "Transcribing… (up to a minute)" : transcription?.source === "photo" ? "Transcribe again" : "Transcribe the photo"}
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="stack">
            <span className="pill pill-info" style={{ alignSelf: "flex-start" }}>
              PASTED TEXT · NO AI
            </span>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              rows={10}
              placeholder={"Paste the leaked questions as they appear, e.g.\n1. Which data structure follows the First-In-First-Out principle?\n(A) Stack\n(B) Queue\n(C) Binary tree\n(D) Hash table"}
              style={{ width: "100%", fontFamily: "var(--mono)" }}
            />
            <div className="muted small">
              Read here with a fixed parser (question numbers, A–D options). Nothing is sent to any server and no AI is involved.
            </div>
            <div className="row">
              <button type="button" className="btn-primary" disabled={!pasted.trim()} onClick={usePasted}>
                Use this text
              </button>
            </div>
          </div>
        )}

        {extractError && <ErrorBanner title="Could not read the leak" message={extractError} onRetry={mode === "photo" && photo ? transcribe : undefined} />}
        {transcription && (
          <details>
            <summary>
              {transcription.source === "pasted" ? (
                <>Pasted text (no AI): </>
              ) : (
                <>
                  AI transcription ({transcription.provider}, {transcription.model}):{" "}
                </>
              )}
              {transcription.extraction.questions.length} question(s)
              {transcription.source === "photo" && `, legibility ${transcription.extraction.legibility}`}
              {transcription.fallbacks.length > 0
                ? ` · after ${transcription.fallbacks.join(", ")} did not answer`
                : transcription.attempts > 1
                  ? ` · succeeded on attempt ${transcription.attempts}`
                  : ""}
            </summary>
            <ol className="stack small" style={{ paddingLeft: "1.2rem" }}>
              {transcription.extraction.questions.map((q, i) => (
                <li key={i}>
                  <span className="mono muted">{q.printedNumber ?? "?"}.</span> {q.text}
                  <div className="muted">{q.options.map((o) => `(${o.label ?? "?"}) ${o.text}`).join("   ")}</div>
                </li>
              ))}
            </ol>
          </details>
        )}
      </section>

      {transcription && (!master || !codebook) && <WarningBanner>Load the master paper and the codebook (step 2) to match this leak.</WarningBanner>}

      {result && (
        <>
          <div className={styles.console}>
            <EliminationGrid scores={result.scores} decision={result.decision} seat={result.seat?.seat} />
            <div className="stack">
              <ResultCard
                decision={result.decision}
                seat={result.seat?.seat}
                identified={result.observations.length}
                transcribed={transcription!.extraction.questions.length}
                source={transcription!.source}
                seatTracing={seatsActive}
              />
              {matchedCentre && (
                <div className="row">
                  <span>{centreLabel(matchedCentre.id)} on-chain:</span> <StatusPill status={matchedCentre.status} />
                </div>
              )}
            </div>
          </div>
          {result.decision.best && result.observations.length > 0 && (
            <FeatureTable master={master!.paper} observations={result.observations} score={result.decision.best} seat={result.seat?.seat} />
          )}
          {result.scores.length > 0 && result.observations.length > 0 && <RankingTable scores={result.scores} />}
          <EvidencePanel report={result.report} hash={result.hash} source={transcription!.source} />
          {exam && matchedCentre ? (
            <Accountability exam={exam} centre={matchedCentre} decision={result.decision} evidence={result.hash} />
          ) : (
            <p className="muted">Evidence is recorded on MST only for a MATCH. An inconclusive leak is never attributed to a centre.</p>
          )}
        </>
      )}
    </main>
  );
}
