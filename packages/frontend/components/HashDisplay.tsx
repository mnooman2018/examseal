"use client";

import { useState } from "react";
import { shortHex } from "@/lib/format";

/** `0x1234…abcd` with a copy button. Full value in the tooltip. */
export function HashDisplay({ value, full = false }: { value: string; full?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked; the value is still selectable */
    }
  }
  return (
    <span className="hash">
      <span className={`mono ${full ? "break" : ""}`} title={value}>
        {full ? value : shortHex(value, 6, 4)}
      </span>
      <button type="button" className="btn-mini" onClick={copy} aria-label="Copy value">
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
