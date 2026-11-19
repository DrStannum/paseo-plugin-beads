/**
 * The tab's state saver (client/tab-saver.ts) on a fake clock: a burst of
 * changes writes once, after the delay, the last of them; flush writes a
 * pending change at once and nothing when there is none; a state that is
 * already written is not written again.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { SAVE_DELAY_MS, createTabSaver, type SaverTimers } from "../client/tab-saver.ts";

/** A fake clock: timers run when the test advances it. */
function clock() {
  let now = 0;
  let seq = 0;
  const due = new Map<number, { at: number; fn: () => void }>();
  const timers: SaverTimers = {
    setTimeout(fn, ms) {
      const id = ++seq;
      due.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(h) {
      due.delete(h as number);
    },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = [...due.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > until) break;
      due.delete(next[0]);
      now = next[1].at;
      next[1].fn();
    }
    now = until;
  };
  return { timers, advance, live: () => due.size };
}

function setup() {
  const c = clock();
  const writes: string[] = [];
  const saver = createTabSaver((json) => writes.push(json), SAVE_DELAY_MS, c.timers);
  return { ...c, writes, saver };
}

test("typing in the search box writes once, the last text, after the pause", () => {
  const { saver, writes, advance } = setup();
  saver.seed('{"query":""}');
  for (const q of ["l", "lo", "log", "logi", "login"]) {
    saver.push(JSON.stringify({ query: q }));
    advance(100);
  }
  assert.deepEqual(writes, [], "nothing written while the keys keep coming");
  assert.equal(saver.pending(), true);
  advance(SAVE_DELAY_MS);
  assert.deepEqual(writes, ['{"query":"login"}']);
  assert.equal(saver.pending(), false);
});

test("changes further apart than the delay are each written", () => {
  const { saver, writes, advance } = setup();
  saver.seed("a");
  saver.push("b");
  advance(SAVE_DELAY_MS);
  saver.push("c");
  advance(SAVE_DELAY_MS);
  assert.deepEqual(writes, ["b", "c"]);
});

test("flush writes the pending change at once (closing the tab, reload, background)", () => {
  const { saver, writes, advance, live } = setup();
  saver.seed("a");
  saver.push("b");
  advance(10);
  saver.flush();
  assert.deepEqual(writes, ["b"]);
  assert.equal(live(), 0, "the timer is cleared: it would hold the plugin's reload");
  advance(SAVE_DELAY_MS * 2);
  assert.deepEqual(writes, ["b"], "and not written a second time");
  saver.flush();
  assert.deepEqual(writes, ["b"], "a flush with nothing pending writes nothing");
});

test("the state the tab was opened with is not written back", () => {
  const { saver, writes, advance } = setup();
  saver.seed("a");
  saver.push("a");
  advance(SAVE_DELAY_MS);
  saver.flush();
  assert.deepEqual(writes, []);
  saver.seed("x");
  saver.push("a");
  assert.equal(saver.pending(), false, "seed only counts before anything was written or pending");
});

test("a change undone before the delay runs out writes nothing", () => {
  const { saver, writes, advance, live } = setup();
  saver.seed("a");
  saver.push("b");
  saver.push("a");
  assert.equal(saver.pending(), false);
  assert.equal(live(), 0);
  advance(SAVE_DELAY_MS);
  saver.flush();
  assert.deepEqual(writes, []);
});

test("the same pending state pushed again does not put the write off", () => {
  const { saver, writes, advance } = setup();
  saver.seed("a");
  saver.push("b");
  advance(SAVE_DELAY_MS - 50);
  saver.push("b");
  advance(60);
  assert.deepEqual(writes, ["b"]);
});

test("without a seed the first state is written", () => {
  const { saver, writes, advance } = setup();
  saver.push("a");
  advance(SAVE_DELAY_MS);
  assert.deepEqual(writes, ["a"]);
});
