import type { TimelineEntry } from "@/hooks/useCustodyEvents";
import { formatClock } from "@/lib/format";

// D12: step chart of approvals over chain time, plain SVG (no chart library). Every point is an
// on-chain event: ShareReleased (cumulative approvals) and ReleaseAuthorized (cumulative centres unlocked).

const W = 420;
const H = 250;
const PAD = { l: 40, r: 10, t: 22, b: 30 };
const FONT = 13;

function stepPath(points: { t: number; v: number }[], x: (t: number) => number, y: (v: number) => number, tEnd: number): string {
  if (points.length === 0) return "";
  let d = `M ${x(points[0].t)} ${y(0)} V ${y(points[0].v)}`;
  for (let i = 1; i < points.length; i++) d += ` H ${x(points[i].t)} V ${y(points[i].v)}`;
  return `${d} H ${x(tEnd)}`;
}

export function ApprovalsChart({
  entries,
  releaseTime,
  now,
  totalShares,
}: {
  entries: TimelineEntry[];
  releaseTime: number;
  now: number | undefined;
  totalShares: number;
}) {
  const released = entries.filter((e) => e.name === "ShareReleased");
  const authorized = entries.filter((e) => e.name === "ReleaseAuthorized");
  const approvals = released.map((e, i) => ({ t: e.timestamp, v: i + 1 }));
  const unlocked = authorized.map((e, i) => ({ t: e.timestamp, v: i + 1 }));

  const created = entries.find((e) => e.name === "ExamCreated")?.timestamp;
  const t0 = Math.min(created ?? releaseTime, releaseTime, ...approvals.map((p) => p.t));
  // End shortly after the last event (not at "now"), so the steps stay readable hours later.
  const lastT = Math.max(releaseTime, ...approvals.map((p) => p.t), ...unlocked.map((p) => p.t), now !== undefined && approvals.length === 0 ? now : 0);
  const tEnd = lastT + Math.max(60, Math.round((lastT - Math.min(created ?? releaseTime, releaseTime)) * 0.12));
  const vMax = Math.max(5, approvals.length, Math.ceil(approvals.length / 5) * 5);
  const x = (t: number) => PAD.l + ((t - t0) / (tEnd - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / vMax) * (H - PAD.t - PAD.b);
  const ticks = [0, Math.round(vMax / 2), vMax];

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Approvals over time: ${approvals.length} of ${totalShares} pieces released`}>
        <defs>
          <linearGradient id="approvalsFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff3355" stopOpacity="0.45" />
            <stop offset="1" stopColor="#ff3355" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={PAD.l + f * (W - PAD.l - PAD.r)} x2={PAD.l + f * (W - PAD.l - PAD.r)} y1={PAD.t} y2={H - PAD.b} stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        ))}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize={FONT} fill="var(--ink-soft)" fontFamily="var(--mono)">
              {v}
            </text>
          </g>
        ))}
        <line x1={x(releaseTime)} x2={x(releaseTime)} y1={PAD.t} y2={H - PAD.b} stroke="var(--amber)" strokeWidth="1" strokeDasharray="4 4" />
        <text x={x(releaseTime) + 5} y={PAD.t + 10} fontSize={FONT} fill="var(--amber)" fontFamily="var(--mono)">
          release {formatClock(releaseTime)}
        </text>
        {approvals.length > 0 && <path d={`${stepPath(approvals, x, y, tEnd)} V ${y(0)} H ${x(approvals[0].t)} Z`} fill="url(#approvalsFill)" stroke="none" />}
        {approvals.length > 0 && <path d={stepPath(approvals, x, y, tEnd)} fill="none" stroke="#ff3355" strokeWidth="2.2" strokeLinejoin="round" />}
        {unlocked.length > 0 && <path d={stepPath(unlocked, x, y, tEnd)} fill="none" stroke="var(--green)" strokeWidth="1.5" strokeDasharray="5 4" />}
        <text x={PAD.l} y={H - 8} fontSize={FONT} fill="var(--ink-soft)" fontFamily="var(--mono)">
          {formatClock(t0)}
        </text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end" fontSize={FONT} fill="var(--ink-soft)" fontFamily="var(--mono)">
          {formatClock(tEnd)}
        </text>
        {approvals.length === 0 && (
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize={FONT + 1} fill="var(--ink-soft)" fontFamily="var(--sans)">
            No pieces released yet
          </text>
        )}
      </svg>
      <div className="row small muted" style={{ gap: "1.2rem" }}>
        <span>
          <span style={{ display: "inline-block", width: 14, height: 2, background: "#ff3355", verticalAlign: "middle" }} /> pieces released{" "}
          <span className="mono">
            {approvals.length}/{totalShares}
          </span>
        </span>
        <span>
          <span style={{ display: "inline-block", width: 14, height: 2, background: "var(--green)", verticalAlign: "middle" }} /> centres unlocked{" "}
          <span className="mono">{unlocked.length}</span>
        </span>
      </div>
    </div>
  );
}
