import type { TimelineEntry } from "@/hooks/useCustodyEvents";
import { centreLabel, formatDuration } from "@/lib/format";
import { BlockLink, TxLink } from "../TxLink";

// D12: newest registry events for this exam, read from the chain by useCustodyEvents (the same scan as
// the chain-of-custody timeline). Every row links to its real transaction on MSTScan.

const LABEL: Record<string, string> = {
  ExamCreated: "Exam created",
  CentreRegistered: "Centre sealed",
  ShareReleased: "Piece released",
  ShareSkipped: "Piece skipped",
  ReleaseAuthorized: "Release authorized",
  LeakRecorded: "Leak evidence",
  CentreRevoked: "Centre revoked",
  FingerprintRevealed: "Fingerprint revealed",
};
const TONE: Record<string, string> = { ReleaseAuthorized: "ev-ok", LeakRecorded: "ev-bad", CentreRevoked: "ev-bad", ShareSkipped: "ev-pending" };

export function EventsTable({ entries, now, limit = 10 }: { entries: TimelineEntry[]; now: number | undefined; limit?: number }) {
  const rows = [...entries].reverse().slice(0, limit);
  if (rows.length === 0) return <p className="muted">No events yet.</p>;
  return (
    <div className="table-wrap">
      <table className="events">
        <thead>
          <tr>
            <th>Event</th>
            <th>Centre</th>
            <th>Block</th>
            <th>When</th>
            <th>Tx</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => {
            const centre = e.args.centreId as number | undefined;
            return (
              <tr key={e.key}>
                <td>
                  <span className={`ev-pill ${TONE[e.name] ?? "ev-neutral"}`}>{LABEL[e.name] ?? e.name}</span>
                </td>
                <td>{centre !== undefined ? centreLabel(centre) : "–"}</td>
                <td>
                  <BlockLink block={e.blockNumber} />
                </td>
                <td className="mono muted">{now !== undefined && e.timestamp ? `${formatDuration(Math.max(0, now - e.timestamp))} ago` : "…"}</td>
                <td>
                  <TxLink hash={e.txHash} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
