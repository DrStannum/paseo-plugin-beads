/**
 * The panel's pure state (client/ui-state.ts): the card's way back. A link
 * followed from a card (reveal) puts that card on the back stack, "Back"
 * returns to it, a pick in the tree or on the board and Close start over.
 * No forward, no pinned second card.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { BACK_CAP, TAB_DEFAULT, TabStateSchema, initialUi, reducer, type Action, type UiState } from "../client/ui-state.ts";

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
