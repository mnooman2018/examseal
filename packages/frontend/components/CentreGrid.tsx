import type { Centre, Exam } from "@/hooks/useExam";
import { centreLabel } from "@/lib/format";
import { StatusPill } from "./StatusPill";

/** Grid of centre tiles: status + approvals x/N. Tiles take their state colour from chain status only. */
export function CentreGrid({ exam, centres }: { exam: Exam; centres: Centre[] }) {
  if (centres.length === 0) return <p className="muted">No centres registered for this exam.</p>;
  const n = exam.custodians.length;
  return (
    <div className="centre-grid">
      {centres.map((c) => {
        const tone = c.status === "Compromised" ? "bad" : c.status === "Released" ? "ok" : c.approvals > 0 ? "pending" : "neutral";
        return (
          <div key={c.id} className={`tile tile-${tone}`}>
            <div className="tile-name">{centreLabel(c.id)}</div>
            <div className="tile-approvals mono">
              {c.approvals}/{n}
            </div>
            <div className="tile-bar" aria-hidden>
              {Array.from({ length: n }, (_, i) => (
                <span key={i} className={`seg ${i < c.approvals ? "seg-on" : ""} ${i === exam.threshold - 1 ? "seg-threshold" : ""}`} />
              ))}
            </div>
            <StatusPill status={c.status === "Sealed" && c.approvals > 0 ? "Awaiting release" : c.status} />
          </div>
        );
      })}
    </div>
  );
}
