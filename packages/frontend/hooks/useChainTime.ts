"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { publicClient } from "@/lib/client";
import { POLL_MS } from "@/lib/registry";

/**
 * Chain time, not laptop time (CLAUDE.md §2). Polls the latest block every 3 s.
 * Between polls, `now` advances by elapsed monotonic time since that block was fetched,
 * so a countdown ticks smoothly while staying anchored to the chain's clock.
 */
export function useChainTime() {
  const q = useQuery({
    queryKey: ["latestBlock"],
    queryFn: async () => {
      const b = await publicClient.getBlock({ blockTag: "latest" });
      return { number: b.number, timestamp: Number(b.timestamp), fetchedAt: performance.now() };
    },
    refetchInterval: POLL_MS,
  });

  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const block = q.data;
  const now = block ? block.timestamp + Math.floor((performance.now() - block.fetchedAt) / 1000) : undefined;
  return { now, blockNumber: block?.number, blockTimestamp: block?.timestamp, error: q.error, isLoading: q.isLoading };
}
