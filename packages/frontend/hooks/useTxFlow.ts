"use client";

import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAccount, useConfig } from "wagmi";
import { getWalletClient, switchChain } from "wagmi/actions";
import type { Hex, TransactionReceipt } from "viem";
import { publicClient } from "@/lib/client";
import { mstTestnet } from "@/lib/chains";
import { registry } from "@/lib/registry";
import { explainError } from "@/lib/errors";

export type TxState =
  | { stage: "idle" }
  | { stage: "signing"; label: string }
  | { stage: "pending"; label: string; hash: Hex }
  | { stage: "confirmed"; label: string; hash: Hex; blockNumber: bigint; receipt: TransactionReceipt }
  | { stage: "failed"; label: string; hash: Hex; blockNumber: bigint; message: string }
  | { stage: "error"; label: string; message: string };

export type TxRequest = {
  label: string;
  functionName: string;
  args: readonly unknown[];
  /** Explicit gas skips estimation, so a tx that will revert is still sent and mined (§2). */
  gas?: bigint;
};

/**
 * Sends a registry write and tracks it: signing → pending → confirmed (block) or failed (decoded reason).
 * Uses viem's wallet client directly instead of wagmi's writeContract, which simulates first and
 * would refuse to send the demo early-release tx. No optimistic state: the UI only changes on receipt.
 */
export function useTxFlow() {
  const config = useConfig();
  const { chainId, isConnected } = useAccount();
  const queryClient = useQueryClient();
  const [state, setState] = useState<TxState>({ stage: "idle" });

  const send = useCallback(
    async (req: TxRequest): Promise<TxState> => {
      const { label } = req;
      let result: TxState;
      try {
        if (!isConnected) throw new Error("Connect your wallet first.");
        setState({ stage: "signing", label });
        if (chainId !== mstTestnet.id) await switchChain(config, { chainId: mstTestnet.id });
        const wallet = await getWalletClient(config, { chainId: mstTestnet.id });

        const hash = await wallet.writeContract({
          address: registry.address,
          abi: registry.abi,
          functionName: req.functionName,
          args: req.args,
          chain: mstTestnet,
          account: wallet.account,
          ...(req.gas ? { gas: req.gas } : {}),
        } as Parameters<typeof wallet.writeContract>[0]);
        setState({ stage: "pending", label, hash });

        const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 1_500, timeout: 180_000 });
        if (receipt.status === "success") {
          result = { stage: "confirmed", label, hash, blockNumber: receipt.blockNumber, receipt };
        } else {
          result = { stage: "failed", label, hash, blockNumber: receipt.blockNumber, message: await revertReason(hash, receipt) };
        }
      } catch (e) {
        result = { stage: "error", label, message: explainError(e) };
      }
      setState(result);
      queryClient.invalidateQueries();
      return result;
    },
    [config, chainId, isConnected, queryClient]
  );

  const reset = useCallback(() => setState({ stage: "idle" }), []);
  return { state, send, reset, busy: state.stage === "signing" || state.stage === "pending" };
}

/** Replays a mined, reverted tx as eth_call at its block to recover the custom error. */
async function revertReason(hash: Hex, receipt: TransactionReceipt): Promise<string> {
  try {
    const tx = await publicClient.getTransaction({ hash });
    await publicClient.call({ account: tx.from, to: tx.to!, data: tx.input, blockNumber: receipt.blockNumber });
    return "The transaction failed on-chain, but replaying it returned no reason.";
  } catch (e) {
    return explainError(e, { mined: true });
  }
}
