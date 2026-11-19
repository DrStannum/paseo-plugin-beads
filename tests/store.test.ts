/**
 * The panel's pure state (client/ui-state.ts): what a tab remembers — its
 * version, the way up from older saved states and the fallback field by
 * field — and the card's way back. A link
 * followed from a card (reveal) puts that card on the back stack, "Back"
 * returns to it, a pick in the tree or on the board and Close start over.
 * No forward, no pinned second card. A narrow tab's "back to the list"
 * (toList) puts the card away and keeps the selection.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { BACK_CAP, TAB_DEFAULT, TAB_STATE_VERSION, TabStateSchema, initialUi, migrateTabState, persisted, reducer, type Action, type UiState } from "../client/ui-state.ts";

const run = (s: UiState, ...actions: Action[]) => actions.reduce(reducer, s);
const link = (id: string): Action => ({ type: "reveal", id, ancestors: [], closed: false });

test("a fresh tab has nothing to go back to, even with a remembered selection", () => {
  const s = initialUi({ ...TAB_DEFAULT, selectedId: "a" });
  assert.equal(s.selectedId, "a");
  assert.deepEqual(s.backStack, []);
  assert.equal(reducer(s, { type: "back" }), s, "Back with an empty stack changes nothing");
});

test("links push the card they were followed from; Back walks them in reverse", () => {
  const s = run(initialUi(TAB_DEFAULT), { type: "select", id: "a" }, link("b"), link("c"));
  assert.equal(s.selectedId, "c");
  assert.deepEqual(s.backStack, ["a", "b"]);
  const one = reducer(s, { type: "back" });
  assert.equal(one.selectedId, "b");
  assert.deepEqual(one.backStack, ["a"]);
  const two = reducer(one, { type: "back" });
  assert.equal(two.selectedId, "a");
  assert.deepEqual(two.backStack, []);
  assert.equal(reducer(two, { type: "back" }).selectedId, "a");
});

test("a link from no card, or to the open card, adds no step", () => {
  const fromNothing = reducer(initialUi(TAB_DEFAULT), link("a"));
  assert.deepEqual(fromNothing.backStack, []);
  assert.equal(fromNothing.selectedId, "a");
  assert.deepEqual(reducer(fromNothing, link("a")).backStack, []);
});

test("a pick in the tree or on the board, and Close, start over", () => {
  const s = run(initialUi(TAB_DEFAULT), { type: "select", id: "a" }, link("b"));
  assert.deepEqual(s.backStack, ["a"]);
  const picked = reducer(s, { type: "select", id: "z" });
  assert.equal(picked.selectedId, "z");
  assert.deepEqual(picked.backStack, []);
  const closed = reducer(s, { type: "close" });
  assert.equal(closed.selectedId, null);
  assert.deepEqual(closed.backStack, []);
});

test(`the back stack keeps the last ${BACK_CAP} cards`, () => {
  let s = reducer(initialUi(TAB_DEFAULT), { type: "select", id: "n0" });
  for (let i = 1; i <= BACK_CAP + 10; i++) s = reducer(s, link(`n${i}`));
  assert.equal(s.backStack.length, BACK_CAP);
  assert.equal(s.backStack[s.backStack.length - 1], `n${BACK_CAP + 9}`);
});

test("the two-card mode and the history are gone from the state", () => {
  const s = initialUi(TAB_DEFAULT) as unknown as Record<string, unknown>;
  for (const key of ["focusId", "history", "historyPos"]) assert.equal(key in s, false, key);
});

test("a tab saved with the old two-card fields still opens: they are dropped, the rest kept", () => {
  const old = { ...TAB_DEFAULT, selectedId: "a", query: "x", focusId: "b", history: ["a", "b"], historyPos: 1 };
  const parsed = TabStateSchema.parse(old) as Record<string, unknown>;
  assert.equal(parsed.selectedId, "a");
  assert.equal(parsed.query, "x");
  for (const key of ["focusId", "history", "historyPos"]) assert.equal(key in parsed, false, key);
});

test("a narrow tab's way back to the list keeps the issue selected, any pick opens a card again", () => {
  const s = run(initialUi(TAB_DEFAULT), { type: "select", id: "a" }, link("b"), { type: "toList" });
  assert.equal(s.listShown, true);
  assert.equal(s.selectedId, "b", "the issue stays selected (highlighted in the list)");
  assert.deepEqual(s.backStack, [], "the chain of links is left behind with the card");
  assert.deepEqual(s.reveal?.id, "b", "the list scrolls the selected issue into view if it is off screen");
  assert.equal(reducer(s, { type: "select", id: "b" }).listShown, false, "picking the same row again opens its card");
  assert.equal(reducer(s, { type: "select", id: "c" }).listShown, false);
  assert.equal(reducer(s, link("c")).listShown, false);
  assert.equal(reducer(s, { type: "close" }).listShown, false);
  assert.equal(initialUi({ ...TAB_DEFAULT, selectedId: "a" }).listShown, false, "not remembered: a reopened tab shows the card");
  assert.equal("listShown" in TabStateSchema.parse({ ...TAB_DEFAULT, listShown: true }), false, "not part of the tab's state");
});

// ── what a tab remembers: version, migration, fallback per field ─────

/** A tab saved before versioning (v1): no `v`, the poll interval still in it. */
const V1 = {
  selectedId: "pbd-3",
  expanded: ["pbd-1", "pbd-2"],
  showClosed: true,
  sort: { key: "priority", dir: -1 },
  columns: ["id", "title", "status"],
  view: "board",
  filters: { statuses: ["open"], types: [], priorities: [1], labels: [], readiness: ["ready"], createdDays: 30, assignee: "ann" },
  query: "login",
  collapsedSections: ["deps"],
  relSort: { key: "status", dir: 1 },
  relColumns: ["id", "title"],
  commentSort: -1,
  chartsTab: "flow",
  chartsPeriod: 30,
  chartsStep: "week",
  cardWidth: 420,
  pollMs: 5000,
};

