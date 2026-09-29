import { decodeEventLog, numberToHex, pad, toEventSelector, type AbiEvent, type Hex, type Log } from "viem";
import { publicClient } from "./client";
import { registry } from "./registry";

const CHUNK = 2_000n; // never query huge ranges (CLAUDE.md §2)

const events = registry.abi.filter((x): x is Extract<(typeof registry.abi)[number], { type: "event" }> => x.type === "event");
const selectorOf = (name: string) => {
  const ev = events.find((e) => e.name === name);
  if (!ev) throw new Error(`Event ${name} not in ABI`);
  return toEventSelector(ev as AbiEvent);
};

export const topicUint = (v: bigint | number) => pad(numberToHex(v), { size: 32 });

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw last;
}

async function rawLogs(fromBlock: bigint, toBlock: bigint, topics: (Hex | Hex[] | null)[]): Promise<Log[]> {
  return withRetry(() =>
    publicClient.request({
      method: "eth_getLogs",
      params: [{ address: registry.address, fromBlock: numberToHex(fromBlock), toBlock: numberToHex(toBlock), topics }],
    })
  ) as unknown as Promise<Log[]>;
}

/** Events shown on the chain-of-custody timeline. EncryptedVariantPublished is excluded (large ciphertext). */
export const TIMELINE_EVENTS = [
  "ExamCreated",
  "CentreRegistered",
  "ShareReleased",
  "ShareSkipped",
  "ReleaseAuthorized",
  "LeakRecorded",
  "CentreRevoked",
  "FingerprintRevealed",
] as const;
export type TimelineEventName = (typeof TIMELINE_EVENTS)[number];

export type CustodyEvent = {
  key: string;
  name: TimelineEventName;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
  txHash: Hex;
};

/** Fetches this exam's timeline events in [fromBlock, toBlock], in 2,000-block chunks with retry. */
export async function fetchCustodyEvents(examId: bigint, fromBlock: bigint, toBlock: bigint): Promise<CustodyEvent[]> {
  const topic0 = TIMELINE_EVENTS.map(selectorOf);
  const out: CustodyEvent[] = [];
  for (let from = fromBlock; from <= toBlock; from += CHUNK) {
    const to = from + CHUNK - 1n < toBlock ? from + CHUNK - 1n : toBlock;
    const logs = await rawLogs(from, to, [topic0, topicUint(examId)]);
    for (const log of logs) {
      const d = decodeEventLog({ abi: registry.abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      out.push({
        key: `${log.transactionHash}-${Number(log.logIndex)}`,
        name: d.eventName as TimelineEventName,
        args: (d.args ?? {}) as Record<string, unknown>,
        blockNumber: BigInt(log.blockNumber!),
        logIndex: Number(log.logIndex),
        txHash: log.transactionHash!,
      });
    }
  }
  return out;
}

/** Single-block query for one centre's ciphertext at its registeredBlock (§11 /centre). */
export async function fetchCiphertext(examId: bigint, centreId: number, registeredBlock: bigint): Promise<Hex> {
  const logs = await rawLogs(registeredBlock, registeredBlock, [
    selectorOf("EncryptedVariantPublished"),
    topicUint(examId),
    topicUint(centreId),
  ]);
  if (logs.length === 0) throw new Error(`No encrypted copy found for this centre in block ${registeredBlock}.`);
  const d = decodeEventLog({ abi: registry.abi, data: logs[0].data, topics: logs[0].topics as [Hex, ...Hex[]] });
  return (d.args as { ciphertext: Hex }).ciphertext;
}

export type RegistryEvent = CustodyEvent;

/**
 * Named registry events across ALL exams in [fromBlock, toBlock], in 2,000-block chunks with retry
 * (no exam topic filter). Used by /radar for LeakRecorded and CentreRevoked.
 */
export async function fetchRegistryEvents(names: readonly TimelineEventName[], fromBlock: bigint, toBlock: bigint): Promise<RegistryEvent[]> {
  const topic0 = names.map(selectorOf);
  const out: RegistryEvent[] = [];
  for (let from = fromBlock; from <= toBlock; from += CHUNK) {
    const to = from + CHUNK - 1n < toBlock ? from + CHUNK - 1n : toBlock;
    const logs = await rawLogs(from, to, [topic0]);
    for (const log of logs) {
      const d = decodeEventLog({ abi: registry.abi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      out.push({
        key: `${log.transactionHash}-${Number(log.logIndex)}`,
        name: d.eventName as TimelineEventName,
        args: (d.args ?? {}) as Record<string, unknown>,
        blockNumber: BigInt(log.blockNumber!),
        logIndex: Number(log.logIndex),
        txHash: log.transactionHash!,
      });
    }
  }
  return out;
}
