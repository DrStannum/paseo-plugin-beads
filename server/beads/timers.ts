/**
 * Every timer the plugin starts goes through here, so cleanup can clear them
 * all: a leaked timer leaves the plugin process stuck "Stopping" and wedges
 * `paseo plugin reload`.
 */

const live = new Set<ReturnType<typeof setTimeout>>();

/** After cleanup nothing may schedule a new timer: sleeps end at once. */
let stopped = false;

export function trackTimer(t: ReturnType<typeof setTimeout>): void {
  live.add(t);
}

export function untrackTimer(t: ReturnType<typeof setTimeout>): void {
  live.delete(t);
}

/** A tracked sleep. */
export function sleep(ms: number): Promise<void> {
  if (stopped) return Promise.resolve();
  return new Promise((resolve) => {
    const t = setTimeout(() => {
      live.delete(t);
      resolve();
    }, ms);
    live.add(t);
  });
}

/**
 * Wait for `p`, but no longer than `ms`. The loser is not cancelled: a load
 * that overruns keeps running and lands in the cache for the next caller.
 */
export function within<T>(p: Promise<T>, ms: number): Promise<{ done: true; value: T } | { done: false }> {
  if (stopped) return p.then((value) => ({ done: true as const, value }));
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      live.delete(t);
      resolve({ done: false });
    }, ms);
    live.add(t);
    p.then(
      (value) => {
        clearTimeout(t);
        live.delete(t);
        resolve({ done: true, value });
      },
      (err) => {
        clearTimeout(t);
        live.delete(t);
        reject(err);
      },
    );
  });
}

/** Plugin cleanup: clear everything and refuse new timers. */
export function stopTimers(): void {
  stopped = true;
  clearTimers();
}

/** Tests only: allow timers again. */
export function resumeTimers(): void {
  stopped = false;
}

export function clearTimers(): void {
  for (const t of live) clearTimeout(t);
  live.clear();
}

export function liveTimers(): number {
  return live.size;
}
