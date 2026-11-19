/**
 * What lets beads.tree answer with a delta instead of every row.
 *
 * A revision is a hash of the files (project.ts revisionOf): it says "this
 * changed" but not what, and two revisions have no order. So a delta can only
 * be computed from a revision whose rows the server still remembers — not the
 * rows themselves, a short hash of each. Per project, a ring of the last
 * `keep` revisions handed to a client (and the disk copy a restarted process
 * read back), each a map id → row hash. Memory: keep × issues small strings.
 *
 * Nothing here logs: ids and hashes only travel in the reply.
 */

import { createHash } from "node:crypto";
import type { Mode, TreeRow } from "../../shared/types.ts";
import type { Issue } from "./issues.ts";
import { treeRow } from "./card.ts";

/**
 * `keep`: revisions remembered per project. A delta larger than
 * max(`minRows`, `share` × issues) is answered in full: past that the rows
 * the client holds are mostly stale anyway, and a full answer is simpler to
 * apply.
 */
export const historyTuning = { keep: 8, minRows: 50, share: 0.2 };

export type RowHashes = Map<string, string>;

export interface Rows {
  rows: TreeRow[];
  hashes: RowHashes;
}

/** What delta() hands back: rows changed or added since `base`, ids gone since. */
export interface Delta {
  upsert: TreeRow[];
  removed: string[];
}

interface Remembered {
  revision: string;
  mode: Mode;
  /** null: the revision was seen with two different row sets — never a base. */
  hashes: RowHashes | null;
}

/** beadsDir → newest first. */
const rings = new Map<string, Remembered[]>();

/**
 * Rows and their hashes, computed once per issue set. Keyed by the issues
 * array, which a stale copy of a snapshot shares with the original.
 */
const projected = new WeakMap<readonly Issue[], Rows>();

export function rowHash(row: TreeRow): string {
  return createHash("sha1").update(JSON.stringify(row)).digest("base64").slice(0, 12);
}

/** The tree rows of an issue set, with a hash per row (memoised). */
export function rowsOf(issues: readonly Issue[]): Rows {
  let out = projected.get(issues);
  if (!out) {
    const rows = issues.map(treeRow);
    const hashes: RowHashes = new Map();
    for (const row of rows) hashes.set(row.id, rowHash(row));
    out = { rows, hashes };
    projected.set(issues, out);
  }
  return out;
}

function sameHashes(a: RowHashes, b: RowHashes): boolean {
  if (a === b) return true;
  if (a.size !== b.size) return false;
  for (const [id, h] of a) if (b.get(id) !== h) return false;
  return true;
}

/**
 * The client now holds `revision` with these rows: remember them as a base.
 * Seen again with the same rows — moves to the front. Seen with different
 * rows (a revision is a file marker, not a content hash) — it can no longer
 * tell which set a client holds, so it stops being a base.
 */
export function remember(beadsDir: string, revision: string, mode: Mode, issues: readonly Issue[]): void {
  const { hashes } = rowsOf(issues);
  const ring = rings.get(beadsDir) ?? [];
  const at = ring.findIndex((r) => r.revision === revision);
  let entry: Remembered = { revision, mode, hashes };
  if (at >= 0) {
    const old = ring[at]!;
    ring.splice(at, 1);
    if (!old.hashes || old.mode !== mode || !sameHashes(old.hashes, hashes)) entry = { revision, mode, hashes: null };
  }
  ring.unshift(entry);
  if (ring.length > historyTuning.keep) ring.length = historyTuning.keep;
  rings.set(beadsDir, ring);
}

/** The most rows a delta may carry for a project of `total` issues. */
export function deltaLimit(total: number): number {
  return Math.max(historyTuning.minRows, Math.floor(historyTuning.share * total));
}

/**
 * Pure: what changed from `base` to `next`, or null if more than `limit`
 * rows did. Rows come in `next`'s order; removed ids in `base`'s.
 */
export function diffRows(base: RowHashes, next: Rows, limit: number): Delta | null {
  const upsert: TreeRow[] = [];
  const removed: string[] = [];
  for (const row of next.rows) {
    if (base.get(row.id) !== next.hashes.get(row.id)) {
      upsert.push(row);
      if (upsert.length > limit) return null;
    }
  }
  for (const id of base.keys()) {
    if (!next.hashes.has(id)) {
      removed.push(id);
      if (upsert.length + removed.length > limit) return null;
    }
  }
  return upsert.length + removed.length > limit ? null : { upsert, removed };
}

/**
 * The delta from `base` to these issues, or null — the base is not
 * remembered (or ambiguous), the mode changed, or the gap is too big.
 */
export function deltaFrom(beadsDir: string, base: string, mode: Mode, issues: readonly Issue[]): Delta | null {
  const known = rings.get(beadsDir)?.find((r) => r.revision === base);
  if (!known || !known.hashes || known.mode !== mode) return null;
  return diffRows(known.hashes, rowsOf(issues), deltaLimit(issues.length));
}

/** Revisions remembered for a project, newest first (tests). */
export function rememberedOf(beadsDir: string): string[] {
  return (rings.get(beadsDir) ?? []).map((r) => r.revision);
}

export function forgetHistory(beadsDir: string): void {
  rings.delete(beadsDir);
}

export function clearHistory(): void {
  rings.clear();
}
