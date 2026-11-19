/**
 * The revision poller (client/poller.ts) on a fake clock: one poller per
 * workspace however many panels acquire it, stopped (no timer left) when the
 * last one releases, the shortest interval, backoff, a round at once over held
 * data, wake/retry deduplicated, the app in the background.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { backoffMs, createPollers, type PollEnv, type PollSource } from "../client/poller.ts";
import { POLL_BACKOFF_MAX_MS } from "../client/load.ts";

function fakeEnv() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const fronts = new Set<() => void>();
  const env: PollEnv & { bg: boolean } = {
    bg: false,
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
  /** Move the clock, firing due timers in order (and letting their promises settle). */
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
  return { env, advance, timers, fronts, front: () => [...fronts].forEach((f) => f()) };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

function source(log: string[], name = "s", over: Partial<PollSource<string>> = {}): PollSource<string> & { fails: number } {
  const s: PollSource<string> & { fails: number } = {
    fails: 0,
    failures: (): number => s.fails,
    async check() {
      log.push(name);
      return name;
    },
    ...over,
  };
  return s;
}

test("backoff: the interval doubles per failure, capped at max(interval, 5 min)", () => {
  assert.equal(backoffMs(30000, 0), 30000);
  assert.equal(backoffMs(30000, 1), 60000);
  assert.equal(backoffMs(30000, 3), 240000);
  assert.equal(backoffMs(30000, 10), POLL_BACKOFF_MAX_MS);
  assert.equal(backoffMs(600000, 4), 600000, "an interval longer than the cap is the cap");
});

test("three copies of one workspace: one poller, one round per interval; the last release clears every timer", async () => {
  const { env, advance, timers, fronts } = fakeEnv();
  const pollers = createPollers<string>(env);
  const log: string[] = [];
  const a = pollers.acquire("w1", 1000, source(log, "a"));
  const b = pollers.acquire("w1", 1000, source(log, "b"));
  const c = pollers.acquire("w1", 1000, source(log, "c"));
  assert.equal(pollers.size(), 1);
  assert.equal(timers.size, 1);
  await advance(1000);
  assert.equal(log.length, 1, "one round, not three");
  await advance(3000);
  assert.equal(log.length, 4);
  a.release();
  b.release();
  assert.ok(pollers.live("w1"));
  await advance(1000);
  assert.equal(log.length, 5);
  c.release();
  assert.equal(pollers.size(), 0);
  assert.equal(pollers.live("w1"), false);
  assert.equal(timers.size, 0, "no timer left behind");
  assert.equal(fronts.size, 0, "no app-state listener left behind");
  await advance(10000);
  assert.equal(log.length, 5);
  c.release();
  assert.equal(await c.checkNow(), null, "a released handle checks nothing");
});

test("workspaces poll apart; the newest copy's source runs the round", async () => {
  const { env, advance } = fakeEnv();
  const pollers = createPollers<string>(env);
  const log: string[] = [];
  pollers.acquire("w1", 1000, source(log, "w1-old"));
  const fresh = pollers.acquire("w1", 1000, source(log, "w1-new"));
  pollers.acquire("w2", 1000, source(log, "w2"));
  await advance(1000);
  assert.deepEqual(log.sort(), ["w1-new", "w2"]);
  fresh.release();
  log.length = 0;
  await advance(1000);
  assert.deepEqual(log.sort(), ["w1-old", "w2"], "the remaining copy takes over");
});

test("the shortest interval wins and a change re-arms; failures back off", async () => {
  const { env, advance } = fakeEnv();
  const pollers = createPollers<string>(env);
  const log: string[] = [];
  const src = source(log);
  const slow = pollers.acquire("w", 10000, src);
  await advance(5000);
  assert.equal(log.length, 0);
  const quick = pollers.acquire("w", 2000, source(log, "q"));
  await advance(2000);
  assert.equal(log.length, 1, "re-armed on the shorter interval");
  quick.release();
  slow.setPollMs(3000);
  await advance(3000);
  assert.equal(log.length, 2);
  // The round that failed sets the count; the wait after it backs off.
  src.fails = 2;
  await advance(3000);
  assert.equal(log.length, 3);
  await advance(3000 * 4 - 1);
  assert.equal(log.length, 3, "backing off: 3 s × 2²");
  await advance(1);
  assert.equal(log.length, 4);
  slow.release();
});

