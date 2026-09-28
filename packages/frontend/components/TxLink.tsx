import { explorerAddress, explorerBlock, explorerTx } from "@/lib/registry";
import { shortHex } from "@/lib/format";

/** Link to a real transaction on MSTScan. Only ever pass hashes that came from the chain. */
export function TxLink({ hash, label }: { hash: string; label?: string }) {
  return (
    <a className="mono link" href={explorerTx(hash)} target="_blank" rel="noreferrer" title={hash}>
      {label ?? shortHex(hash, 8, 6)} ↗
    </a>
  );
}

export function AddressLink({ address, label }: { address: string; label?: string }) {
  return (
    <a className="mono link" href={explorerAddress(address)} target="_blank" rel="noreferrer" title={address}>
      {label ?? shortHex(address)} ↗
    </a>
  );
}

export function BlockLink({ block }: { block: bigint | number }) {
  return (
    <a className="mono link" href={explorerBlock(block)} target="_blank" rel="noreferrer">
      #{String(block)}
    </a>
  );
}
