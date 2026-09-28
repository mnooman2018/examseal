export type PillTone = "neutral" | "pending" | "ok" | "bad" | "info";

const TONE_BY_STATUS: Record<string, PillTone> = {
  Sealed: "neutral",
  None: "neutral",
  "Awaiting release": "pending",
  Pending: "pending",
  Released: "ok",
  Confirmed: "ok",
  Compromised: "bad",
  Failed: "bad",
};

/** One accent per state: amber = pending, green = released, red = compromised (§11). */
export function StatusPill({ status, tone }: { status: string; tone?: PillTone }) {
  const t = tone ?? TONE_BY_STATUS[status] ?? "neutral";
  return <span className={`pill pill-${t}`}>{status.toUpperCase()}</span>;
}
