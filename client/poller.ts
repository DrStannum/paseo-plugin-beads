/**
 * One revision poll per workspace, however many panels show it.
 *
 * Paseo keeps hidden tabs mounted (three per pane, up to ten workspaces on
 * web) and a copy may sit in the explorer; a timer per mounted panel would
 * poll the daemon once per copy. Here every copy of a workspace acquires the
 * same poller: the first one starts it, the last one to let go stops it (a
 * leaked timer wedges the plugin's reload). One module instance per plugin
 * installation, like the host's QueryClient, so the pollers are shared
 * exactly as widely as the cache they refresh.
 *
 * Pure apart from the environment it is handed (timers, app state), so the
 * tests drive it with a fake clock.
 */

import { POLL_BACKOFF_MAX_MS } from "./load.ts";

/** The wait before the next round: the interval, doubled per consecutive failure, capped. */
export function backoffMs(pollMs: number, failures: number): number {
  if (!failures) return pollMs;
  return Math.min(pollMs * 2 ** failures, Math.max(pollMs, POLL_BACKOFF_MAX_MS));
}

/** What a poll does; every copy of a workspace hands an equivalent one. */
export interface PollSource<R> {
  /** One round. `live()` turns false once the poller is stopped. */
  check(live: () => boolean): Promise<R>;
  /** Consecutive failed rounds, for the backoff. */
  failures(): number;
}

export interface PollEnv {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** The app is in the background: rounds are skipped. */
  background(): boolean;
  /** Called when the app comes back to the front; returns the unsubscribe. */
  onForeground(fn: () => void): () => void;
}

export interface PollHandle<R> {
  /** This copy's interval changed (the setting); the poller runs on the shortest. */
  setPollMs(ms: number): void;
  /** One round now, outside the interval; null once released. */
  checkNow(): Promise<R | null>;
  /** A round now instead of at the end of the wait; nothing if one is running. */
  wake(): void;
  /** Run `fn` once after `ms` — one pending retry per workspace, whoever asks. */
  retry(ms: number, fn: () => void): void;
  release(): void;
}

export interface Pollers<R> {
  /**
   * Join the workspace's poller (start it if this is the first copy). With
   * `now`, a poller that starts here runs its first round at once: the data
   * held may be old (nobody polled it while no panel showed it).
   */
  acquire(key: string, pollMs: number, source: PollSource<R>, opts?: { now?: boolean }): PollHandle<R>;
  /** Some panel still shows this workspace. */
  live(key: string): boolean;
  /** How many pollers run (tests). */
  size(): number;
}

interface Sub<R> {
  pollMs: number;
  source: PollSource<R>;
}

interface Entry<R> {
  subs: Map<number, Sub<R>>;
  timer: unknown;
  retryTimer: unknown;
  ticking: boolean;
  stopped: boolean;
  unsubscribe: () => void;
}

export function createPollers<R>(env: PollEnv): Pollers<R> {
  const entries = new Map<string, Entry<R>>();
  let nextId = 1;

  const pollOf = (e: Entry<R>) => {
    let ms = Infinity;
    for (const s of e.subs.values()) ms = Math.min(ms, s.pollMs);
    return ms;
  };
  /** The newest copy's source: they are equivalent, the newest is surely mounted. */
  const sourceOf = (e: Entry<R>) => {
    let last: Sub<R> | undefined;
    for (const s of e.subs.values()) last = s;
    return last?.source;
  };

  function arm(e: Entry<R>) {
    if (e.stopped || e.timer !== null) return;
    const src = sourceOf(e);
    e.timer = env.setTimeout(() => void tick(e), backoffMs(pollOf(e), src ? src.failures() : 0));
  }

  async function round(e: Entry<R>): Promise<R | null> {
    const src = sourceOf(e);
    if (!src || e.stopped) return null;
    try {
      return await src.check(() => !e.stopped);
    } catch {
      return null;
    }
  }

  async function tick(e: Entry<R>) {
    e.timer = null;
    if (e.ticking || e.stopped) return;
    e.ticking = true;
    try {
      if (!env.background()) await round(e);
    } finally {
      e.ticking = false;
    }
    arm(e);
  }

  function stop(key: string, e: Entry<R>) {
    e.stopped = true;
    if (e.timer !== null) env.clearTimeout(e.timer);
    if (e.retryTimer !== null) env.clearTimeout(e.retryTimer);
    e.timer = e.retryTimer = null;
    e.unsubscribe();
    if (entries.get(key) === e) entries.delete(key);
  }

  return {
    acquire(key, pollMs, source, opts) {
      let e = entries.get(key);
      const fresh = !e;
      if (!e) {
        const made: Entry<R> = { subs: new Map(), timer: null, retryTimer: null, ticking: false, stopped: false, unsubscribe: () => {} };
        made.unsubscribe = env.onForeground(() => {
          // Back in front: look now rather than at the end of the interval.
          if (made.stopped) return;
          if (made.timer !== null) env.clearTimeout(made.timer);
          made.timer = null;
          void tick(made);
        });
        entries.set(key, made);
        e = made;
      }
      const entry = e;
      const id = nextId++;
      const before = pollOf(entry);
      entry.subs.set(id, { pollMs, source });
      if (fresh && opts?.now) void tick(entry);
      else if (pollOf(entry) !== before) rearm(entry);
      else arm(entry);

      let released = false;
      return {
        setPollMs(ms) {
          const sub = entry.subs.get(id);
          if (!sub || sub.pollMs === ms) return;
          const was = pollOf(entry);
          sub.pollMs = ms;
          if (pollOf(entry) !== was) rearm(entry);
        },
        checkNow() {
          return released ? Promise.resolve(null) : round(entry);
        },
        wake() {
          if (released || entry.stopped || entry.ticking) return;
          if (entry.timer !== null) env.clearTimeout(entry.timer);
          entry.timer = null;
          void tick(entry);
        },
        retry(ms, fn) {
          if (released || entry.stopped || entry.retryTimer !== null) return;
          entry.retryTimer = env.setTimeout(() => {
            entry.retryTimer = null;
            if (!entry.stopped) fn();
          }, ms);
        },
        release() {
          if (released) return;
          released = true;
          entry.subs.delete(id);
          if (!entry.subs.size) stop(key, entry);
        },
      };
    },
    live: (key) => entries.has(key),
    size: () => entries.size,
  };

  /** The interval changed: start the wait again on the new one. */
  function rearm(e: Entry<R>) {
    if (e.timer !== null) env.clearTimeout(e.timer);
    e.timer = null;
    if (!e.ticking) arm(e);
  }
}
