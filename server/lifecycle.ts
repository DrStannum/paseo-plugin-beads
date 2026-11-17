/**
 * Plugin cleanup: no timer survives it (a leaked one wedges
 * `paseo plugin reload`), read children are killed, writes are let finish
 * without holding the process open.
 */

import { resetRuns, shutdownRuns } from "./beads/run.ts";
import { clearTimers, resumeTimers, stopTimers } from "./beads/timers.ts";
import { clearCache } from "./beads/snapshot.ts";
import { clearExports } from "./beads/export.ts";

export function shutdown(): void {
  shutdownRuns();
  stopTimers();
  clearCache();
}

/** Tests only: back to the state of a freshly loaded plugin. */
export function resetForTests(): void {
  clearTimers();
  resumeTimers();
  clearCache();
  clearExports();
  resetRuns();
}
