"use client";

import { useEffect, useState } from "react";
import { publicClient } from "@/lib/client";
import { fetchRegistryEvents, type RegistryEvent } from "@/lib/logs";
import { POLL_MS, registry } from "@/lib/registry";

export type RadarEntry = RegistryEvent & {
  timestamp: number;
  /** True if the event arrived after the first full scan, i.e. while this page was open. */
  live: boolean;
};

const RADAR_EVENTS = ["LeakRecorded", "CentreRevoked"] as const;

/**
 * LeakRecorded and CentreRevoked across ALL exams, newest last. The scan starts at exam 1's
 * createdBlock (no leak or revoke can be older than the first exam), runs in 2,000-block chunks with
 * retry up to the latest block, then polls only new blocks every 3 s. Rebuilt from the chain on load.
 */
export function useRadarEvents() {
  const [entries, setEntries] = useState<RadarEntry[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [noExams, setNoExams] = useState(false);
  const [scannedTo, setScannedTo] = useState<bigint | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let nextFrom: bigint | null = null;
    let firstScanDone = false;
    const blockTimes = new Map<bigint, number>();

    async function scan() {
      try {
        if (nextFrom === null) {
          const next = await publicClient.readContract({ ...registry, functionName: "nextExamId" });
          if (next <= 1n) {
            if (!cancelled) setNoExams(true);
            return;
          }
          const first = await publicClient.readContract({ ...registry, functionName: "getExam", args: [1n] });
          nextFrom = first.createdBlock;
        }
        const latest = await publicClient.getBlockNumber({ cacheTime: 0 });
        if (latest >= nextFrom) {
          const found = await fetchRegistryEvents(RADAR_EVENTS, nextFrom, latest);
          const missing = Array.from(new Set(found.map((e) => e.blockNumber))).filter((b) => !blockTimes.has(b));
          const blocks = await Promise.all(missing.map((b) => publicClient.getBlock({ blockNumber: b })));
          blocks.forEach((b) => blockTimes.set(b.number, Number(b.timestamp)));
          if (cancelled) return;
          const live = firstScanDone;
          nextFrom = latest + 1n;
          if (found.length > 0) {
            const add = found.map((e) => ({ ...e, timestamp: blockTimes.get(e.blockNumber) ?? 0, live }));
            setEntries((prev) => {
              const seen = new Set(prev.map((p) => p.key));
              return [...prev, ...add.filter((a) => !seen.has(a.key))].sort((a, b) =>
                a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1
              );
            });
          }
          setScannedTo(latest);
        }
        firstScanDone = true;
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    const loop = async () => {
      await scan();
      if (!cancelled) timer = setTimeout(loop, POLL_MS);
    };
    loop();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return { entries, error, loading, noExams, scannedTo };
}
