/**
 * The board's pure half (shared/board.ts) on the synthetic fixture: which
 * lanes exist and in what order, what each lane holds, the page size, and
 * the drag arithmetic.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { BOARD_PAGE, CARD_TID, DRAG_SLOP, LANE_TID, buildLanes, dropTarget, fromTestId, lanePage, pastSlop } from "../shared/board.ts";
import { buildIndex, compareBy, visibility, NO_FILTERS } from "../shared/tree.ts";
import type { TreeRow } from "../shared/types.ts";
// @ts-ignore — plain JS fixture
import { FIXTURE } from "./fixture/data.mjs";

const ROWS = FIXTURE.tree.issues as TreeRow[];
const index = buildIndex(ROWS);
const vis = (over: Partial<Parameters<typeof visibility>[1]> = {}) =>
  visibility(index, { showClosed: false, filters: NO_FILTERS, query: "", ...over });
const byId = compareBy(null);

test("one lane per status present, bd's order; closed only when shown", () => {
  const hidden = buildLanes(ROWS, vis(), false, byId).map((l) => l.status);
  const statuses = new Set(ROWS.map((r) => r.status));
  const expect = ["open", "in_progress", "blocked", "deferred"].filter((s) => statuses.has(s));
  assert.deepEqual(hidden, expect);
  const shown = buildLanes(ROWS, vis({ showClosed: true }), true, byId).map((l) => l.status);
  assert.deepEqual(shown, expect.concat("closed"));
});

test("lanes hold the visible rows of their status, sorted by the tree's comparator", () => {
  const lanes = buildLanes(ROWS, vis(), false, byId);
  let total = 0;
  for (const lane of lanes) {
    for (const row of lane.rows) assert.equal(row.status, lane.status);
    const ids = lane.rows.map((r) => r.id);
    assert.deepEqual(ids, ids.slice().sort((a, b) => byId(index.byId.get(a)!, index.byId.get(b)!)));
    total += ids.length;
  }
  assert.equal(total, ROWS.filter(vis()).length);
  // Sorted by priority, descending: the comparator, not the id, decides.
  const pri = buildLanes(ROWS, vis(), false, compareBy({ key: "priority", dir: -1 }));
  const open = pri.find((l) => l.status === "open")!.rows.map((r) => r.priority ?? 99);
  for (let i = 1; i < open.length; i++) assert.ok(open[i - 1]! >= open[i]!);
});

test("a lane a filter empties stays on the board (and stays a drop target)", () => {
  const lanes = buildLanes(ROWS, vis({ filters: { ...NO_FILTERS, statuses: ["open"] } }), false, byId);
  assert.ok(lanes.length > 1);
  for (const lane of lanes) if (lane.status !== "open") assert.equal(lane.rows.length, 0);
});

test("custom statuses come after bd's own, alphabetically", () => {
  const extra = [
    { ...ROWS[0]!, id: "demo-z1", status: "zeta" },
    { ...ROWS[0]!, id: "demo-z2", status: "alpha" },
  ] as TreeRow[];
  const all = ROWS.concat(extra);
  const ix = buildIndex(all);
  const lanes = buildLanes(all, visibility(ix, { showClosed: false, filters: NO_FILTERS, query: "" }), false, byId).map((l) => l.status);
  assert.deepEqual(lanes.slice(-2), ["alpha", "zeta"]);
});

test("pages: BOARD_PAGE by default, the reader's own count once asked", () => {
  assert.equal(BOARD_PAGE, 50);
  assert.equal(lanePage({}, "open"), 50);
  assert.equal(lanePage({ open: 100 }, "open"), 100);
  assert.equal(lanePage({ open: 100 }, "blocked"), 50);
});

test("drag: slop, drop target, test ids", () => {
  assert.equal(DRAG_SLOP, 4);
  assert.equal(pastSlop(3, -3), false);
  assert.equal(pastSlop(4, 0), true);
  assert.equal(pastSlop(0, -5), true);
  assert.equal(dropTarget("open", "in_progress"), "in_progress");
  assert.equal(dropTarget("open", "open"), null);
  assert.equal(dropTarget("open", null), null);
  assert.equal(fromTestId(LANE_TID, "beads-lane-in_progress"), "in_progress");
  assert.equal(fromTestId(CARD_TID, "beads-bcard-demo-a1.4"), "demo-a1.4");
  assert.equal(fromTestId(CARD_TID, "beads-lane-open"), null);
  assert.equal(fromTestId(LANE_TID, "beads-lane-"), null);
  assert.equal(fromTestId(LANE_TID, null), null);
});
