"use client";

import { formatClock, formatDuration } from "@/lib/format";

/**
 * Countdown against CHAIN time (from useChainTime), never the laptop clock.
 * Shows "opens in 2m 05s" before the target and "opened at 10:00:00" after.
 */
export function ChainCountdown({
  target,
  now,
  before,
  after,
  large = false,
}: {
  target: number;
  now: number | undefined;
  before: string;
  after: string;
  large?: boolean;
}) {
  if (now === undefined) return <span className="muted">Reading chain time…</span>;
  const remaining = target - now;
  const done = remaining <= 0;
  return (
    <div className={`countdown ${large ? "countdown-large" : ""} ${done ? "countdown-done" : "countdown-pending"}`}>
      <span className="countdown-label">{done ? after : before}</span>
      <span className="countdown-value mono">{done ? formatClock(target) : formatDuration(remaining)}</span>
      <span className="countdown-sub muted">
        {done ? "chain time" : `at ${formatClock(target)} chain time`}
      </span>
    </div>
  );
}
