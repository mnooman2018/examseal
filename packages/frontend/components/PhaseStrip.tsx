import type { Phase, PhaseDisplay } from "@/hooks/useExam";

const PHASES: Phase[] = ["Sealed", "Awaiting release", "Released", "Compromised"];
const TONE: Record<Phase, string> = {
  Sealed: "neutral",
  "Awaiting release": "pending",
  Released: "ok",
  Compromised: "bad",
};

/**
 * Sealed → Awaiting release → Released → Compromised, with the current phase lit.
 * `display` sets the text of the current phase step (see phaseDisplay in hooks/useExam).
 */
export function PhaseStrip({ phase, display }: { phase: Phase; display?: PhaseDisplay }) {
  const current = PHASES.indexOf(phase);
  return (
    <ol className="phase-strip" aria-label="Exam phase">
      {PHASES.map((p, i) => (
        <li
          key={p}
          className={`phase phase-${TONE[p]} ${i === current ? "phase-current" : ""} ${i < current ? "phase-past" : ""}`}
          aria-current={i === current ? "step" : undefined}
        >
          <span>{(i === current && display ? display.label : p).toUpperCase()}</span>
          {i === current && display?.detail && <span className="phase-detail">{display.detail}</span>}
        </li>
      ))}
    </ol>
  );
}
