"use client";

// D9 (stretch): digital, computer-based exam view. A new route only; Nooman's pages are unchanged
// and only imported from. Approved by Sampurna as integration owner for Nooman's review.

import { useMemo, useState } from "react";
import Link from "next/link";
import { hexToBytes, keccak256, type Hex } from "viem";
import { type VariantPaper, applySeatOps, deriveCandidateSeed, generateSeatOps, recoverVariant } from "examseal-core";
import { useExam, type Centre, type Exam } from "@/hooks/useExam";
import { publicClient } from "@/lib/client";
import { registry } from "@/lib/registry";
import { fetchCiphertext } from "@/lib/logs";
import { centreLabel } from "@/lib/format";
import { explainError } from "@/lib/errors";
import { parseCentreKeyFile, type CentreKeyFile } from "@/lib/secretFiles";
import { FileLoader } from "@/components/FileLoader";
import { ErrorBanner } from "@/components/ErrorBanner";
import { StatusPill } from "@/components/StatusPill";

/** Seats per centre written by ops seed / ops candidates (packages/ops DEFAULT_SEATS). */
const MAX_SEAT = 30;

export default function DigitalExamPage() {
  // The centre key file lives in React state only: never persisted, never uploaded.
  const [file, setFile] = useState<{ name: string; data: CentreKeyFile } | null>(null);
  return (
    <main>
      <div className="muted small">DIGITAL EXAM · CENTRE TERMINAL</div>
      <h1>Computer-based exam</h1>
      <p className="muted">
        For computer-based exams. The centre unlocks its paper exactly as on the Centre page; each candidate then enters their seat number and
        sees their own copy. Every seat&apos;s copy is slightly different, so a leaked screenshot or retyped text can be traced to the seat.
      </p>
      <section className="panel">
        <h2>1 · Centre key file</h2>
        <FileLoader
          label="Load the centre key file (centre-N.centrekey.secret.json)"
          loadedName={file?.name}
          onClear={() => setFile(null)}
          onLoad={(json, name) => {
            const r = parseCentreKeyFile(json);
            if (!r.ok) return r.error;
            if (r.value.contract.toLowerCase() !== registry.address.toLowerCase())
              return `This file is for registry ${r.value.contract}, but this site uses ${registry.address}.`;
            setFile({ name, data: r.value });
            return null;
          }}
        />
      </section>
      {file && <Terminal key={`${file.data.examId}-${file.data.centreId}`} file={file.data} />}
    </main>
  );
}

function Terminal({ file }: { file: CentreKeyFile }) {
  const { data, error, refetch } = useExam(file.examId);
  const exam = data?.exam;
  const centre = data?.centres.find((c) => c.id === file.centreId);
  if (error) return <ErrorBanner title={`Could not read exam #${file.examId}`} error={error} onRetry={() => refetch()} />;
  if (exam && !centre) return <ErrorBanner message={`${centreLabel(file.centreId)} is not registered for exam #${file.examId}.`} />;
  if (!exam || !centre) return <p className="muted">Reading exam #{String(file.examId)} from MST Testnet…</p>;
  return <Unlock file={file} exam={exam} centre={centre} />;
}

