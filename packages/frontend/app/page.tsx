"use client";

// Control room as a dashboard (D12). Layout and read-only display only: the data comes from the same
// hooks as before (useExam, useChainTime) plus useCustodyEvents (the chain-of-custody scan used by
// /exam/[id]). No writes happen on this page.

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type Centre, type Exam, type Phase, examPhase, parseExamId, phaseDisplay, useExam, useLatestExamId } from "@/hooks/useExam";
import { useChainTime } from "@/hooks/useChainTime";
import { type TimelineEntry, useCustodyEvents } from "@/hooks/useCustodyEvents";
import { PhaseStrip } from "@/components/PhaseStrip";
import { ChainCountdown } from "@/components/ChainCountdown";
import { CentreGrid } from "@/components/CentreGrid";
import { ErrorBanner } from "@/components/ErrorBanner";
import { AddressLink, TxLink } from "@/components/TxLink";
import { ApprovalsChart } from "@/components/dashboard/ApprovalsChart";
import { Icon } from "@/components/AppShell";
import { EventsTable } from "@/components/dashboard/EventsTable";

export default function ControlRoomPage() {
  return (
    <Suspense fallback={<main className="muted">Loading…</main>}>
      <ControlRoom />
    </Suspense>
  );
}

const PHASE_TONE: Record<Phase, string> = { Sealed: "tone-neutral", "Awaiting release": "tone-pending", Released: "tone-ok", Compromised: "tone-bad" };