test("the state a tab saves carries the version, and reads back as itself", () => {
  assert.equal(TAB_DEFAULT.v, TAB_STATE_VERSION);
  const ui = run(initialUi(TAB_DEFAULT), { type: "query", query: "x" }, { type: "view", view: "charts" }, { type: "select", id: "a" });
  const saved = JSON.parse(JSON.stringify(persisted(ui)));
  assert.equal(saved.v, TAB_STATE_VERSION);
  assert.deepEqual(TabStateSchema.parse(saved), saved);
  assert.deepEqual(TabStateSchema.parse(TAB_DEFAULT), TAB_DEFAULT);
});

test("a v1 tab (no version) opens with every field it had; the poll interval is dropped", () => {
  const parsed = TabStateSchema.parse(V1) as Record<string, unknown>;
  const { pollMs: _gone, ...rest } = V1;
  assert.deepEqual(parsed, { v: TAB_STATE_VERSION, ...rest });
  assert.equal("pollMs" in parsed, false);
});

test("an older v1 tab without the later fields gets their defaults", () => {
  // Before the charts and the splitter: no chartsTab/chartsPeriod/chartsStep, no cardWidth.
  const { chartsTab: _a, chartsPeriod: _b, chartsStep: _c, cardWidth: _d, ...early } = V1;
  const parsed = TabStateSchema.parse(early);
  assert.equal(parsed.query, "login");
  assert.equal(parsed.view, "board");
  assert.equal(parsed.chartsTab, TAB_DEFAULT.chartsTab);
  assert.equal(parsed.chartsPeriod, TAB_DEFAULT.chartsPeriod);
  assert.equal(parsed.chartsStep, TAB_DEFAULT.chartsStep);
  assert.equal(parsed.cardWidth, null);
});

test("an empty state — a copy of the tab opened from + — is the default tab", () => {
  for (const raw of [undefined, null, {}, "", 0, [], "garbage", 42, true]) {
    const r = TabStateSchema.safeParse(raw);
    assert.equal(r.success, true, `${JSON.stringify(raw)} parses`);
    assert.deepEqual(r.data, TAB_DEFAULT, `${JSON.stringify(raw)} is the default`);
  }
});

test("a broken field falls back alone; the others stay", () => {
  const broken = {
    ...V1,
    v: 1,
    selectedId: 7,
    expanded: "pbd-1",
    showClosed: "yes",
    sort: { key: "no-such-column", dir: 1 },
    columns: ["bogus", "status"],
    relColumns: [1, 2],
    view: "kanban",
    query: { text: "login" },
    relSort: null,
    commentSort: 0,
    chartsPeriod: 13,
    chartsStep: "hour",
    cardWidth: -5,
  };
  const parsed = TabStateSchema.parse(broken);
  assert.equal(parsed.selectedId, null);
  assert.deepEqual(parsed.expanded, []);
  assert.equal(parsed.showClosed, false);
  assert.equal(parsed.sort, null);
  assert.deepEqual(parsed.columns, ["status", "title"], "unknown columns go, the title column always stays");
  assert.deepEqual(parsed.relColumns, TAB_DEFAULT.relColumns, "not a list of names: the default columns");
  assert.equal(parsed.view, "tree");
  assert.equal(parsed.query, "");
  assert.deepEqual(parsed.relSort, TAB_DEFAULT.relSort);
  assert.equal(parsed.commentSort, 1);
  assert.equal(parsed.chartsPeriod, TAB_DEFAULT.chartsPeriod);
  assert.equal(parsed.chartsStep, "auto");
  assert.equal(parsed.cardWidth, null);
  // Untouched fields survive.
  assert.deepEqual(parsed.filters, V1.filters);
  assert.deepEqual(parsed.collapsedSections, ["deps"]);
  assert.equal(parsed.chartsTab, "flow");
  assert.equal(parsed.v, TAB_STATE_VERSION);
});

test("a broken filter falls back alone inside the filters", () => {
  const parsed = TabStateSchema.parse({ ...V1, filters: { ...V1.filters, priorities: ["high"], readiness: ["someday"], assignee: 5 } });
  assert.deepEqual(parsed.filters.statuses, ["open"]);
  assert.equal(parsed.filters.createdDays, 30);
  assert.deepEqual(parsed.filters.priorities, []);
  assert.deepEqual(parsed.filters.readiness, []);
  assert.equal(parsed.filters.assignee, null);
  assert.deepEqual(TabStateSchema.parse({ ...V1, filters: "none" }).filters, TAB_DEFAULT.filters);
});

test("a garbage or future version is read field by field, not thrown away", () => {
  for (const v of ["2", -1, 1.5, null, 99]) {
    const parsed = TabStateSchema.parse({ ...V1, v });
    assert.equal(parsed.v, TAB_STATE_VERSION, `v ${JSON.stringify(v)}`);
    assert.equal(parsed.query, "login", `v ${JSON.stringify(v)}`);
  }
});

test("migrateTabState does not touch the state it is given", () => {
  const raw = { ...V1 };
  const up = migrateTabState(raw);
  assert.equal("pollMs" in raw, true);
  assert.equal("pollMs" in up, false);
  assert.equal(up.v, TAB_STATE_VERSION);
});
