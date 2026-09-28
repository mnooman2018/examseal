"use client";

import type { CentreScore, Decision, EvidenceReport, Hex, MasterPaper, Observation } from "examseal-core";
import { canonicalJson } from "examseal-core";
import { HashDisplay } from "@/components/HashDisplay";
import { centreLabel } from "@/lib/format";
import styles from "./trace.module.css";

function Mark({ v }: { v: boolean | undefined }) {
  if (v === undefined) return <span className="muted">–</span>;
  return v ? <span className="check-ok">✓</span> : <span className="check-bad">✗</span>;
}

/** Verdict card. Numbers are counts from the matcher; there is no percentage "confidence" (§10). */
export function ResultCard({ decision, identified, transcribed }: { decision: Decision; identified: number; transcribed: number }) {
  const title =
    decision.kind === "MATCH"
      ? `Leak traced to ${centreLabel(decision.centreId!)}`
      : decision.kind === "INCONCLUSIVE"
        ? "Inconclusive: not attributed to any centre"
        : "Not this exam";
  return (
    <section className="panel stack" aria-live="polite">
      <h2>Result</h2>
      <div className={`${styles.verdict} ${decision.kind === "MATCH" ? styles.verdictMatch : styles.verdictOther}`}>{title}</div>
      <div className={styles.sentence}>{decision.reason}</div>
      <div className="muted small">
        {identified} of {transcribed} transcribed question{transcribed === 1 ? "" : "s"} identified in the master paper. Features compared: printed
        position, option order, and wording, for each identified question.
      </div>
    </section>
  );
}

/** Per-question ✓/✗ table against one centre's code. */
export function FeatureTable({ master, observations, score }: { master: MasterPaper; observations: Observation[]; score: CentreScore }) {
  const byId = new Map(master.questions.map((q) => [q.id, q]));
  const rows = [...observations].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  return (
    <section className="panel stack">
      <h2>Feature check against {centreLabel(score.centreId)}</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Printed as</th>
              <th>Question</th>
              <th>Position</th>
              <th>Option order</th>
              <th>Wording</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => {
              const d = score.perQuestion[o.qid] ?? {};
              return (
                <tr key={o.qid}>
                  <td className="mono">{o.position ?? "?"}</td>
                  <td className={styles.qtext}>
                    <span className="mono muted">{o.qid}</span> {byId.get(o.qid)?.wordings[0]}
                  </td>
                  <td>
                    <Mark v={d.position} />
                  </td>
                  <td>
                    <Mark v={d.options} />
                  </td>
                  <td>
                    <Mark v={d.wording} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="muted small">
        ✓ matches this centre&apos;s copy · ✗ differs · – not visible or not readable in the photo (not counted).
      </div>
    </section>
  );
}

export function RankingTable({ scores, limit = 5 }: { scores: CentreScore[]; limit?: number }) {
  return (
    <section className="panel stack">
      <h2>Closest centres</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Centre</th>
              <th>Features matching</th>
            </tr>
          </thead>
          <tbody>
            {scores.slice(0, limit).map((s) => (
              <tr key={s.centreId}>
                <td>{centreLabel(s.centreId)}</td>
                <td className="mono">
                  {s.matched} of {s.observed}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function EvidencePanel({ report, hash }: { report: EvidenceReport; hash: Hex }) {
  function download() {
    const blob = new Blob([canonicalJson(report)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `evidence-exam-${report.examId}-${hash.slice(2, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <section className="panel stack">
      <h2>Evidence report</h2>
      <dl className="kv">
        <dt>Evidence hash</dt>
        <dd>
          <HashDisplay value={hash} />
        </dd>
        <dt>Photo SHA-256</dt>
        <dd>
          <HashDisplay value={report.imageSha256} />
        </dd>
        <dt>Matcher</dt>
        <dd className="mono">{report.matcherVersion}</dd>
        <dt>Created</dt>
        <dd className="mono">{report.createdAt}</dd>
      </dl>
      <p className="muted small">
        Evidence hash = keccak256 of the canonical JSON below. Recording it on MST fixes this exact report; anyone holding the report can
        recompute the hash and compare. The report contains the transcription and the scores, not the photo or the codebook.
      </p>
      <div className="row">
        <button type="button" onClick={download}>
          Download report (JSON)
        </button>
      </div>
      <details>
        <summary>Show report</summary>
        <pre className={styles.json}>{JSON.stringify(report, null, 2)}</pre>
      </details>
    </section>
  );
}
