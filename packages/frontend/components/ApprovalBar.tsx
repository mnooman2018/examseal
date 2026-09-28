import type { Centre } from "@/hooks/useExam";

/**
 * Approval segments x/N with a threshold marker. Filled segments are amber below the threshold,
 * green once the centre is Released, and red if it is Compromised. Colour comes from chain status only.
 */
export function ApprovalBar({ centre, total, threshold }: { centre: Centre; total: number; threshold: number }) {
  const tone = centre.status === "Compromised" ? "bad" : centre.status === "Released" ? "ok" : "pending";
  return (
    <div className="tile-bar" aria-label={`${centre.approvals} of ${total} approvals, threshold ${threshold}`}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          className={`seg ${i < centre.approvals ? `seg-on seg-${tone}` : ""} ${i === threshold - 1 ? "seg-threshold" : ""}`}
        />
      ))}
    </div>
  );
}