test("now: a poller starting over held data runs a round at once; joining a live one does not", async () => {
  const { env, advance } = fakeEnv();
  const pollers = createPollers<string>(env);
  const log: string[] = [];
  const a = pollers.acquire("w", 1000, source(log, "a"), { now: true });
  await advance(0);
  assert.deepEqual(log, ["a"]);
  const b = pollers.acquire("w", 1000, source(log, "b"), { now: true });
  await advance(0);
  assert.deepEqual(log, ["a"], "the second copy asks nothing");
  await advance(1000);
  assert.deepEqual(log, ["a", "b"], "the interval runs from the first round");
  a.release();
  b.release();
});

test("wake: a round now, once even if several copies wake it together; never two rounds at a time", async () => {
  const { env, advance, timers } = fakeEnv();
  const pollers = createPollers<string>(env);
  let release!: () => void;
  let rounds = 0;
  const slow: PollSource<string> = {
    failures: () => 0,
    check: () => {
      rounds++;
      return new Promise<string>((r) => (release = () => r("x")));
    },
  };
  const a = pollers.acquire("w", 1000, slow);
  const b = pollers.acquire("w", 1000, slow);
  a.wake();
  b.wake();
  await advance(0);
  assert.equal(rounds, 1);
  assert.equal(timers.size, 0, "no wait armed while the round runs");
  await advance(5000);
  assert.equal(rounds, 1, "a round in flight is not doubled");
  release();
  await advance(0);
  assert.equal(timers.size, 1, "armed again after the round");
  a.release();
  b.release();
  assert.equal(timers.size, 0);
});

test("retry: one pending per workspace, whoever asks; dropped with the poller", async () => {
  const { env, advance, timers } = fakeEnv();
  const pollers = createPollers<string>(env);
  const log: string[] = [];
  const a = pollers.acquire("w", 60000, source(log));
  const b = pollers.acquire("w", 60000, source(log));
  let fired = 0;
  a.retry(1500, () => fired++);
  b.retry(1500, () => fired++);
  await advance(1500);
  assert.equal(fired, 1);
  a.retry(1500, () => fired++);
  a.release();
  b.release();
  assert.equal(timers.size, 0, "the pending retry is cleared with the poller");
  await advance(5000);
  assert.equal(fired, 1);
});

test("background: rounds are skipped; coming to the front looks at once", async () => {
  const { env, advance, front } = fakeEnv();
  const pollers = createPollers<string>(env);
  const log: string[] = [];
  const h = pollers.acquire("w", 1000, source(log));
  env.bg = true;
  await advance(3000);
  assert.equal(log.length, 0);
  env.bg = false;
  front();
  await advance(0);
  assert.equal(log.length, 1);
  await advance(1000);
  assert.equal(log.length, 2, "one wait, not a doubled chain");
  h.release();
});

test("checkNow runs the round outside the interval and answers its result; a throwing round answers null", async () => {
  const { env } = fakeEnv();
  const pollers = createPollers<string>(env);
  const log: string[] = [];
  const h = pollers.acquire("w", 1000, source(log, "status"));
  assert.equal(await h.checkNow(), "status");
  const bad = pollers.acquire("x", 1000, { failures: () => 0, check: async () => { throw new Error("gone"); } });
  assert.equal(await bad.checkNow(), null);
  // live() inside the round turns false once the poller stopped.
  let seen: (() => boolean) | null = null;
  const watch = pollers.acquire("y", 1000, { failures: () => 0, check: async (live) => ((seen = live), "ok") });
  await watch.checkNow();
  assert.equal(seen!(), true);
  watch.release();
  assert.equal(seen!(), false);
  h.release();
  bad.release();
});
