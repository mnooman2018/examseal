"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  type CentreCode,
  type Extraction,
  ExtractionSchema,
  type MasterPaper,
  buildEvidenceReport,
  decide,
  evidenceHash,
  identifyQuestions,
  scoreCentres,
} from "examseal-core";
import { parseExamId, useExam, useLatestExamId } from "@/hooks/useExam";
import { FileLoader } from "@/components/FileLoader";
import { ErrorBanner, WarningBanner } from "@/components/ErrorBanner";
import { StatusPill } from "@/components/StatusPill";
import { AddressLink } from "@/components/TxLink";
import { centreLabel } from "@/lib/format";
import { type CompressedPhoto, compressPhoto } from "./photo";
import { parseCodebookFile, parseMasterPaperFile } from "./files";
import { EvidencePanel, FeatureTable, RankingTable, ResultCard } from "./Result";
import styles from "./trace.module.css";

export default function TracePage() {
  return (
    <Suspense fallback={<main className="muted">Loading…</main>}>
      <Trace />
    </Suspense>
  );
}

type Transcription = { extraction: Extraction; model: string; attempts: number; createdAt: string };

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

  const [photo, setPhoto] = useState<CompressedPhoto | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
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
      // Only the compressed photo leaves the browser. The codebook and master paper never do.
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ imageBase64: photo.base64, mediaType: "image/jpeg" }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; extraction?: unknown; model?: string; attempts?: number } | null;
      if (!res.ok || !body?.ok) throw new Error(body?.error ?? `The transcription service answered HTTP ${res.status}.`);
      const parsed = ExtractionSchema.safeParse(body.extraction);
      if (!parsed.success) throw new Error("The transcription came back in an unexpected shape.");
      setTranscription({ extraction: parsed.data, model: body.model ?? "unknown", attempts: body.attempts ?? 1, createdAt: new Date().toISOString() });
    } catch (e) {
      setExtractError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Matching runs here, in the browser, deterministically (§10 step 4).
  const result = useMemo(() => {
    if (!transcription || !master || !codebook || !photo || !examId) return null;
    const observations = identifyQuestions(transcription.extraction, master.paper);
    const scores = scoreCentres(observations, codebook.centres);
    const decision = decide(scores, observations.length);
    const report = buildEvidenceReport({
      examId: examId.toString(),
      imageSha256: photo.sha256,
      extraction: transcription.extraction,
      observations,
      scores,
      decision,
      createdAt: transcription.createdAt,
    });
    return { observations, scores, decision, report, hash: evidenceHash(report) };
  }, [transcription, master, codebook, photo, examId]);

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
        A vision model only transcribes the text in the photo. Which centre it came from is decided here, in this browser, by comparing
        question order, option order and wording with each centre&apos;s secret copy.
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
          }}
          onLoad={(json, name) => {
            const r = parseMasterPaperFile(json);
            if (!r.ok) return r.error;
            setMaster({ name, paper: r.value });
            setCodebook(null);
            return null;
          }}
        />
        {master && (
          <FileLoader
            label="Load the codebook (codebook.secret.json)"
            hint="Each centre's secret order, option order and wording. It stays in this tab's memory and is never uploaded."
            loadedName={codebook ? `${codebook.name} · ${codebook.centres.length} centres` : null}
            onClear={() => setCodebook(null)}
            onLoad={(json, name) => {
              const r = parseCodebookFile(json, master.paper);
              if (!r.ok) return r.error;
              setCodebook({ name, centres: r.value });
              return null;
            }}
          />
        )}
        {codebookMismatch.length > 0 && (
          <WarningBanner>
            The codebook has centre(s) {codebookMismatch.join(", ")} that are not registered for exam #{examText}. Check you picked the right exam.
          </WarningBanner>
        )}
      </section>

      <section className="panel stack">
        <h2>3 · Leaked photo</h2>
        <label className="fileloader">
          <input type="file" accept="image/*" hidden disabled={busy !== null} onChange={(e) => onPhoto(e.target.files?.[0])} />
          <strong>{photo ? "Choose a different photo" : "Choose the leaked photo"}</strong>
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
                {busy === "extract" ? "Transcribing… (up to a minute)" : transcription ? "Transcribe again" : "Transcribe the photo"}
              </button>
            </div>
          </div>
        )}
        {extractError && <ErrorBanner title="Transcription failed" message={extractError} onRetry={photo ? transcribe : undefined} />}
        {transcription && (
          <details>
            <summary>
              AI transcription (Gemini, {transcription.model}): {transcription.extraction.questions.length} question(s), legibility{" "}
              {transcription.extraction.legibility}
              {transcription.attempts > 1 ? ` · succeeded on retry` : ""}
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

      {transcription && (!master || !codebook) && <WarningBanner>Load the master paper and the codebook (step 2) to match this photo.</WarningBanner>}

      {result && (
        <>
          <ResultCard decision={result.decision} identified={result.observations.length} transcribed={transcription!.extraction.questions.length} />
          {matchedCentre && (
            <div className="row">
              <span>{centreLabel(matchedCentre.id)} on-chain:</span> <StatusPill status={matchedCentre.status} />
            </div>
          )}
          {result.decision.best && result.observations.length > 0 && (
            <FeatureTable master={master!.paper} observations={result.observations} score={result.decision.best} />
          )}
          {result.scores.length > 0 && result.observations.length > 0 && <RankingTable scores={result.scores} />}
          <EvidencePanel report={result.report} hash={result.hash} />
        </>
      )}
    </main>
  );
}
