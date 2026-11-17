/**
 * Row-level helpers the charts share with the tree and board.
 *
 * Ported from the reference tab (cloudcli-plugin-beads, dist/index.js:
 * readinessOf, markRank, naturalCmp).
 */

import type { ChartRow } from "./types.ts";

export type Readiness = "ready" | "blocked" | "plain";

/** ready / blocked / neither — the three readiness states a row can be in. */
export function readinessOf(row: Pick<ChartRow, "ready" | "blockers" | "status">): Readiness {
  if (row.ready) return "ready";
  if ((row.blockers || []).length && row.status !== "closed") return "blocked";
  return "plain";
}

/** Triage order of the readiness mark: ready, then untouched, then blocked. */
export function markRank(row: Pick<ChartRow, "ready" | "blockers" | "status">): number {
  if (row.ready) return 0;
  if ((row.blockers || []).length && row.status !== "closed") return 2;
  return 1;
}

/** Natural compare, so bd-a1.2 sorts before bd-a1.10. */
export function naturalCmp(a: string, b: string): number {
  const ax = String(a).match(/\d+|\D+/g) || [];
  const bx = String(b).match(/\d+|\D+/g) || [];
  const n = Math.min(ax.length, bx.length);
  for (let i = 0; i < n; i++) {
    const x = ax[i]!;
    const y = bx[i]!;
    const xn = /^\d/.test(x);
    const yn = /^\d/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d) return d;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return ax.length - bx.length;
}
