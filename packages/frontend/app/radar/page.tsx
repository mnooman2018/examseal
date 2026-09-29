"use client";

// Leak radar: read-only. LeakRecorded and CentreRevoked across every exam on the registry, plus the
// centre grid of one exam. Every row and tile comes from chain data; nothing is written.

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { parseExamId, useExam, useLatestExamId, type Centre } from "@/hooks/useExam";
import { useChainTime } from "@/hooks/useChainTime";
import { useRadarEvents, type RadarEntry } from "@/hooks/useRadarEvents";
import { ErrorBanner } from "@/components/ErrorBanner";
import { BlockLink, TxLink } from "@/components/TxLink";
import { StatusPill } from "@/components/StatusPill";
import { centreLabel, formatClock, formatDuration } from "@/lib/format";

const FLASH_MS = 3_000;
const FEED_LIMIT = 50;

export default function RadarPage() {
  return (
    <Suspense fallback={<main className="muted">Loading…</main>}>
      <Radar />
    </Suspense>
  );
}

const examOf = (e: RadarEntry) => BigInt(e.args.examId as bigint);
const centreOf = (e: RadarEntry) => Number(e.args.centreId);

function Radar() {
  const search = useSearchParams();
  const router = useRouter();
  const feed = useRadarEvents();
  const chain = useChainTime();
  const latest = useLatestExamId();

  const leaks = feed.entries.filter((e) => e.name === "LeakRecorded");
  const revokes = feed.entries.filter((e) => e.name === "CentreRevoked");
  const latestLeakExam = leaks.length ? leaks.reduce((m, e) => (examOf(e) > m ? examOf(e) : m), 0n) : undefined;
  const requested = parseExamId(search.get("exam"));
  const examId = requested ?? latestLeakExam ?? (latest.data && latest.data > 0n ? latest.data : undefined);

  const revokedCentres = new Set(revokes.map((e) => `${examOf(e)}:${centreOf(e)}`)).size;
  const examsAffected = new Set([...leaks, ...revokes].map((e) => examOf(e).toString())).size;
  const newest = feed.entries.at(-1);

  const chainError = feed.error ?? latest.error ?? chain.error;
  // Until one full scan has succeeded, counts are unknown: never show a 0 the chain did not give us.
  const known = feed.scannedTo !== null;
  const count = (n: number) => (known ? String(n) : feed.loading ? "…" : "n/a");

  return (
    <main>
      <div className="eyebrow">Leak radar · all exams on the registry</div>
      <h1>Leak Radar</h1>
      <p className="muted">
        Leak evidence and centre revocations recorded on MST Testnet, for every exam. Read-only; refreshes every 3 s.
      </p>

      {chainError ? <ErrorBanner title="Cannot reach MST Testnet. Nothing below is being updated" error={chainError} /> : null}
      {feed.noExams && <p className="muted">No exams on the registry yet.</p>}

      <div className="kpi-grid">
        <Kpi label="Leak records" value={count(leaks.length)} tone={leaks.length ? "bad" : undefined} />
        <Kpi label="Centres revoked" value={count(revokedCentres)} tone={revokedCentres ? "bad" : undefined} />
        <Kpi label="Exams affected" value={count(examsAffected)} />
        <Kpi
          label="Latest event"
          value={newest && chain.now !== undefined ? `${formatDuration(Math.max(0, chain.now - newest.timestamp))} ago` : known ? "none" : count(0)}
          sub={feed.scannedTo !== null ? `scanned to block ${feed.scannedTo.toString()}` : undefined}
        />
      </div>

      <>
        <section className="panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Live feed</h2>
            <span className="muted small">newest first · every exam</span>
          </div>
          {!known && feed.entries.length === 0 ? (
            <p className="muted">{feed.loading ? "Scanning the registry in 2,000-block steps…" : "No data: the registry could not be read."}</p>
          ) : (
            <RadarFeed entries={feed.entries} now={chain.now} />
          )}
        </section>

        <section className="panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Centres</h2>
            <ExamSelect
              current={examId}
              latest={latest.data}
              counts={leaks.reduce((m, e) => m.set(examOf(e).toString(), (m.get(examOf(e).toString()) ?? 0) + 1), new Map<string, number>())}
              onPick={(id) => router.push(`/radar?exam=${id}`)}
            />
          </div>
          {examId !== undefined ? <RadarGrid examId={examId} entries={feed.entries} /> : <p className="muted">No exam selected.</p>}
        </section>
      </>
    </main>
  );
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "bad" }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value" style={tone === "bad" ? { color: "var(--red)" } : undefined}>
        {value}
      </span>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

