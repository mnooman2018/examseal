/** Formats a chain timestamp (unix seconds) as a local wall-clock time, e.g. 10:00:00. */
export function formatClock(ts: bigint | number): string {
  return new Date(Number(ts) * 1000).toLocaleTimeString("en-GB", { hour12: false });
}

export function formatDateTime(ts: bigint | number): string {
  return new Date(Number(ts) * 1000).toLocaleString("en-GB", { hour12: false });
}

/** Seconds → "1h 02m 05s" / "2m 05s" / "5s". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  if (h > 0) return `${h}h ${pad(m)}m ${pad(sec)}s`;
  if (m > 0) return `${m}m ${pad(sec)}s`;
  return `${sec}s`;
}

export function shortHex(h: string, head = 6, tail = 4): string {
  if (h.length <= head + tail + 2) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export const centreLabel = (id: number | bigint) => `Centre ${String(id).padStart(2, "0")}`;
