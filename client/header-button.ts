/**
 * The Beads button in the workspace header.
 *
 * Paseo registers a header button per workspace (`addHeaderButton({id,
 * workspaceId, button})`), so the plugin keeps the set itself: one button on
 * every workspace that has a beads project, none elsewhere. Which ones those
 * are the server says (`beads.workspaces`: the daemon's workspace list and a
 * few stats each, no bd). The set is read when the plugin starts, a moment
 * after the host reports a workspace change (if it does), every
 * HEADER_RECHECK_MS (a `bd init` in an open workspace, a removed `.beads`),
 * and when the app comes back to the front; never while it is in the
 * background.
 *
 * A button is added once and removed once: adding the same id to the same
 * workspace twice throws in the host, and a registration left behind would
 * outlive a plugin reload. `stop()` removes every button and every timer and
 * listener. A failed read keeps the buttons shown until the next one. Pure
 * apart from what it is handed: the tests drive it under node.
 */

import type { PollEnv } from "./poller.ts";

/** How often the set of workspaces with a beads project is read again. */
export const HEADER_RECHECK_MS = 30_000;
/** How long after a host workspace change the set is read (changes come in bursts). */
export const HEADER_NUDGE_MS = 500;

/** What `addHeaderButton` hands back. */
export interface ButtonHandle {
  update(patch: Record<string, unknown>): void;
  remove(): void;
}

export interface HeaderButtonsEnv extends PollEnv {
  /** Register the button on one workspace (the host's addHeaderButton). */
  add(workspaceId: string): ButtonHandle;
  /** The workspaces that should have a button; null (or a throw) = unknown this time. */
  list(): Promise<string[] | null>;
  /** The host's workspace changes, if it reports them; returns the unsubscribe. */
  watch?(changed: () => void): () => void;
  /** Where a failure goes (add threw, the read failed). */
  report?(message: string): void;
}

export interface HeaderButtons {
  /** Patch every button shown (the menu changed); `patch` gets the workspace. */
  updateAll(patch: (workspaceId: string) => Record<string, unknown>): void;
  /** The workspaces with a button now (tests). */
  shown(): string[];
  /** Remove every button, timer and listener; idempotent. */
  stop(): void;
}

export function createHeaderButtons(env: HeaderButtonsEnv, recheckMs = HEADER_RECHECK_MS, nudgeMs = HEADER_NUDGE_MS): HeaderButtons {
  const buttons = new Map<string, ButtonHandle>();
  const report = env.report ?? (() => {});
  let stopped = false;
  let running = false;
  let again = false;
  let timer: unknown = null;

  function schedule(ms: number) {
    if (stopped) return;
    if (timer != null) env.clearTimeout(timer);
    timer = env.setTimeout(() => {
      timer = null;
      void read();
    }, ms);
  }

  function show(ids: readonly string[]) {
    const want = new Set(ids);
    for (const [id, handle] of buttons) {
      if (want.has(id)) continue;
      handle.remove();
      buttons.delete(id);
    }
    for (const id of want) {
      if (buttons.has(id)) continue;
      try {
        buttons.set(id, env.add(id));
      } catch (err) {
        report(`header button: ${(err as Error)?.message ?? String(err)}`);
      }
    }
  }

  async function read() {
    if (stopped) return;
    if (running) {
      again = true;
      return;
    }
    if (env.background()) {
      schedule(recheckMs);
      return;
    }
    running = true;
    try {
      const ids = await env.list();
      if (!stopped && ids) show(ids);
    } catch (err) {
      if (!stopped) report(`header button: workspaces not read: ${(err as Error)?.message ?? String(err)}`);
    } finally {
      running = false;
    }
    if (again) {
      again = false;
      schedule(0);
    } else {
      schedule(recheckMs);
    }
  }

  let unwatch: (() => void) | undefined;
  try {
    unwatch = env.watch?.(() => {
      if (running) again = true;
      else schedule(nudgeMs);
    });
  } catch (err) {
    // No change reports from this host: the periodic read alone.
    report(`header button: workspace changes not watched: ${(err as Error)?.message ?? String(err)}`);
  }
  const unfront = env.onForeground(() => schedule(0));
  schedule(0);

  return {
    updateAll(patch) {
      for (const [id, handle] of buttons) handle.update(patch(id));
    },
    shown: () => [...buttons.keys()],
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer != null) env.clearTimeout(timer);
      timer = null;
      unwatch?.();
      unfront();
      for (const handle of buttons.values()) handle.remove();
      buttons.clear();
    },
  };
}
