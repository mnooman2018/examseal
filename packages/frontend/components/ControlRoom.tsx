"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { examPhase, phaseDisplay, parseExamId, useExam, useLatestExamId } from "@/hooks/useExam";
import { useChainTime } from "@/hooks/useChainTime";
import { PhaseStrip } from "@/components/PhaseStrip";
import { ChainCountdown } from "@/components/ChainCountdown";
import { CentreGrid } from "@/components/CentreGrid";
import { ErrorBanner } from "@/components/ErrorBanner";
import { AddressLink } from "@/components/TxLink";

/** Client side of the control room (/). app/page.tsx wraps it so the route can export metadata. */
export function ControlRoomPage() {
  return (
    <Suspense fallback={<main className="muted">Loading…</main>}>
      <ControlRoom />
    </Suspense>
  );
}

function ControlRoom() {
  const search = useSearchParams();
  const requested = parseExamId(search.get("exam"));
  const latest = useLatestExamId();
  const examId = requested ?? (latest.data && latest.data > 0n ? latest.data : undefined);
  const { data, error, isLoading, refetch } = useExam(examId);
  const chain = useChainTime();

  if (latest.error && !requested) {
    return (
      <main>
        <ErrorBanner title="Cannot reach MST Testnet" error={latest.error} onRetry={() => latest.refetch()} />
      </main>
    );
  }
  if (!requested && latest.data === 0n) {
    return (
      <main>
        <h1>Control room</h1>
        <p className="muted">No exams on the registry yet. Seed one with <span className="mono">pnpm ops seed</span>.</p>
      </main>
    );
  }

  const exam = data?.exam;
  const centres = data?.centres ?? [];
  const phase = exam ? examPhase(exam, centres, chain.now) : "Sealed";
  const released = centres.filter((c) => c.status === "Released").length;
  const compromised = centres.filter((c) => c.status === "Compromised").length;

  return (
    <main>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="muted small">CONTROL ROOM · EXAM #{examId?.toString() ?? "…"}</div>
          <h1>{exam?.title ?? (isLoading ? "Reading exam from chain…" : "Exam not available")}</h1>
        </div>
        <ExamPicker current={examId} latest={latest.data} />
      </div>

      {error ? <ErrorBanner title={`Could not read exam #${examId}`} error={error} onRetry={() => refetch()} /> : null}
      {chain.error ? <ErrorBanner title="Cannot read chain time" error={chain.error} /> : null}

      {exam && (
        <>
          <PhaseStrip phase={phase} display={phaseDisplay(phase, centres)} />

          <div className="grid-2">
            <div className="panel">
              <ChainCountdown large target={exam.releaseTime} now={chain.now} before="Release opens in" after="Release opened at" />
            </div>
            <div className="panel row" style={{ justifyContent: "space-around" }}>
              <Stat label="Centres" value={String(centres.length)} />
              <Stat label="Released" value={String(released)} tone="ok" />
              <Stat label="Compromised" value={String(compromised)} tone={compromised ? "bad" : undefined} />
              <Stat label="Threshold" value={`${exam.threshold} of ${exam.custodians.length}`} />
            </div>
          </div>

          <section className="panel">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>Centres</h2>
              <span className="muted small">
                Chain block {chain.blockNumber?.toString() ?? "…"} · refreshes every 3 s
              </span>
            </div>
            <CentreGrid exam={exam} centres={centres} />
          </section>

          <section className="panel row" style={{ justifyContent: "space-between" }}>
            <div className="muted small">
              Authority <AddressLink address={exam.authority} /> · created in block {exam.createdBlock.toString()}
            </div>
            <Link href={`/exam/${exam.id}`}>
              <button className="btn-primary">Commitments &amp; chain-of-custody timeline →</button>
            </Link>
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "bad" }) {
  const color = tone === "ok" ? "var(--green)" : tone === "bad" ? "var(--red)" : undefined;
  return (
    <div style={{ textAlign: "center" }}>
      <div className="stat" style={{ color }}>{value}</div>
      <div className="muted small">{label.toUpperCase()}</div>
    </div>
  );
}

function ExamPicker({ current, latest }: { current?: bigint; latest?: bigint }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        const id = parseExamId(draft.trim());
        if (id) router.push(`/?exam=${id}`);
      }}
    >
      <input
        aria-label="Exam number"
        inputMode="numeric"
        placeholder={`Exam # (latest ${latest?.toString() ?? "…"})`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        style={{ width: "11rem" }}
      />
      <button type="submit">Open</button>
      {current !== undefined && latest !== undefined && current !== latest && (
        <button type="button" onClick={() => router.push("/")}>Latest</button>
      )}
    </form>
  );
}
