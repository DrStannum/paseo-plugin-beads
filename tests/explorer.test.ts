/**
 * The explorer's compact view, its pure half (shared/explorer.ts): whose an
 * issue is, which section it falls in (the tab's readiness rule), the quick
 * search, the counts, and the state the explorer panel remembers.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { EXPLORER_DEFAULT, ExplorerStateSchema, compareMine, explorerView, isMine, matchesQuery, sectionOf } from "../shared/explorer.ts";
import { visibility, buildIndex, NO_FILTERS } from "../shared/tree.ts";
import type { TreeRow } from "../shared/types.ts";

function row(id: string, extra: Partial<TreeRow> = {}): TreeRow {
  return {
    id, title: `Title of ${id}`, status: "open", priority: 2, issue_type: "task", parent: null, labels: [],
    assignee: null, owner: null, created_at: null, created_by: null, updated_at: null, started_at: null, closed_at: null,
    dependency_count: 0, dependent_count: 0, comment_count: 0, blockers: [], ready: false,
    ...extra,
  };
}

const ME = "alex@example.com";
const ROWS: TreeRow[] = [
  row("p-1", { assignee: ME, status: "in_progress", priority: 1 }),
  row("p-2", { assignee: ME, ready: true, priority: 2, title: "Cache the currency table" }),
  row("p-10", { assignee: ME, ready: true, priority: 0 }),
  row("p-3", { assignee: ME, ready: true, priority: 2 }),
  row("p-4", { assignee: ME, status: "blocked", blockers: ["p-1"] }),
  row("p-5", { assignee: ME, blockers: ["p-1"] }), // open, but blocked: not ready
  row("p-6", { assignee: ME, status: "deferred" }),
  row("p-7", { assignee: ME, status: "closed" }),
  row("p-8", { assignee: "sam@example.com", status: "in_progress" }),
  row("p-9", { ready: true }), // nobody's
  row("p-11", { assignee: ME, status: "in_progress", priority: null }),
];

test("an issue is mine when its assignee is my name, trimmed and in any case; a blank name owns nothing", () => {
  assert.equal(isMine({ assignee: ME }, ME), true);
  assert.equal(isMine({ assignee: " Alex@Example.com " }, "alex@example.COM"), true);
  assert.equal(isMine({ assignee: "sam@example.com" }, ME), false);
  assert.equal(isMine({ assignee: null }, ME), false);
  assert.equal(isMine({ assignee: "" }, ""), false);
  assert.equal(isMine({ assignee: null }, "  "), false);
});

test("sections: in progress by status, ready by the tab's readiness rule, the rest nowhere", () => {
  assert.equal(sectionOf(row("a", { status: "in_progress" })), "doing");
  assert.equal(sectionOf(row("a", { ready: true })), "ready");
  assert.equal(sectionOf(row("a", { blockers: ["b"] })), null);
  assert.equal(sectionOf(row("a", { status: "blocked", blockers: ["b"] })), null);
  assert.equal(sectionOf(row("a", { status: "deferred" })), null);
  assert.equal(sectionOf(row("a", { status: "closed" })), null);
  // The same rows the tab's "ready" filter keeps.
  const index = buildIndex(ROWS);
  const tabReady = ROWS.filter(visibility(index, { showClosed: true, filters: { ...NO_FILTERS, readiness: ["ready"] }, query: "", searchIds: null }));
  assert.deepEqual(ROWS.filter((r) => sectionOf(r) === "ready").map((r) => r.id), tabReady.map((r) => r.id));
});

test("the view: my rows per section, most urgent first, natural id order; counts before the search", () => {
  const v = explorerView(ROWS, { me: ME });
  assert.deepEqual(v.sections.doing.map((r) => r.id), ["p-1", "p-11"], "no priority sorts last");
  assert.deepEqual(v.sections.ready.map((r) => r.id), ["p-10", "p-2", "p-3"]);
  assert.deepEqual(v.counts, { doing: 2, ready: 3, open: 8 });
  const searched = explorerView(ROWS, { me: ME, query: "currency" });
  assert.deepEqual(searched.sections.ready.map((r) => r.id), ["p-2"]);
  assert.deepEqual(searched.sections.doing, []);
  assert.deepEqual(searched.counts, v.counts, "the counts are the reader's, not the search's");
});

test("no name: nothing listed, nothing counted", () => {
  const v = explorerView(ROWS, { me: "" });
  assert.deepEqual(v.sections, { doing: [], ready: [] });
  assert.deepEqual(v.counts, { doing: 0, ready: 0, open: 0 });
});

test("the quick search: every word in the id or title, or a server hit for the query", () => {
  const r = row("demo-a1.5", { title: "Toggling a permission does not persist" });
  assert.equal(matchesQuery(r, ""), true);
  assert.equal(matchesQuery(r, "   "), true);
  assert.equal(matchesQuery(r, "PERMISSION persist"), true);
  assert.equal(matchesQuery(r, "a1.5"), true);
  assert.equal(matchesQuery(r, "permission reload"), false);
  assert.equal(matchesQuery(r, "reload", new Set(["demo-a1.5"])), true, "the server found it in the text");
  assert.equal(matchesQuery(r, "reload", new Set(["other"])), false);
  const hits = explorerView(ROWS, { me: ME, query: "zzz", hits: new Set(["p-3", "p-8"]) });
  assert.deepEqual(hits.sections.ready.map((x) => x.id), ["p-3"]);
  assert.deepEqual(hits.sections.doing, [], "a hit that is not mine stays out");
});

test("compareMine: priority, then natural id", () => {
  const ids = [row("x-10", { priority: 1 }), row("x-2", { priority: 1 }), row("x-1", { priority: null }), row("x-3", { priority: 0 })]
    .sort(compareMine)
    .map((r) => r.id);
  assert.deepEqual(ids, ["x-3", "x-2", "x-10", "x-1"]);
});

test("the explorer's remembered state falls back field by field", () => {
  assert.deepEqual(ExplorerStateSchema.parse(undefined), EXPLORER_DEFAULT);
  assert.deepEqual(ExplorerStateSchema.parse("junk"), EXPLORER_DEFAULT);
  assert.deepEqual(ExplorerStateSchema.parse([1]), EXPLORER_DEFAULT);
  assert.deepEqual(ExplorerStateSchema.parse({ query: "abc", collapsed: ["ready", "nope", "ready"] }), { query: "abc", collapsed: ["ready"] });
  assert.deepEqual(ExplorerStateSchema.parse({ query: 5, collapsed: "doing" }), EXPLORER_DEFAULT);
  assert.deepEqual(ExplorerStateSchema.parse({ collapsed: ["ready", "doing"], extra: 1 }), { query: "", collapsed: ["doing", "ready"] });
});
