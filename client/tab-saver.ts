/**
 * The tab's state, written to the host a moment after it stops changing.
 *
 * `tab.setState` lands in Paseo's layout store, and the host saves that
 * whole store (every workspace's tabs) into localStorage / AsyncStorage on
 * each change. Writing on every key press in the search box would rewrite
 * the whole layout per character; here a change waits SAVE_DELAY_MS for the
 * next one and only the last is written. `flush()` writes a pending change
 * at once: client/store.tsx calls it when the panel unmounts (the tab is
 * closed or evicted, the plugin reloads), when the app goes to the
 * background and when the page is hidden or unloaded, so the last state is
 * not lost.
 *
 * Works on the JSON text of the state, so an unchanged state — or one that
 * went back to what was last written before the delay ran out — writes
 * nothing. Pure apart from the timers it is handed; the tests drive it with
 * a fake clock.
 */

/** How long a change waits for the next one before it is written. */
export const SAVE_DELAY_MS = 400;

export interface SaverTimers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface TabSaver {
  /** The state the tab already holds (what it was opened with): not written back. */
  seed(json: string): void;
  /** The state changed: write it once it has not changed for the delay. */
  push(json: string): void;
  /** Write a pending change now, if there is one. */
  flush(): void;
  /** A change is waiting to be written. */
  pending(): boolean;
}

const realTimers: SaverTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function createTabSaver(write: (json: string) => void, ms = SAVE_DELAY_MS, timers: SaverTimers = realTimers): TabSaver {
  let written: string | null = null;
  let next: string | null = null;
  let timer: unknown = null;

  const stop = () => {
    if (timer != null) timers.clearTimeout(timer);
    timer = null;
  };
  const flush = () => {
    stop();
    if (next == null) return;
    const json = next;
    next = null;
    written = json;
    write(json);
  };

  return {
    seed(json) {
      if (written == null && next == null) written = json;
    },
    push(json) {
      if (json === (next ?? written)) return;
      stop();
      if (json === written) {
        next = null;
        return;
      }
      next = json;
      timer = timers.setTimeout(flush, ms);
    },
    flush,
    pending: () => next != null,
  };
}
