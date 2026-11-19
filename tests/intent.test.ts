/**
 * The open-intent bus (client/intent.ts) on a fake clock: the tab an
 * openPanel landed in (its revision grew) or a tab that just mounted takes
 * the intent, exactly once; a duplicate tab with no revision change does
 * not; an intent nobody took expires; workspaces and hosts (one bus each)
 * do not see each other's; a failed open drops its intent.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { INTENT_TTL_MS, createIntentBus, requestOpen, setPanelOpener } from "../client/intent.ts";

function clock() {
  let t = 1_000;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

const GREW = { revisionGrew: true, freshMount: false };
const MOUNT = { revisionGrew: false, freshMount: true };
const RENDER = { revisionGrew: false, freshMount: false };

test("the tab whose revision grew takes the intent, and only once", () => {
  const c = clock();
  const bus = createIntentBus(c.now);
  bus.put("ws1", { view: "board" });
  assert.deepEqual(bus.take("ws1", GREW), { view: "board" });
  assert.equal(bus.take("ws1", GREW), null);
  assert.equal(bus.pending("ws1"), false);
});

test("a duplicate tab with no revision change leaves the intent for the focused one", () => {
  const bus = createIntentBus(clock().now);
  bus.put("ws1", { issueId: "p-1" });
  // The "+" copy re-renders (its data changed) but no openPanel landed in it.
  assert.equal(bus.take("ws1", RENDER), null);
  assert.equal(bus.pending("ws1"), true);
  assert.deepEqual(bus.take("ws1", GREW), { issueId: "p-1" });
  // The duplicate after that finds nothing either way.
  assert.equal(bus.take("ws1", GREW), null);
});

test("a freshly mounted tab takes a fresh intent", () => {
  const c = clock();
  const bus = createIntentBus(c.now);
  bus.put("ws1", { issueId: "p-2", view: "tree" });
  c.advance(INTENT_TTL_MS - 1);
  assert.deepEqual(bus.take("ws1", MOUNT), { issueId: "p-2", view: "tree" });
});

test("an intent nobody took expires", () => {
  const c = clock();
  const bus = createIntentBus(c.now);
  bus.put("ws1", { view: "board" });
  c.advance(INTENT_TTL_MS + 1);
  assert.equal(bus.pending("ws1"), false);
  assert.equal(bus.take("ws1", MOUNT), null);
  assert.equal(bus.take("ws1", GREW), null);
});

test("a newer intent replaces an older one", () => {
  const bus = createIntentBus(clock().now);
  bus.put("ws1", { view: "board" });
  bus.put("ws1", {});
  // A plain "Open Beads" after an unclaimed "Open Beads board": just open.
  assert.deepEqual(bus.take("ws1", GREW), {});
});

test("workspaces keep their own intents; hosts their own buses", () => {
  const c = clock();
  const a = createIntentBus(c.now);
  const b = createIntentBus(c.now);
  a.put("ws1", { view: "board" });
  a.put("ws2", { issueId: "p-3" });
  assert.equal(b.take("ws1", GREW), null);
  assert.deepEqual(a.take("ws2", GREW), { issueId: "p-3" });
  assert.deepEqual(a.take("ws1", MOUNT), { view: "board" });
});

test("empty fields are not carried", () => {
  const bus = createIntentBus(clock().now);
  bus.put("ws1", { issueId: "", view: undefined });
  assert.deepEqual(bus.take("ws1", GREW), {});
});

test("requestOpen leaves the intent, then opens; a failed open drops it", () => {
  const bus = createIntentBus(clock().now);
  const opened: string[] = [];
  requestOpen("ws1", { view: "board" }, () => opened.push("ctx"), bus);
  assert.deepEqual(opened, ["ctx"]);
  assert.equal(bus.pending("ws1"), true);
  assert.throws(() => requestOpen("ws1", { issueId: "p-4" }, () => { throw new Error("Explorer is unavailable"); }, bus), /unavailable/);
  assert.equal(bus.pending("ws1"), false);
});

test("requestOpen without its own opener uses the host's openPanel", () => {
  const bus = createIntentBus(clock().now);
  assert.throws(() => requestOpen("ws1", {}, undefined, bus), /opener/);
  const opened: string[] = [];
  const undo = setPanelOpener((ws) => opened.push(ws));
  requestOpen("ws9", { issueId: "p-5" }, undefined, bus);
  assert.deepEqual(opened, ["ws9"]);
  assert.deepEqual(bus.take("ws9", GREW), { issueId: "p-5" });
  undo();
  assert.throws(() => requestOpen("ws1", {}, undefined, bus), /opener/);
});
