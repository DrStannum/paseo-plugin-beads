/**
 * Plugin start and cleanup. Start does nothing that waits: the daemon starts
 * plugins one by one with await, before it accepts connections, so anything
 * slow is deferred. Cleanup: no timer survives it (a leaked one wedges
 * `paseo plugin reload`), read children are killed, writes are let finish
 * without holding the process open, saves not yet written are dropped (the
 * file on disk stays the previous good one).
 */

import { resetRuns, shutdownRuns } from "./beads/run.ts";
import { clearTimers, defer, resumeTimers, stopTimers } from "./beads/timers.ts";
import { clearCache } from "./beads/snapshot.ts";
import { clearExports } from "./beads/export.ts";
import { cancelPendingSaves, sweep } from "./beads/disk.ts";
import { forgetWorkspacesForTests } from "./handlers.ts";

/** Called from contribute(): tidy the disk cache once, after start has returned. */
export function startup(): void {
  defer(() => {
    sweep();
  });
}

export function shutdown(): void {
  shutdownRuns();
  stopTimers();
  cancelPendingSaves();
  clearCache();
}

/** Tests only: back to the state of a freshly loaded plugin (the disk cache is the test's). */
export function resetForTests(): void {
  clearTimers();
  resumeTimers();
  cancelPendingSaves();
  clearCache();
  clearExports();
  resetRuns();
  forgetWorkspacesForTests();
}
