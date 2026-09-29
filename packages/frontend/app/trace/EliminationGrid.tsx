"use client";

// D12: elimination grid. Purely a display of the matcher's existing scores: every centre starts lit;
// centres fade out from the lowest score up until only the attributed centre is left (MATCH), or the
// top two are left (INCONCLUSIVE). Numbers shown are the matched/observed counts; no percentages.

import { useEffect, useMemo, useState } from "react";
import type { CentreScore, Decision } from "examseal-core";
import styles from "./trace.module.css";

const STEP_MS = 140;
const pad = (n: number) => String(n).padStart(2, "0");

export function EliminationGrid({ scores, decision, seat }: { scores: CentreScore[]; decision: Decision; seat?: number }) {
  // Tiles stay in centre order; elimination goes from the lowest score up (ties: higher centre id first).
  const tiles = useMemo(() => [...scores].sort((a, b) => a.centreId - b.centreId), [scores]);
  const eliminationOrder = useMemo(
    () => [...scores].sort((a, b) => a.matched - b.matched || b.centreId - a.centreId).map((s) => s.centreId),
    [scores],
  );
  const keep = decision.kind === "MATCH" ? 1 : decision.kind === "INCONCLUSIVE" ? Math.min(2, scores.length) : 0;
  const toEliminate = eliminationOrder.slice(0, Math.max(0, eliminationOrder.length - keep));

  const [run, setRun] = useState(0);
  const [out, setOut] = useState(0);
  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setOut(toEliminate.length);
      return;
    }
    setOut(0);
    let n = 0;
    const t = setInterval(() => {
      n++;
      setOut(n);
      if (n >= toEliminate.length) clearInterval(t);
    }, STEP_MS);
    return () => clearInterval(t);
  }, [run, toEliminate.length]);

  const gone = new Set(toEliminate.slice(0, out));
  const done = out >= toEliminate.length;
  const best = decision.best;

  return (
    <section className="panel stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 style={{ margin: 0 }}>Elimination</h2>
        <button type="button" className="btn-mini" onClick={() => setRun((r) => r + 1)}>
          Replay
        </button>
      </div>
      <div className={styles.elimGrid} role="img" aria-label={`${scores.length} centres compared; ${decision.reason}`}>
        {tiles.map((s) => {
          const isWinner = done && decision.kind === "MATCH" && s.centreId === decision.centreId;
          const isFinalist = done && decision.kind === "INCONCLUSIVE" && !gone.has(s.centreId);
          return (
            <div
              key={s.centreId}
              className={`${styles.elimTile} ${gone.has(s.centreId) ? styles.elimOut : ""} ${isWinner ? styles.elimWinner : ""} ${isFinalist ? styles.elimFinalist : ""}`}
            >
              <span className={styles.elimId}>{pad(s.centreId)}</span>
              <span className={styles.elimScore}>
                {s.matched}/{s.observed}
              </span>
            </div>
          );
        })}
      </div>
      <div className={styles.elimVerdict} aria-live="polite">
        {!done ? (
          <span className="muted">Comparing {scores.length} centres…</span>
        ) : decision.kind === "MATCH" && best ? (
          <span className={styles.elimMatch}>
            CENTRE {pad(decision.centreId!)}
            {seat !== undefined ? ` · SEAT ${seat}` : ""} · {best.matched} / {best.observed}
          </span>
        ) : decision.kind === "INCONCLUSIVE" ? (
          <span className={styles.elimOther}>NOT ATTRIBUTED · top two still in range</span>
        ) : (
          <span className={styles.elimOther}>NOT THIS EXAM</span>
        )}
      </div>
    </section>
  );
}
