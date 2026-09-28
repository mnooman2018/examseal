import type { Phase } from "@/hooks/useExam";

const PHASES: Phase[] = ["Sealed", "Awaiting release", "Released", "Compromised"];
const TONE: Record<Phase, string> = {
  Sealed: "neutral",
  "Awaiting release": "pending",
  Released: "ok",
  Compromised: "bad",
};

/**
 * Sealed → Awaiting release → Released → Compromised, with the current phase lit.
 * `label` overrides the text of the current phase (see phaseLabel in hooks/useExam).
 */
export function PhaseStrip({ phase, label }: { phase: Phase; label?: string }) {
  const current = PHASES.indexOf(phase);
  return (
    <ol className="phase-strip" aria-label="Exam phase">
      {PHASES.map((p, i) => (
        <li
          key={p}
          className={`phase phase-${TONE[p]} ${i === current ? "phase-current" : ""} ${i < current ? "phase-past" : ""}`}
          aria-current={i === current ? "step" : undefined}
        >
          {(i === current && label ? label : p).toUpperCase()}
        </li>
      ))}
    </ol>
  );
}
