/**
 * Where the charts meet the tree's filters: a breakdown bar that stands for
 * one filter value turns it on (or off again), through the same Filters the
 * filter panel and the chips use (reference bucketFilterOn /
 * toggleBucketFilter) — so a filter set from a chart is undone from the chip
 * beside it. And the check that tells a stale backend from an honest gap
 * (reference rowsCarry).
 */

import type { Filters } from "../tree.ts";
import type { BucketFilter } from "./cuts.ts";

/** Is that bar's filter on now? */
export function bucketFilterOn(f: Filters, target: BucketFilter): boolean {
  if ("one" in target) return f.assignee === target.value;
  if (target.set === "priorities") return f.priorities.indexOf(target.value) >= 0;
  if (target.set === "readiness") return (f.readiness as string[]).indexOf(target.value) >= 0;
  return f[target.set].indexOf(target.value) >= 0;
}

const flip = <T>(list: readonly T[], v: T): T[] => (list.indexOf(v) >= 0 ? list.filter((x) => x !== v) : list.concat([v]));

/** The filters with that bar's filter turned on, or off when it was on. A new object; `f` is untouched. */
export function toggleBucketFilter(f: Filters, target: BucketFilter): Filters {
  if ("one" in target) return { ...f, assignee: f.assignee === target.value ? null : target.value };
  switch (target.set) {
    case "priorities":
      return { ...f, priorities: flip(f.priorities, target.value) };
    case "readiness":
      if (target.value !== "ready" && target.value !== "blocked") return f;
      return { ...f, readiness: flip(f.readiness, target.value) };
    case "statuses":
      return { ...f, statuses: flip(f.statuses, target.value) };
    case "types":
      return { ...f, types: flip(f.types, target.value) };
    case "labels":
      return { ...f, labels: flip(f.labels, target.value) };
  }
}

/**
 * Whether the rows carry a field at all. A field missing from every row
 * means a backend older than the panel (it never sends it), not issues that
 * all happen to lack it — which the empty states have to tell apart.
 */
export function rowsCarry(rows: readonly object[], field: string): boolean {
  for (const row of rows) if (field in row) return true;
  return false;
}
