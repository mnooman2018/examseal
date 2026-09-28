import type { TxState } from "@/hooks/useTxFlow";
import { BlockLink, TxLink } from "./TxLink";

/** pending → confirmed (block number) → explorer link. No optimistic chain state (§11). */
export function TxStatus({ state, children }: { state: TxState; children?: React.ReactNode }) {
  switch (state.stage) {
    case "idle":
      return null;
    case "signing":
      return (
        <div className="txstatus txstatus-pending">
          <span className="dot" /> {state.label}: waiting for your wallet to sign…
        </div>
      );
    case "pending":
      return (
        <div className="txstatus txstatus-pending">
          <span className="dot" /> {state.label}: sent, waiting for a block… <TxLink hash={state.hash} />
        </div>
      );
    case "confirmed":
      return (
        <div className="txstatus txstatus-ok">
          <div>
            ✓ {state.label}: confirmed in block <BlockLink block={state.blockNumber} />. <TxLink hash={state.hash} label="View on MSTScan" />
          </div>
          {children}
        </div>
      );
    case "failed":
      return (
        <div className="txstatus txstatus-bad">
          <div>
            ✗ {state.label}: mined in block <BlockLink block={state.blockNumber} /> as FAILED.{" "}
            <TxLink hash={state.hash} label="View failed tx on MSTScan" />
          </div>
          <div>{state.message}</div>
        </div>
      );
    case "error":
      return (
        <div className="txstatus txstatus-bad">
          ✗ {state.label}: {state.message}
        </div>
      );
  }
}
