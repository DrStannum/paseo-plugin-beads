/**
 * The filter panel, search merge and card width logic of shared/tree.ts:
 * options from the list, chips and their removal, vanished labels, server
 * hits only for the query they answer, the card pane's clamp.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeChips, buildIndex, cardPaneWidth, CARD_MIN_W, filterOptions, flattenTree, hitsFor, NO_FILTERS, pruneLabels,
  removeChip, toggleValue, TREE_MIN_W, visibility, type Filters,
} from "../shared/tree.ts";
import type { TreeRow } from "../shared/types.ts";
// @ts-ignore — plain JS fixture
import { FIXTURE } from "./fixture/data.mjs";

const ROWS = FIXTURE.tree.issues as TreeRow[];
const index = buildIndex(ROWS);

test("filter options count every row; statuses in bd order, types by count, used priorities only", () => {
  const o = filterOptions(ROWS);
  assert.equal(o.statuses.reduce((s, x) => s + x.n, 0), ROWS.length);
  const order = ["open", "in_progress", "blocked", "deferred", "closed"];
  const keys = o.statuses.map((s) => s.key);
  assert.deepEqual(keys, order.filter((s) => keys.includes(s)));
  for (let i = 1; i < o.types.length; i++) assert.ok(o.types[i - 1]!.n >= o.types[i]!.n);
  assert.deepEqual(o.priorities.map((p) => p.key), Array.from(new Set(ROWS.filter((r) => r.priority != null).map((r) => r.priority!))).sort());
  assert.deepEqual(o.labels.map((l) => l.key), Array.from(new Set(ROWS.flatMap((r) => r.labels ?? []))).sort());
  assert.equal(o.readiness.find((r) => r.key === "ready")!.n, ROWS.filter((r) => r.ready).length);
  assert.ok(o.people.every((p, i) => i === 0 || o.people[i - 1]! <= p));
});

test("chips list the active filters and remove one at a time", () => {
  const f: Filters = { ...NO_FILTERS, statuses: ["open"], priorities: [1], labels: ["area:ui"], createdDays: 7, assignee: "alex" };
  const chips = activeChips(f);
  assert.deepEqual(chips.map((c) => c.kind), ["status", "priority", "created", "label", "assignee"]);
  let g = f;
  for (const c of chips) g = removeChip(g, c);
  assert.deepEqual(g, NO_FILTERS);
  assert.deepEqual(toggleValue(toggleValue([1, 2], 3), 1), [2, 3]);
});

test("a label gone from the project leaves the filter; unchanged filters keep their identity", () => {
  const f: Filters = { ...NO_FILTERS, labels: ["area:ui", "gone"] };
  assert.deepEqual(pruneLabels(f, new Set(["area:ui"])).labels, ["area:ui"]);
  const same = { ...NO_FILTERS, labels: ["area:ui"] };
  assert.equal(pruneLabels(same, new Set(["area:ui"])), same);
});

test("server hits join only the query they answer (no flash of the previous query's rows)", () => {
  const hits = { q: "matrix", ids: new Set(["demo-e4"]) };
  assert.equal(hitsFor(hits, " matrix "), hits.ids);
  assert.equal(hitsFor(hits, "matri"), null);
  assert.equal(hitsFor(hits, "m"), null);
  // A hit outside the local match shows; once the query moves on it does not.
  const target = ROWS.find((r) => r.status !== "closed" && !`${r.id}\n${r.title}\n${(r.labels ?? []).join(" ")}`.toLowerCase().includes("zzqq"))!;
  const fake = { q: "zzqq", ids: new Set([target.id]) };
  const on = flattenTree(index, visibility(index, { showClosed: false, filters: NO_FILTERS, query: "zzqq", searchIds: hitsFor(fake, "zzqq") }), new Set(), null, true);
  assert.ok(on.nodes.some((n) => n.id === target.id));
  const off = flattenTree(index, visibility(index, { showClosed: false, filters: NO_FILTERS, query: "zzqqx", searchIds: hitsFor(fake, "zzqqx") }), new Set(), null, true);
  assert.equal(off.visible, 0);
});

test("card width: 45% capped at 640 untouched, a dragged width clamped to both minimums", () => {
  assert.equal(cardPaneWidth(null, 1000), 450);
  assert.equal(cardPaneWidth(null, 2000), 640);
  assert.equal(cardPaneWidth(100, 1000), CARD_MIN_W);
  assert.equal(cardPaneWidth(5000, 1000), 1000 - TREE_MIN_W);
  // Too small for both: the card keeps its minimum.
  assert.equal(cardPaneWidth(500, 600), CARD_MIN_W);
});
