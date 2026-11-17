/**
 * The six breakdowns ("cuts") of the filtered issues, and the filter a bar
 * stands for.
 *
 * Ported from the reference tab (cloudcli-plugin-beads, dist/index.js:
 * aggregateCharts with domainCut/rankedCut, and bucketFilter). The reference
 * resolved each bucket's label and colour while counting; here those are the
 * client's business — a bucket carries its key and a `kind`, which is all the
 * client needs to name and paint it (status/type/priority vocabulary, an
 * assignee or tag verbatim, or the "other" / "unassigned" / "no tags" /
 * "unset" wording).
 *
 * Pure: no DOM, no clock. A snapshot of right now, so no period.
 */

import { readinessOf } from "./rows.ts";
import { CHART_TAIL_N, STATUS_ORDER, TYPE_ORDER, type ChartRow } from "./types.ts";

export type CutKey = "assignee" | "status" | "priority" | "readiness" | "type" | "labels";

/** The order the cuts are drawn in. */
export const CUT_ORDER: readonly CutKey[] = ["assignee", "status", "priority", "readiness", "type", "labels"];

export const BUCKET_OTHER = "__other__";
export const BUCKET_EMPTY = "__empty__";
export const BUCKET_UNSET = "__unset__";

/**
 * - value: one real value (a status, a type, "0".."4", an assignee, a tag,
 *   readiness "ready"/"blocked"/"plain");
 * - other: the folded tail of a ranked cut;
 * - empty: rows with no value at all (no assignee, no tags);
 * - unset: a row with no priority.
 */
export type BucketKind = "value" | "other" | "empty" | "unset";

export interface Bucket {
  /** The value as a string (priorities too: "0".."4"), or one of the BUCKET_* keys. */
  key: string;
  kind: BucketKind;
  count: number;
}

export interface Cut {
  key: CutKey;
  /** Always the number of rows passed in, for every cut. */
  total: number;
  buckets: Bucket[];
  /** Only on `labels`: a row with several tags is counted in each, so the buckets sum past `total`. */
  overCounts: boolean;
}

function kindOf(key: string): BucketKind {
  if (key === BUCKET_OTHER) return "other";
  if (key === BUCKET_EMPTY) return "empty";
  if (key === BUCKET_UNSET) return "unset";
  return "value";
}

/**
 * A cut over a fixed domain: known values in their own order, then any value
 * this project uses that the domain does not know, sorted as the reference
 * sorts them (Array#sort default, i.e. by string).
 */
function domainCut<R extends ChartRow>(
  rows: readonly R[], key: CutKey, order: readonly (string | number)[], valueOf: (row: R) => string | number,
): Cut {
  const counts = new Map<string | number, number>();
  for (const row of rows) {
    const v = valueOf(row);
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  const extra: (string | number)[] = [];
  counts.forEach((_, k) => { if (order.indexOf(k) < 0) extra.push(k); });
  extra.sort();
  const buckets: Bucket[] = [];
  for (const k of order.concat(extra)) {
    const count = counts.get(k);
    if (count == null) continue;
    const s = String(k);
    buckets.push({ key: s, kind: kindOf(s), count });
  }
  return { key, total: rows.length, buckets, overCounts: false };
}

/**
 * A cut over open-ended values (assignees, tags): ranked by count descending,
 * ties by name; past CHART_TAIL_N the tail folds into one "other" bucket; rows
 * with no value land in an explicit empty bucket — never dropped.
 */
function rankedCut<R extends ChartRow>(
  rows: readonly R[], key: CutKey, valuesOf: (row: R) => readonly string[],
): Cut {
  const counts = new Map<string, number>();
  let empty = 0;
  for (const row of rows) {
    const values = valuesOf(row);
    if (!values.length) { empty++; continue; }
    for (const v of values) counts.set(v, (counts.get(v) || 0) + 1);
  }
  const named: [string, number][] = [];
  counts.forEach((n, k) => named.push([k, n]));
  named.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const buckets: Bucket[] = named.slice(0, CHART_TAIL_N).map(([k, count]) => ({ key: k, kind: "value", count }));
  const tail = named.slice(CHART_TAIL_N);
  if (tail.length) {
    buckets.push({ key: BUCKET_OTHER, kind: "other", count: tail.reduce((sum, [, c]) => sum + c, 0) });
  }
  if (empty) buckets.push({ key: BUCKET_EMPTY, kind: "empty", count: empty });
  return { key, total: rows.length, buckets, overCounts: false };
}

/**
 * The six breakdowns of exactly the rows the tree and board would show (the
 * caller passes the filtered rows). Every cut's buckets add up to `total`,
 * except `labels`, which says so with `overCounts`.
 */
export function aggregateCuts<R extends ChartRow>(rows: readonly R[]): Cut[] {
  const assignee = rankedCut(rows, "assignee", (row) => (row.assignee ? [row.assignee] : []));
  const status = domainCut(rows, "status", STATUS_ORDER, (row) => row.status);
  // A missing priority goes in an explicit "unset" bucket rather than a stray "Pundefined".
  const priority = domainCut(rows, "priority", [0, 1, 2, 3, 4], (row) => (row.priority == null ? BUCKET_UNSET : row.priority));
  const readiness = domainCut(rows, "readiness", ["ready", "plain", "blocked"], (row) => readinessOf(row));
  const type = domainCut(rows, "type", TYPE_ORDER, (row) => row.issue_type || "task");
  const labels = rankedCut(rows, "labels", (row) => row.labels || []);
  labels.overCounts = true;
  return [assignee, status, priority, readiness, type, labels];
}

/** The filter a bar sets: a value added to/removed from a set filter, or a single-value one. */
export type BucketFilter =
  | { set: "statuses" | "types" | "labels" | "readiness"; value: string }
  | { set: "priorities"; value: number }
  | { one: "assignee"; value: string };

/**
 * The filter one bucket stands for, or null when it stands for a group: the
 * folded tail, the rows with nothing in the field, an unset priority and
 * readiness' middle each cover several values, and no filter says "one of
 * these" — so those bars are not offered as filters at all.
 */
export function bucketFilter(cutKey: CutKey, bucketKey: string): BucketFilter | null {
  if (bucketKey === BUCKET_OTHER || bucketKey === BUCKET_EMPTY || bucketKey === BUCKET_UNSET) return null;
  if (cutKey === "status") return { set: "statuses", value: bucketKey };
  if (cutKey === "type") return { set: "types", value: bucketKey };
  if (cutKey === "priority") return { set: "priorities", value: Number(bucketKey) };
  if (cutKey === "labels") return { set: "labels", value: bucketKey };
  if (cutKey === "readiness") return bucketKey === "plain" ? null : { set: "readiness", value: bucketKey };
  if (cutKey === "assignee") return { one: "assignee", value: bucketKey };
  return null;
}

/** The tallest bucket of a cut, at least 1 — bars are scaled to it, never to the total. */
export function cutMax(cut: Cut): number {
  let max = 1;
  for (const b of cut.buckets) if (b.count > max) max = b.count;
  return max;
}
