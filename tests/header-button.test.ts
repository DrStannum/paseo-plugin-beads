/**
 * The workspace header buttons (client/header-button.ts) on a fake clock: a
 * button on each workspace the server names and on no other, each added
 * once (the host throws on a second add) and removed once, a failed read
 * keeps what is shown, host workspace changes and the return to the front
 * read the set again, nothing is read in the background, and stop() leaves
 * no button, timer or listener behind — even with a read still in flight.
 * Plus openExplorerOrTab (client/intent.ts), the explorer item's fallback.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { HEADER_NUDGE_MS, HEADER_RECHECK_MS, createHeaderButtons, type HeaderButtonsEnv } from "../client/header-button.ts";
import { createIntentBus, openExplorerOrTab } from "../client/intent.ts";

const flush = () => new Promise<void>((r) => setImmediate(r));

function fakeHost() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  /** Workspace → its live button (the host's registry: a second add throws, like Paseo's). */
  const live = new Map<string, { patches: unknown[] }>();
  const added: string[] = [];
  const removed: string[] = [];
  const reports: string[] = [];
  const watchers = new Set<() => void>();
  const fronts = new Set<() => void>();
  let answer: () => Promise<string[] | null> = async () => [];
  let reads = 0;
  const env: HeaderButtonsEnv & { bg: boolean } = {
    bg: false,
    add(ws) {
      if (live.has(ws)) throw new Error(`duplicate button in ${ws}`);
      const b = { patches: [] as unknown[] };
      live.set(ws, b);
      added.push(ws);
      let gone = false;
      return {
        update: (patch) => void (!gone && b.patches.push(patch)),
        remove: () => {
          if (gone) return;
          gone = true;
          live.delete(ws);
          removed.push(ws);
        },
      };
    },
    list: () => {
      reads++;
      return answer();
    },
    watch(fn) {
      watchers.add(fn);
      return () => watchers.delete(fn);
    },
    report: (m) => void reports.push(m),
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(h) {
      timers.delete(h as number);
    },
    background: () => env.bg,
    onForeground(fn) {
      fronts.add(fn);
      return () => fronts.delete(fn);
    },
  };
  async function advance(ms: number) {
    const until = now + ms;
    for (;;) {
      let next: [number, { at: number; fn: () => void }] | undefined;
      for (const t of timers) if (t[1].at <= until && (!next || t[1].at < next[1].at)) next = t;
      if (!next) break;
      timers.delete(next[0]);
      now = next[1].at;
      next[1].fn();
      await flush();
    }
    now = until;
    await flush();
  }
  return {
    env, advance, timers, live, added, removed, reports, watchers, fronts,
    answer: (fn: () => Promise<string[] | null>) => void (answer = fn),
    reads: () => reads,
  };
}

test("a button on each workspace with a project, none elsewhere, each added once", async () => {
  const h = fakeHost();
  h.answer(async () => ["ws1", "ws2"]);
  const set = createHeaderButtons(h.env);
  await h.advance(0);
  assert.deepEqual([...h.live.keys()].sort(), ["ws1", "ws2"]);
  // The same answer again adds nothing (a second add would have thrown).
  await h.advance(HEADER_RECHECK_MS);
  assert.equal(h.reads(), 2);
  assert.deepEqual(h.added, ["ws1", "ws2"]);
  assert.deepEqual(h.reports, []);
  // .beads gone from ws1, a new project in ws3.
  h.answer(async () => ["ws2", "ws3"]);
  await h.advance(HEADER_RECHECK_MS);
  assert.deepEqual([...h.live.keys()].sort(), ["ws2", "ws3"]);
  assert.deepEqual(h.removed, ["ws1"]);
  assert.deepEqual(set.shown().sort(), ["ws2", "ws3"]);
  set.stop();
});

test("a failed read keeps the buttons shown until the next good one", async () => {
  const h = fakeHost();
  h.answer(async () => ["ws1"]);
  const set = createHeaderButtons(h.env);
  await h.advance(0);
  h.answer(async () => {
    throw new Error("offline");
  });
  await h.advance(HEADER_RECHECK_MS);
  h.answer(async () => null);
  await h.advance(HEADER_RECHECK_MS);
  assert.deepEqual([...h.live.keys()], ["ws1"]);
  assert.equal(h.reports.length, 1);
  h.answer(async () => []);
  await h.advance(HEADER_RECHECK_MS);
  assert.deepEqual([...h.live.keys()], []);
  set.stop();
});

