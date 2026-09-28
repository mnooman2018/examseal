import { createPublicClient, http } from "viem";
import { mstTestnet } from "./chains";

/**
 * Browser-safe public client. All reads go through the same-origin proxy because the
 * MST Testnet RPC sends no CORS headers (CLAUDE.md §2). JSON-RPC batching is on because
 * there is no Multicall3 on MST Testnet; the RPC accepts batched requests.
 */
export const publicClient = createPublicClient({
  chain: mstTestnet,
  transport: http("/api/rpc/testnet", { batch: { batchSize: 50, wait: 16 }, retryCount: 2 }),
});