function ControlRoom() {
  const search = useSearchParams();
  const requested = parseExamId(search.get("exam"));
  const latest = useLatestExamId();
  const examId = requested ?? (latest.data && latest.data > 0n ? latest.data : undefined);
  const { data, error, isLoading, refetch } = useExam(examId);
  const chain = useChainTime();
  const exam = data?.exam;
  const events = useCustodyEvents(exam?.id, exam?.createdBlock);

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
        <p className="muted">
          No exams on the registry yet. Seed one with <span className="mono">pnpm ops seed</span>.
        </p>
      </main>
    );
  }

  const centres = data?.centres ?? [];
  const phase = exam ? examPhase(exam, centres, chain.now) : "Sealed";

  return (
    <main>
      <div className="eyebrow">Control room · Exam #{examId?.toString() ?? "…"}</div>
      <h1>{exam?.title ?? (isLoading ? "Reading exam from chain…" : "—")}</h1>

      {error ? <ErrorBanner title={`Could not read exam #${examId}`} error={error} onRetry={() => refetch()} /> : null}
      {chain.error ? <ErrorBanner title="Cannot read chain time" error={chain.error} /> : null}

      {exam && (
        <>
          <PhaseStrip phase={phase} display={phaseDisplay(phase, centres)} />
          <Kpis exam={exam} centres={centres} phase={phase} entries={events.entries} now={chain.now} blockNumber={chain.blockNumber} />

          <div className="dash-grid">
            <section className="panel">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2>Live chain events</h2>
                <span className="muted small">from the registry · refreshes every 3 s</span>
              </div>
              {events.error ? <ErrorBanner title="Could not read events" error={events.error} /> : null}
              {events.loading && events.entries.length === 0 ? <p className="muted">Reading events from chain…</p> : <EventsTable entries={events.entries} now={chain.now} />}
              <div className="row" style={{ marginTop: "0.6rem" }}>
                <Link href={`/exam/${exam.id}`}>Full chain-of-custody timeline →</Link>
              </div>
            </section>
            <section className="panel">
              <h2>Approvals over time</h2>
              <ApprovalsChart entries={events.entries} releaseTime={exam.releaseTime} now={chain.now} totalShares={centres.length * exam.custodians.length} />
            </section>
          </div>

          <section className="panel">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2>Centres</h2>
              <span className="muted small">
                Chain block <span className="mono">{chain.blockNumber?.toString() ?? "…"}</span> · refreshes every 3 s
              </span>
            </div>
            <CentreGrid exam={exam} centres={centres} />
          </section>

          <section className="panel row" style={{ justifyContent: "space-between" }}>
            <div className="muted small">
              Authority <AddressLink address={exam.authority} /> · created in block <span className="mono">{exam.createdBlock.toString()}</span> · threshold{" "}
              <span className="mono">
                {exam.threshold} of {exam.custodians.length}
              </span>
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

function Kpis({
  exam,
  centres,
  phase,
  entries,
  now,
  blockNumber,
}: {
  exam: Exam;
  centres: Centre[];
  phase: Phase;
  entries: TimelineEntry[];
  now: number | undefined;
  blockNumber: bigint | undefined;
}) {
  const display = phaseDisplay(phase, centres);
  const released = centres.filter((c) => c.status === "Released").length;
  const compromised = centres.filter((c) => c.status === "Compromised").length;
  const custodiansReleased = new Set(entries.filter((e) => e.name === "ShareReleased").map((e) => String(e.args.custodian).toLowerCase())).size;
  const lastTxs = Array.from(new Set([...entries].reverse().map((e) => e.txHash))).slice(0, 3);

  const statusBadge = PHASE_TONE[phase].replace("tone-", "badge-");
  const centresBadge = compromised ? "badge-bad" : released > 0 ? "badge-ok" : "badge-neutral";
  const custodianBadge = custodiansReleased >= exam.threshold ? "badge-ok" : custodiansReleased > 0 ? "badge-pending" : "badge-neutral";

  return (
    <div className="kpi-grid">
      <div className="kpi">
        <span className="kpi-label">Exam status</span>
        <div className="kpi-body">
          <div className="kpi-main">
            <span className={`kpi-value-display ${PHASE_TONE[phase]}`}>{display.label}</span>
            <span className="kpi-sub">{display.detail ?? `${centres.length} centres · threshold ${exam.threshold} of ${exam.custodians.length}`}</span>
          </div>
          <span className={`kpi-badge ${statusBadge}`}>
            <Icon name="pulse" size={24} />
          </span>
        </div>
      </div>

      <div className="kpi">
        <span className="kpi-label">Centres unlocked</span>
        <div className="kpi-body">
          <div className="kpi-main">
            <span className="kpi-value">
              {released}/{centres.length}
            </span>
            <span className="kpi-sub">{compromised ? `${compromised} compromised` : "none compromised"}</span>
          </div>
          <span className={`kpi-badge ${centresBadge}`}>
            <Icon name="bars" size={24} />
          </span>
        </div>
        <div className="mini-bars" aria-hidden>
          {centres.map((c) => {
            const tone = c.status === "Compromised" ? "bad" : c.status === "Released" ? "ok" : c.approvals > 0 ? "pending" : "";
            const h = Math.max(15, Math.min(100, (c.approvals / exam.threshold) * 100));
            return <span key={c.id} className={`mini-bar ${tone ? `mini-bar-${tone}` : ""}`} style={{ height: `${h}%` }} title={`Centre ${c.id}: ${c.approvals}/${exam.custodians.length}`} />;
          })}
        </div>
      </div>

      <div className="kpi">
        <span className="kpi-label">Custodian approvals</span>
        <div className="kpi-body">
          <div className="kpi-main">
            <span className="kpi-value">
              {custodiansReleased}/{exam.custodians.length}
            </span>
          </div>
          <span className={`kpi-badge ${custodianBadge}`}>
            <Icon name="shield" size={24} />
          </span>
        </div>
        <ChainCountdown target={exam.releaseTime} now={now} before="Release opens in" after="Release opened at" />
      </div>

      <div className="kpi">
        <span className="kpi-label">Latest block</span>
        <div className="kpi-body">
          <div className="kpi-main">
            <span className="kpi-value">#{blockNumber?.toString() ?? "…"}</span>
          </div>
          <span className="kpi-badge badge-brand">
            <Icon name="cube" size={24} />
          </span>
        </div>
        <div className="kpi-sub stack" style={{ gap: "0.2rem" }}>
          {lastTxs.length === 0 ? "No transactions yet" : lastTxs.map((h) => <TxLink key={h} hash={h} />)}
        </div>
      </div>
    </div>
  );
}
