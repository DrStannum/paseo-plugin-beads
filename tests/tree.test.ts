/**
 * The panel's tree logic (shared/tree.ts) on the synthetic fixture, and the
 * data layer's folding of answers into the state on screen (client/load.ts):
 * last good wins, `have` only when there is something to keep, flashes, busy,
 * the empty states.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY, applyDelta, isRefreshing, runCard, runTree, type TreeState } from "../client/load.ts";
import {
  ancestorsOf, buildIndex, compareBy, flattenTree, nextSort, relChildTree, statusBreakdown, visibility, NO_FILTERS,
} from "../shared/tree.ts";
import type { TreeRow } from "../shared/types.ts";
// @ts-ignore — plain JS fixture
import { FIXTURE } from "./fixture/data.mjs";

const ROWS = FIXTURE.tree.issues as TreeRow[];
const index = buildIndex(ROWS);
const vis = (over: Partial<Parameters<typeof visibility>[1]> = {}) =>
  visibility(index, { showClosed: false, filters: NO_FILTERS, query: "", ...over });

test("roots and children in natural order; label slots by sorted label", () => {
  assert.deepEqual(index.roots, ["demo-a1", "demo-b7", "demo-c2", "demo-d9", "demo-e4", "demo-f5"].filter((id) => index.byId.has(id) && !index.byId.get(id)!.parent));
  assert.deepEqual(index.kids.get("demo-a1"), ["demo-a1.1", "demo-a1.2", "demo-a1.3", "demo-a1.4", "demo-a1.5"]);
  const labels = Array.from(new Set(ROWS.flatMap((r) => r.labels))).sort();
  assert.equal(index.labelSlots.get(labels[0]!), 1);
  assert.deepEqual(ancestorsOf(index, "demo-b7.3.1"), ["demo-b7.3", "demo-b7"]);
});

test("closed hidden by default; expanded branches open; kids counted from the whole project", () => {
  const flat = flattenTree(index, vis(), new Set(FIXTURE.expanded), null);
  const ids = flat.nodes.map((n) => n.id);
  assert.ok(!ids.includes("demo-a1.1"), "closed child hidden");
  assert.ok(ids.includes("demo-a1.3"));
  const a1 = flat.nodes.find((n) => n.id === "demo-a1")!;
  assert.equal(a1.kidCount, 5);
  assert.ok(a1.open && a1.hasKids);
  // demo-b7.3's only child is closed: nothing to open.
  assert.equal(flat.nodes.find((n) => n.id === "demo-b7.3")!.hasKids, false);
  assert.equal(flat.visible, ROWS.filter((r) => r.status !== "closed").length);
  // Collapsed: roots only.
  const roots = flattenTree(index, vis(), new Set(), null).nodes;
  assert.ok(roots.every((n) => n.depth === 0));
});

test("show closed brings closed rows back", () => {
  const flat = flattenTree(index, vis({ showClosed: true }), new Set(FIXTURE.expanded), null);
  assert.ok(flat.nodes.some((n) => n.id === "demo-a1.1"));
  assert.ok(flat.nodes.some((n) => n.id === "demo-b7.3.1"));
});

test("a hidden parent leaves its children detached under the nearest visible ancestor", () => {
  // Filter on bugs only: demo-b7.3 (a bug) loses its epic parent.
  const flat = flattenTree(index, vis({ filters: { ...NO_FILTERS, types: ["bug"] } }), new Set(), null);
  const n = flat.nodes.find((x) => x.id === "demo-b7.3")!;
  assert.equal(n.depth, 0);
  assert.equal(n.detached, true);
});

test("a whole key in the query means that issue only; a query opens the way to hits", () => {
  const only = flattenTree(index, vis({ query: "DEMO-A1.3" }), new Set(), null, true);
  assert.deepEqual(only.nodes.map((n) => n.id), ["demo-a1.3"]);
  const word = flattenTree(index, vis({ query: "drag" }), new Set(), null, true);
  assert.ok(word.nodes.some((n) => n.id === "demo-b7.1"), "auto-expanded to the hit");
});

test("sorting reorders siblings, never the hierarchy; header cycles asc → desc → off", () => {
  const byPri = flattenTree(index, vis(), new Set(["demo-a1"]), { key: "priority", dir: 1 });
  const kids = byPri.nodes.filter((n) => n.row.parent === "demo-a1").map((n) => n.row.priority);
  assert.deepEqual(kids, kids.slice().sort((a, b) => (a ?? 99) - (b ?? 99)));
  assert.ok(byPri.nodes.findIndex((n) => n.id === "demo-a1") < byPri.nodes.findIndex((n) => n.id === "demo-a1.5"));
  assert.deepEqual(nextSort(null, "id", true), { key: "id", dir: 1 });
  assert.deepEqual(nextSort({ key: "id", dir: 1 }, "id", true), { key: "id", dir: -1 });
  assert.equal(nextSort({ key: "id", dir: -1 }, "id", true), null);
  assert.deepEqual(nextSort({ key: "id", dir: -1 }, "id", false), { key: "id", dir: 1 });
  const cmp = compareBy(null);
  assert.ok(cmp({ id: "x-2" }, { id: "x-10" }) < 0);
});

test("a card's children list walks the tree and counts folded rows in the bar", () => {
  const items = (index.kids.get("demo-b7") ?? []).map((id) => ({ id, type: "parent-child" }));
  const folded = relChildTree(index, "demo-b7", items, { key: "id", dir: 1 }, new Set());
  assert.equal(folded.rows.length, 3);
  assert.equal(folded.all.length, 4);
  const open = relChildTree(index, "demo-b7", items, { key: "id", dir: 1 }, new Set(["demo-b7.3"]));
  assert.equal(open.rows.length, 4);
  assert.equal(open.rows[3]!.depth, 1);
  const parts = statusBreakdown(folded.all);
  assert.equal(parts.reduce((s, p) => s + p.n, 0), 4);
});

// ── the data layer ────────────────────────────────────────────────────

const FULL = { ...FIXTURE.tree, unchanged: false };

test("first load, then a poll that changed a row flashes it", async () => {
  const calls: unknown[] = [];
  const first = await runTree(undefined, "project", "w", async (i) => (calls.push(i), FULL));
  assert.equal(first.tree?.issues.length, ROWS.length);
  assert.deepEqual(calls[0], { workspaceId: "w", deltas: true }, "nothing to keep: no have, but deltas (a base for the next one)");
  const moved = ROWS.map((r) => (r.id === "demo-a1.4" ? { ...r, updated_at: "2026-08-01T00:00:00Z" } : r));
  const next = await runTree(first, "poll", "w", async (i) => (calls.push(i), { ...FULL, revision: "r2", issues: moved }), () => 1000);
  assert.deepEqual(calls[1], { workspaceId: "w", have: FIXTURE.tree.revision, deltas: true });
  assert.deepEqual(Object.keys(next.flashed), ["demo-a1.4"]);
});

test("a failed refresh keeps the rows and raises the stale bar; failures back off", async () => {
  const first = await runTree(undefined, "project", "w", async () => FULL);
  const failed = await runTree(first, "poll", "w", async () => ({ ok: false, code: "timeout", message: "bd took too long" }));
  assert.equal(failed.tree, first.tree);
  assert.deepEqual(failed.loadIssue, { kind: "failed", code: "timeout", message: "bd took too long" });
  assert.equal(failed.failures, 1);
  const thrown = await runTree(failed, "manual", "w", async () => { throw new Error("socket closed"); });
  assert.equal(thrown.tree, first.tree);
  assert.equal(thrown.failures, 2);
  const back = await runTree(thrown, "poll", "w", async () => ({ ok: true, unchanged: true, revision: FIXTURE.tree.revision, counts: FIXTURE.tree.counts, mode: "bd", export: null }));
  assert.equal(back.loadIssue, null);
  assert.equal(back.failures, 0);
});

test("a stale answer is drawn with the backend note; unchanged keeps the very object", async () => {
  const stale = await runTree(undefined, "project", "w", async () => ({ ...FULL, stale: { code: "bd_failed", message: "lock", at: 1 } }));
  assert.equal(stale.loadIssue?.kind, "backend");
  const same = await runTree(stale, "revalidate", "w", async () => FULL);
  assert.equal(same.tree, stale.tree);
  assert.equal(same.loadIssue, null);
});

test("empty states, busy, and an unchanged answer with nothing held", async () => {
  const none = await runTree(undefined, "project", "w", async () => ({ ok: false, code: "no_beads", project: "/x" }));
  assert.equal(none.tree, null);
  assert.equal(none.empty?.code, "no_beads");
  const busy = await runTree(undefined, "project", "w", async () => ({ ok: false, code: "busy" }));
  assert.equal(busy.busy, true);
  assert.equal(busy.empty, null);
  let n = 0;
  const odd = await runTree({ ...none, revision: "r" } as TreeState, "manual", "w", async () => (n++ ? FULL : { ok: true, unchanged: true, revision: "r" }));
  assert.equal(odd.tree?.issues.length, ROWS.length);
});

test("applyDelta: replaced in place, removed dropped, new appended; nothing moved keeps the array", () => {
  const rows = ROWS.slice(0, 5);
  const changed = { ...rows[1]!, title: "changed" };
  const added = { ...rows[0]!, id: "demo-new" };
  const out = applyDelta(rows, [changed, added], [rows[3]!.id]);
  assert.deepEqual(out.map((r) => r.id), [rows[0]!.id, rows[1]!.id, rows[2]!.id, rows[4]!.id, "demo-new"]);
  assert.equal(out[1], changed);
  assert.equal(out[0], rows[0], "untouched rows keep their objects");
  assert.equal(applyDelta(rows, [], []), rows);
  assert.deepEqual(applyDelta(rows, [], ["nope"]).length, 5, "an unknown removed id is harmless");
});

test("a delta on the held revision is laid over the rows; its upsert flashes; the header comes from it", async () => {
  const first = await runTree(undefined, "project", "w", async () => FULL);
  const moved = { ...ROWS.find((r) => r.id === "demo-a1.4")!, title: "renamed" };
  const gone = ROWS.find((r) => r.id === "demo-c2")!.id;
  const calls: any[] = [];
  const delta = {
    ok: true, unchanged: false, delta: true, base: first.revision, mode: "bd", root: FULL.root, beadsDir: FULL.beadsDir,
    prefix: FULL.prefix, revision: "r2", counts: { ...FULL.counts, total: FULL.counts.total - 1 }, warnings: ["w1"],
    upsert: [moved], removed: [gone],
  };
  const next = await runTree(first, "poll", "w", async (i) => (calls.push(i), delta), () => 1000);
  assert.deepEqual(calls, [{ workspaceId: "w", have: first.revision, deltas: true }]);
  assert.equal(next.revision, "r2");
  assert.equal(next.tree?.revision, "r2");
  assert.deepEqual(next.tree?.warnings, ["w1"]);
  assert.equal(next.tree?.counts.total, FULL.counts.total - 1);
  assert.equal(next.tree?.issues.length, ROWS.length - 1);
  assert.equal(next.tree?.issues.find((r) => r.id === "demo-a1.4")?.title, "renamed");
  assert.ok(!next.tree?.issues.some((r) => r.id === gone));
  assert.deepEqual(Object.keys(next.flashed), ["demo-a1.4"]);
  assert.equal(next.failures, 0);
  // A delta that moved nothing keeps the rows array (the tree index is not rebuilt).
  const empty = await runTree(next, "poll", "w", async () => ({ ...delta, base: "r2", revision: "r3", upsert: [], removed: [] }));
  assert.equal(empty.tree?.issues, next.tree?.issues);
  assert.equal(empty.revision, "r3");
});

test("a delta cut from another revision is not applied: the tree is asked again in full", async () => {
  const first = await runTree(undefined, "project", "w", async () => FULL);
  const calls: any[] = [];
  const answers: any[] = [
    { ok: true, unchanged: false, delta: true, base: "someone-else", mode: "bd", root: "", beadsDir: "", prefix: null, revision: "r9", counts: FULL.counts, warnings: [], upsert: [], removed: [] },
    { ...FULL, revision: "r9" },
  ];
  const next = await runTree(first, "poll", "w", async (i) => (calls.push(i), answers.shift()));
  assert.deepEqual(calls, [
    { workspaceId: "w", have: first.revision, deltas: true },
    { workspaceId: "w", deltas: true },
  ]);
  assert.equal(next.revision, "r9");
  assert.equal(next.tree?.issues.length, ROWS.length);
  // A delta to a call without `have` cannot be laid anywhere: no loop, rows kept.
  const odd = await runTree(first, "manual", "w", async () => answers[0] ?? { ...FULL, delta: true, base: "x", upsert: [], removed: [] });
  assert.equal(odd.tree, first.tree);
});

test("unchanged with deltas carries no counts or export: the held ones stay", async () => {
  const first = await runTree(undefined, "project", "w", async () => FULL);
  const held = { ...first, export: { running: false } as any };
  const same = await runTree(held, "poll", "w", async () => ({ ok: true, unchanged: true, revision: first.revision, mode: "bd" }));
  assert.equal(same.tree, first.tree);
  assert.equal(same.export, held.export);
  // A write's reload is never answered "unchanged": it asks without have, deltas still on.
  const calls: any[] = [];
  await runTree(first, "save", "w", async (i) => (calls.push(i), FULL));
  assert.deepEqual(calls, [{ workspaceId: "w", deltas: true }]);
});

test("refreshing: rows held while newer ones load; not before the first tree, not over a failure", async () => {
  // Nothing on screen yet: the loading state speaks, not the mark.
  assert.equal(isRefreshing(EMPTY, true), false);
  assert.equal(isRefreshing({ ...EMPTY, busy: true }, false), false);
  const first = await runTree(undefined, "project", "w", async () => FULL);
  assert.equal(first.behind, null);
  assert.equal(isRefreshing(first, false), false, "settled: no mark");
  assert.equal(isRefreshing(first, true), true, "a tree request in flight (Refresh, a write's reload, the poll's)");
  // The poll saw the revision move: behind = the revision held, until any tree answer is in.
  const behind: TreeState = { ...first, behind: first.revision };
  assert.equal(isRefreshing(behind, false), true);
  const busy = await runTree(behind, "poll", "w", async () => ({ ok: false, code: "busy" }));
  assert.equal(busy.busy, true);
  assert.equal(isRefreshing(busy, false), true, "the server still loads bd");
  const fresh = await runTree(busy, "poll", "w", async () => ({ ...FULL, revision: "r2" }));
  assert.equal(fresh.behind, null);
  assert.equal(isRefreshing(fresh, false), false, "the new rows are in: the mark goes");
  // A delta and an unchanged answer clear it the same way.
  const delta = await runTree({ ...fresh, behind: "r2" }, "poll", "w", async () => ({ ...FULL, delta: true, base: "r2", revision: "r3", upsert: [], removed: [] }));
  assert.equal(isRefreshing(delta, false), false);
  const same = await runTree({ ...delta, behind: "r3" }, "poll", "w", async () => ({ ok: true, unchanged: true, revision: "r3", mode: "bd" }));
  assert.equal(isRefreshing(same, false), false);
  // A failed refresh: the stale strip tells it, the mark does not hang on.
  const failed = await runTree(behind, "poll", "w", async () => ({ ok: false, code: "timeout" }));
  assert.equal(failed.behind, first.revision);
  assert.equal(isRefreshing(failed, false), false);
  assert.equal(isRefreshing(failed, true), true, "…unless it is being asked again");
  // A behind mark left from an older revision means nothing for the rows held now.
  assert.equal(isRefreshing({ ...fresh, behind: first.revision }, false), false);
  // Rows kept from a cache written before this field existed.
  assert.equal(isRefreshing({ ...first, behind: undefined } as unknown as TreeState, false), false);
});

test("cards: last good copy survives a failed reload with a note", async () => {
  const card = { ...FIXTURE.cards["demo-a1.3"], id: "demo-a1.3" };
  const ok = await runCard(undefined, "w", "demo-a1.3", async () => ({ ok: true, revision: "r1", issue: card }));
  assert.equal(ok.card?.id, "demo-a1.3");
  const again = await runCard(ok, "w", "demo-a1.3", async () => ({ ok: true, revision: "r2", issue: JSON.parse(JSON.stringify(card)) }));
  assert.equal(again.card, ok.card, "same content keeps the object");
  assert.equal(again.revision, "r2");
  const failed = await runCard(again, "w", "demo-a1.3", async () => ({ ok: false, code: "timeout" }));
  assert.equal(failed.card, ok.card);
  assert.deepEqual(failed.note, { code: "timeout", message: undefined });
  const never = await runCard(undefined, "w", "x", async () => ({ ok: false, code: "not_found" }));
  assert.equal(never.failed, true);
});