function RadarFeed({ entries, now }: { entries: RadarEntry[]; now: number | undefined }) {
  const rows = [...entries].reverse().slice(0, FEED_LIMIT);
  if (rows.length === 0) return <p className="muted">No leak evidence or revocations on the registry yet.</p>;
  return (
    <div className="table-wrap">
      <table className="events">
        <thead>
          <tr>
            <th>Event</th>
            <th>Exam</th>
            <th>Centre</th>
            <th>Features</th>
            <th>Chain time</th>
            <th>Block</th>
            <th>Tx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const leak = e.name === "LeakRecorded";
            return (
              <tr key={e.key} className={e.live ? "radar-row-new" : undefined}>
                <td>
                  <span className={`ev-pill ev-bad`}>{leak ? "Leak evidence" : "Centre revoked"}</span>
                </td>
                <td>
                  <Link href={`/exam/${examOf(e)}`}>#{examOf(e).toString()}</Link>
                </td>
                <td>{centreLabel(centreOf(e))}</td>
                <td className="mono">{leak ? `${Number(e.args.matched)} of ${Number(e.args.observed)}` : "n/a"}</td>
                <td className="mono">
                  {e.timestamp ? formatClock(e.timestamp) : "…"}
                  <span className="muted small"> {now !== undefined && e.timestamp ? `${formatDuration(Math.max(0, now - e.timestamp))} ago` : ""}</span>
                </td>
                <td>
                  <BlockLink block={e.blockNumber} />
                </td>
                <td>
                  <TxLink hash={e.txHash} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {entries.length > FEED_LIMIT && <p className="muted small">Showing the newest {FEED_LIMIT} of {entries.length} events.</p>}
    </div>
  );
}

function ExamSelect({
  current,
  latest,
  counts,
  onPick,
}: {
  current?: bigint;
  latest?: bigint;
  counts: Map<string, number>;
  onPick: (id: bigint) => void;
}) {
  if (!latest || latest < 1n) return null;
  const ids = Array.from({ length: Number(latest) }, (_, i) => latest - BigInt(i));
  return (
    <select aria-label="Exam" value={current?.toString() ?? ""} onChange={(e) => onPick(BigInt(e.target.value))}>
      {ids.map((id) => {
        const n = counts.get(id.toString()) ?? 0;
        return (
          <option key={id.toString()} value={id.toString()}>
            Exam #{id.toString()}
            {n ? ` (${n} leak record${n === 1 ? "" : "s"})` : ""}
          </option>
        );
      })}
    </select>
  );
}

/** Centre tiles for one exam. A centre with a new LeakRecorded while the page is open flashes red; revoked stays red. */
function RadarGrid({ examId, entries }: { examId: bigint; entries: RadarEntry[] }) {
  const { data, error, isLoading } = useExam(examId);
  const [flashing, setFlashing] = useState<Set<number>>(new Set());
  const handled = useRef(new Set<string>());

  const leakCount = useMemo(() => {
    const m = new Map<number, number>();
    for (const e of entries) if (e.name === "LeakRecorded" && examOf(e) === examId) m.set(centreOf(e), (m.get(centreOf(e)) ?? 0) + 1);
    return m;
  }, [entries, examId]);

  useEffect(() => {
    for (const e of entries) {
      if (!e.live || e.name !== "LeakRecorded" || examOf(e) !== examId || handled.current.has(e.key)) continue;
      handled.current.add(e.key);
      const id = centreOf(e);
      setFlashing((prev) => new Set(prev).add(id));
      setTimeout(
        () =>
          setFlashing((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          }),
        FLASH_MS
      );
    }
  }, [entries, examId]);

  if (error) return <ErrorBanner title={`Could not read exam #${examId}`} error={error} />;
  if (isLoading || !data) return <p className="muted">Reading exam #{examId.toString()} from chain…</p>;
  const n = data.exam.custodians.length;

  return (
    <>
      <p className="muted small">
        <Link href={`/exam/${examId}`}>Exam #{examId.toString()}</Link> · {data.exam.title}
      </p>
      <div className="centre-grid radar-grid">
        {data.centres.map((c: Centre) => {
          const leaksHere = leakCount.get(c.id) ?? 0;
          const tone = c.status === "Compromised" ? "bad" : leaksHere ? "pending" : c.status === "Released" ? "ok" : "neutral";
          return (
            <div key={c.id} className={`tile tile-${tone} ${flashing.has(c.id) ? "radar-flash" : ""}`}>
              <div className="tile-name">{centreLabel(c.id)}</div>
              <div className="small mono">
                {c.approvals}/{n} approvals
              </div>
              <div className="small">{leaksHere ? `${leaksHere} leak record${leaksHere === 1 ? "" : "s"}` : <span className="muted">no leak records</span>}</div>
              <StatusPill status={c.status} />
            </div>
          );
        })}
      </div>
    </>
  );
}
