"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";

/**
 * One "Connect BridgeKey" button. wagmi's EIP-6963 discovery adds a separate BridgeKey connector next to
 * the generic injected() one; we prefer BridgeKey when it announces itself and otherwise fall back to the
 * injected provider (window.ethereum), which is how MetaMask connects.
 */
export function ConnectButton() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();

  if (isConnected && address) {
    return (
      <div className="wallet">
        <span className="wallet-address">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <button onClick={() => disconnect()}>Disconnect</button>
      </div>
    );
  }

  const connector =
    connectors.find((c) => /bridgekey/i.test(c.name) || /bridgekey/i.test(c.id)) ??
    connectors.find((c) => c.id === "injected");

  const noWallet = (error as Error | null)?.name === "ProviderNotFoundError" || /provider not found/i.test(error?.message ?? "");

  return (
    <div className="wallet">
      <button onClick={() => connector && connect({ connector })} disabled={isPending || !connector}>
        {isPending ? "Connecting…" : "Connect BridgeKey"}
      </button>
      {error && (
        <span className="field-error small">
          {noWallet ? "No browser wallet found. Install BridgeKey (or MetaMask as a fallback)." : error.message.split("\n")[0]}
        </span>
      )}
    </div>
  );
}