test("a host workspace change reads the set a moment later, bursts coalesced", async () => {
  const h = fakeHost();
  h.answer(async () => []);
  const set = createHeaderButtons(h.env);
  await h.advance(0);
  assert.equal(h.reads(), 1);
  h.answer(async () => ["new"]);
  for (let i = 0; i < 5; i++) h.watchers.forEach((w) => w());
  await h.advance(HEADER_NUDGE_MS);
  assert.equal(h.reads(), 2);
  assert.deepEqual([...h.live.keys()], ["new"]);
  set.stop();
});

test("a change during a read reads again right after it, without a second read in parallel", async () => {
  const h = fakeHost();
  let release!: (ids: string[]) => void;
  let inFlight = 0;
  let most = 0;
  h.answer(() => {
    inFlight++;
    most = Math.max(most, inFlight);
    return new Promise((r) => (release = (ids) => (inFlight--, r(ids))));
  });
  const set = createHeaderButtons(h.env);
  await h.advance(0);
  h.watchers.forEach((w) => w());
  await h.advance(HEADER_NUDGE_MS);
  assert.equal(h.reads(), 1);
  release(["a"]);
  await flush();
  await h.advance(0);
  assert.equal(h.reads(), 2);
  release(["a", "b"]);
  await flush();
  await h.advance(0);
  assert.equal(most, 1);
  assert.deepEqual([...h.live.keys()].sort(), ["a", "b"]);
  set.stop();
});

test("nothing is read in the background; the return to the front reads at once", async () => {
  const h = fakeHost();
  h.answer(async () => ["ws1"]);
  h.env.bg = true;
  const set = createHeaderButtons(h.env);
  await h.advance(HEADER_RECHECK_MS * 3);
  assert.equal(h.reads(), 0);
  h.env.bg = false;
  h.fronts.forEach((f) => f());
  await h.advance(0);
  assert.equal(h.reads(), 1);
  assert.deepEqual([...h.live.keys()], ["ws1"]);
  set.stop();
});

test("updateAll patches every button with its own workspace", async () => {
  const h = fakeHost();
  h.answer(async () => ["ws1", "ws2"]);
  const set = createHeaderButtons(h.env);
  await h.advance(0);
  set.updateAll((ws) => ({ label: ws }));
  assert.deepEqual(h.live.get("ws1")?.patches, [{ label: "ws1" }]);
  assert.deepEqual(h.live.get("ws2")?.patches, [{ label: "ws2" }]);
  set.stop();
});

test("stop removes every button, timer and listener, also with a read in flight", async () => {
  const h = fakeHost();
  let release!: (ids: string[]) => void;
  h.answer(async () => ["ws1"]);
  const set = createHeaderButtons(h.env);
  await h.advance(0);
  h.answer(() => new Promise((r) => (release = r)));
  await h.advance(HEADER_RECHECK_MS);
  set.stop();
  set.stop();
  assert.deepEqual([...h.live.keys()], []);
  assert.equal(h.timers.size, 0);
  assert.equal(h.watchers.size, 0);
  assert.equal(h.fronts.size, 0);
  // The late answer adds nothing and schedules nothing.
  release(["ws1", "ws2"]);
  await h.advance(HEADER_RECHECK_MS * 2);
  assert.deepEqual([...h.live.keys()], []);
  assert.equal(h.timers.size, 0);
});

test("a host that cannot report workspace changes still gets buttons by the periodic read", async () => {
  const h = fakeHost();
  h.answer(async () => ["ws1"]);
  const set = createHeaderButtons({
    ...h.env,
    watch: () => {
      throw new Error("not here");
    },
  });
  await h.advance(0);
  assert.deepEqual([...h.live.keys()], ["ws1"]);
  assert.equal(h.reports.length, 1);
  set.stop();
  assert.equal(h.timers.size, 0);
});

test("openExplorerOrTab: the explorer, or the tab when the host has none", () => {
  const bus = createIntentBus(() => 0);
  const calls: string[] = [];
  openExplorerOrTab("ws1", () => calls.push("explorer"), () => calls.push("tab"), bus);
  assert.deepEqual(calls, ["explorer"]);
  assert.equal(bus.pending("ws1"), false);
  openExplorerOrTab("ws1", () => {
    throw new Error("Explorer is unavailable");
  }, () => calls.push("tab"), bus);
  assert.deepEqual(calls, ["explorer", "tab"]);
  // Through the intent bus: the tab takes a plain open (no older intent rides on it).
  assert.equal(bus.pending("ws1"), true);
  assert.deepEqual(bus.take("ws1", { revisionGrew: true, freshMount: false }), {});
});