function Unlock({ file, exam, centre }: { file: CentreKeyFile; exam: Exam; centre: Centre }) {
  const [paper, setPaper] = useState<VariantPaper | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const keyMatches = file.x25519PublicKey.toLowerCase() === centre.encPubKey.toLowerCase();
  const compromised = centre.status === "Compromised";
  const enough = centre.approvals >= exam.threshold;

  async function unlock() {
    setBusy(true);
    setErr(null);
    try {
      const [, shares] = await publicClient.readContract({ ...registry, functionName: "getShares", args: [exam.id, centre.id] });
      const sealed = (shares as readonly Hex[]).filter((s) => s !== "0x");
      const ciphertext = await fetchCiphertext(exam.id, centre.id, centre.registeredBlock);
      if (keccak256(ciphertext).toLowerCase() !== centre.variantCommitment.toLowerCase()) {
        throw new Error("The encrypted copy does not match the commitment computed on-chain. Refusing to decrypt.");
      }
      const r = await recoverVariant({
        sealedPieces: sealed.map((s) => hexToBytes(s)),
        centreSk: hexToBytes(file.x25519PrivateKey),
        centrePk: hexToBytes(file.x25519PublicKey),
        ciphertext: hexToBytes(ciphertext),
        examId: exam.id,
        centreId: centre.id,
        threshold: exam.threshold,
      });
      setPaper(JSON.parse(new TextDecoder().decode(r.plaintext)) as VariantPaper);
    } catch (e) {
      setErr(explainError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {compromised && (
        <div className="banner do-not-use" role="alert">
          DO NOT USE: {centreLabel(centre.id).toUpperCase()} HAS BEEN REVOKED
        </div>
      )}
      {!keyMatches && <ErrorBanner message={`This key file does not match ${centreLabel(centre.id)}'s public key on-chain.`} />}
      <section className="panel stack">
        <h2>2 · Unlock the centre&apos;s paper</h2>
        <div className="row">
          <span className="muted small">
            <Link href={`/exam/${exam.id}`}>EXAM #{exam.id.toString()}</Link> · {centreLabel(centre.id).toUpperCase()} · {centre.approvals}/
            {exam.custodians.length} approvals (need {exam.threshold})
          </span>
          <StatusPill status={centre.status} />
        </div>
        {!paper && (
          <button className="btn-primary btn-large" disabled={!enough || compromised || !keyMatches || busy} onClick={unlock}>
            {busy ? "Unlocking…" : "Unlock paper"}
          </button>
        )}
        {!enough && !compromised && <p className="muted">Locked until {exam.threshold} custodians release their pieces on MST.</p>}
        {err && <ErrorBanner title="Unlock failed" message={err} />}
        {paper && <p className="check-ok">✓ Centre paper decrypted in this browser. Candidates can now open their own copy.</p>}
      </section>
      {paper && <SeatView paper={paper} centreSk={file.x25519PrivateKey} />}
    </>
  );
}

function SeatView({ paper, centreSk }: { paper: VariantPaper; centreSk: Hex }) {
  const [seatText, setSeatText] = useState("");
  const seat = /^\d+$/.test(seatText) ? Number(seatText) : null;
  const valid = seat !== null && seat >= 1 && seat <= MAX_SEAT;

  // Seat ops depend only on the centre key and the question count (D9): generate seats 1..seat
  // (generation is sequential, so seat M is the same whatever the total) and take seat M.
  const seatPaper = useMemo(() => {
    if (!valid) return null;
    const seed = deriveCandidateSeed(hexToBytes(centreSk));
    const ops = generateSeatOps(
      paper.questions.length,
      seed,
      Array.from({ length: seat! }, (_, i) => i + 1),
    )[seat! - 1];
    return applySeatOps(paper, ops);
  }, [valid, seat, paper, centreSk]);

  return (
    <section className="panel stack">
      <h2>3 · Candidate</h2>
      <label className="row">
        <span>Seat number</span>
        <input inputMode="numeric" value={seatText} onChange={(e) => setSeatText(e.target.value.trim())} style={{ width: "6rem" }} />
        <span className="muted small">1–{MAX_SEAT}</span>
      </label>
      {seatText && !valid && <p className="field-error">Enter a seat number from 1 to {MAX_SEAT}.</p>}
      {seatPaper && (
        <div className="stack">
          <div className="muted small">
            {seatPaper.examTitle} · {seatPaper.subject} · {seatPaper.durationMinutes} minutes. {seatPaper.instructions} Answers are not recorded in this
            demo.
          </div>
          <ol className="stack" style={{ listStyle: "none", padding: 0 }}>
            {seatPaper.questions.map((q) => (
              <li key={q.number} className="panel">
                <div>
                  <strong>{q.number}.</strong> {q.text}
                </div>
                <div className="stack" style={{ marginTop: "0.5rem" }}>
                  {q.options.map((o) => (
                    <label key={o.label} className="row">
                      <input type="radio" name={`q${q.number}`} />
                      <span>
                        ({o.label}) {o.text}
                      </span>
                    </label>
                  ))}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}
