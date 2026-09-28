"use client";

import { useEffect, useState } from "react";
import { publicClient } from "@/lib/client";
import { fetchCustodyEvents, type CustodyEvent } from "@/lib/logs";
import { POLL_MS } from "@/lib/registry";

export type TimelineEntry = CustodyEvent & { timestamp: number };

/**
 * Chain-of-custody events for one exam, scanned incrementally from `createdBlock`
 * (stored in the contract) up to the latest block, then polled every 3 s for new blocks.
 * Fully rebuilt from the chain on page load.
 */
export function useCustodyEvents(examId: bigint | undefined, createdBlock: bigint | undefined) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setEntries([]);
    setError(null);
    setLoading(true);
    if (examId === undefined || createdBlock === undefined) return;

    let cancelled = false;
    let nextFrom = createdBlock;
    const blockTimes = new Map<bigint, number>();

    async function scan() {
      try {
        const latest = await publicClient.getBlockNumber({ cacheTime: 0 });
        if (latest < nextFrom) return;
        const found = await fetchCustodyEvents(examId!, nextFrom, latest);
        const missing = Array.from(new Set(found.map((e) => e.blockNumber))).filter((b) => !blockTimes.has(b));
        const blocks = await Promise.all(missing.map((b) => publicClient.getBlock({ blockNumber: b })));
        blocks.forEach((b) => blockTimes.set(b.number, Number(b.timestamp)));
        if (cancelled) return;
        nextFrom = latest + 1n;
        if (found.length > 0) {
          const withTime = found.map((e) => ({ ...e, timestamp: blockTimes.get(e.blockNumber) ?? 0 }));
          setEntries((prev) => {
            const seen = new Set(prev.map((p) => p.key));
            return [...prev, ...withTime.filter((w) => !seen.has(w.key))].sort((a, b) =>
              a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1
            );
          });
        }
        setError(null);
      } catch (e) {
        if (!cancelled) setError(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    let timer: ReturnType<typeof setTimeout>;
    const loop = async () => {
      await scan();
      if (!cancelled) timer = setTimeout(loop, POLL_MS);
    };
    loop();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [examId, createdBlock]);

  return { entries, error, loading };
}
