"use client";

import type { Address } from "viem";
import { useCustodyEvents, type TimelineEntry } from "@/hooks/useCustodyEvents";
import type { Exam } from "@/hooks/useExam";
import { centreLabel, formatClock, formatDateTime, shortHex } from "@/lib/format";
import { SKIP_REASONS } from "@/lib/registry";
import { BlockLink, TxLink } from "./TxLink";
import { ErrorBanner } from "./ErrorBanner";

type Group = { key: string; name: TimelineEntry["name"]; items: TimelineEntry[] };

/** Groups consecutive events of the same kind from the same transaction (e.g. 20 CentreRegistered in one tx). */
function group(entries: TimelineEntry[]): Group[] {
  const out: Group[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last && last.name === e.name && last.items[0].txHash === e.txHash) last.items.push(e);
    else out.push({ key: e.key, name: e.name, items: [e] });
  }
  return out;
}

const centreList = (items: TimelineEntry[]) => {
  const ids = items.map((i) => Number(i.args.centreId));
  return ids.length <= 6 ? ids.map((id) => centreLabel(id)).join(", ") : `${ids.length} centres`;
};

function custodianName(exam: Exam, addr: unknown) {
  const a = String(addr).toLowerCase();
  const i = exam.custodians.findIndex((c: Address) => c.toLowerCase() === a);
  return i >= 0 ? `Custodian ${i + 1}` : `Wallet ${shortHex(String(addr))}`;
}

function describe(g: Group, exam: Exam): { text: string; tone: "neutral" | "ok" | "bad" | "pending" } {
  const a = g.items[0].args;
  switch (g.name) {
    case "ExamCreated":
      return {
        text: `Exam created by the authority: threshold ${a.threshold} of ${(a.custodians as unknown[]).length} custodians, release at ${formatClock(a.releaseTime as bigint)}, fingerprints revealable from ${formatClock(a.revealTime as bigint)} (chain time).`,
        tone: "neutral",
      };
    case "CentreRegistered":
      return { text: `Sealed and published encrypted copies for ${centreList(g.items)}.`, tone: "neutral" };
    case "ShareReleased": {
      const who = custodianName(exam, a.custodian);
      if (g.items.length === 1)
        return { text: `${who} released a key piece for ${centreLabel(Number(a.centreId))} (approvals ${a.approvals}/${exam.custodians.length}).`, tone: "pending" };
      return { text: `${who} released key pieces for ${centreList(g.items)}.`, tone: "pending" };
    }
    case "ShareSkipped": {
      const reasons = Array.from(new Set(g.items.map((i) => SKIP_REASONS[Number(i.args.reason)] ?? `reason ${i.args.reason}`)));
      return { text: `${custodianName(exam, a.custodian)}: piece skipped by the contract for ${centreList(g.items)} (${reasons.join(", ")}).`, tone: "neutral" };
    }
    case "ReleaseAuthorized":
      return { text: `RELEASE AUTHORIZED for ${centreList(g.items)}: threshold reached.`, tone: "ok" };
    case "LeakRecorded":
      return {
        text: `Leak evidence recorded against ${centreLabel(Number(a.centreId))}: ${a.matched} of ${a.observed} observed features matched. Evidence hash ${shortHex(String(a.evidenceHash), 10, 6)}.`,
        tone: "bad",
      };
    case "CentreRevoked":
      return { text: `${centreList(g.items)} REVOKED by the authority. Reason hash ${shortHex(String(a.reasonHash), 10, 6)}.`, tone: "bad" };
    case "FingerprintRevealed":
      return { text: `Fingerprint revealed for ${centreList(g.items)}; anyone can now check it against the sealing commitment.`, tone: "neutral" };
  }
}

export type CustodyFeed = ReturnType<typeof useCustodyEvents>;

/** Self-contained timeline: reads its own events. */
export function CustodyTimeline({ exam }: { exam: Exam }) {
  const feed = useCustodyEvents(exam.id, exam.createdBlock);
  return <CustodyTimelineView exam={exam} feed={feed} />;
}

/** Timeline view for a feed the page already reads (so the page can reuse the same events). */
export function CustodyTimelineView({ exam, feed }: { exam: Exam; feed: CustodyFeed }) {
  const { entries, error, loading } = feed;
  const groups = group(entries);

  return (
    <div>
      {error ? <ErrorBanner title="Could not read the timeline from MST Testnet" error={error} /> : null}
      {loading && entries.length === 0 && <p className="muted">Reading events from block {String(exam.createdBlock)}…</p>}
      <ol className="timeline">
        {groups.map((g) => {
          const d = describe(g, exam);
          const first = g.items[0];
          return (
            <li key={g.key} className={`tl-item tl-${d.tone}`}>
              <div className="tl-time mono" title={formatDateTime(first.timestamp)}>
                {formatClock(first.timestamp)}
              </div>
              <div className="tl-body">
                <div className="tl-name mono">{g.name}{g.items.length > 1 ? ` ×${g.items.length}` : ""}</div>
                <div>{d.text}</div>
                <div className="tl-meta muted">
                  Block <BlockLink block={first.blockNumber} /> · <TxLink hash={first.txHash} />
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {!loading && !error && entries.length === 0 && <p className="muted">No events yet.</p>}
    </div>
  );
}
