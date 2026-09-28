import { deployments } from "examseal-shared";
import { mstTestnet } from "./chains";

// ExamSealRegistry is deployed on MST Testnet only. Address + ABI are auto-written by
// `pnpm deploy:testnet` into examseal-shared; never hand-edit them.
export const registry = {
  address: deployments.testnet.ExamSealRegistry.address as `0x${string}`,
  abi: deployments.testnet.ExamSealRegistry.abi,
  chain: mstTestnet,
} as const;

export const EXPLORER_URL = mstTestnet.blockExplorers.default.url;

export const explorerTx = (hash: string) => `${EXPLORER_URL}/tx/${hash}`;
export const explorerAddress = (addr: string) => `${EXPLORER_URL}/address/${addr}`;
export const explorerBlock = (n: bigint | number) => `${EXPLORER_URL}/block/${n}`;

/** CentreStatus enum order from the frozen §6 interface. */
export const CENTRE_STATUS = ["None", "Sealed", "Released", "Compromised"] as const;
export type CentreStatusName = (typeof CENTRE_STATUS)[number];

/** ShareSkipped reason codes from §6. */
export const SKIP_REASONS: Record<number, string> = {
  1: "centre compromised",
  2: "already released by you",
  3: "unknown centre",
  4: "bad piece length",
};

/** Explicit gas for the "Attempt early release (demo)" tx, so the wallet sends it and it is mined as failed (§2). */
export const EARLY_RELEASE_GAS = 500_000n;

export const POLL_MS = 3_000;
