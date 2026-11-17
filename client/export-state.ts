/**
 * The export / sync indicator as a pure state machine (reference
 * applyExportState + renderExport): what the badge beside the mode says,
 * folded from the background job's status as the polls bring it in.
 *
 * "Wanted" is our own optimistic flag, set the moment Sync or Export again is
 * pressed: the backend may not show the job as running yet when the next poll
 * lands, and the badge must not blink "done" before anything ran. It is only
 * cleared by evidence — a run past the one we started from has finished.
 */

import type { ExportStatus, LastImport } from "../shared/types.ts";

/** How long the "updated" / "pulled in" confirmation stays. */
export const EXPORT_DONE_MS = 2600;
/** The fast poll while a job runs, and how many ticks before giving up (~90 s). */
export const EXPORT_WATCH_MS = 750;
export const EXPORT_WATCH_TICKS = 120;

export interface ExportTrack {
  status: ExportStatus | null;
  wanted: boolean;
  syncWanted: boolean;
  /** `runs` when we asked: a later finished run is ours. */
  runsBase: number;
  /** When a job was last seen finishing cleanly (0: never). */
  doneAt: number;
  /** That finish was a sync's: report what came in from the file. */
  synced: boolean;
}

export const TRACK_INIT: ExportTrack = { status: null, wanted: false, syncWanted: false, runsBase: 0, doneAt: 0, synced: false };

const busyOf = (s: ExportStatus | null) => Boolean(s && (s.running || s.pending));

/** Sync / Export again was pressed. */
export function requested(t: ExportTrack, sync: boolean): ExportTrack {
  return { ...t, wanted: true, syncWanted: t.syncWanted || sync, runsBase: t.status ? t.status.runs : 0 };
}

/** A poll brought the job's status (reference applyExportState). */
export function observed(t: ExportTrack, next: ExportStatus | null, now: number): ExportTrack {
  if (!next || next === t.status) return t;
  const busy = busyOf(next);
  let wanted = t.wanted;
  if (wanted && !busy && next.runs > t.runsBase) wanted = false;
  const wasBusy = busyOf(t.status) || t.wanted;
  const wasSync = t.syncWanted || Boolean(t.status && t.status.syncing);
  let { doneAt, synced } = t;
  if (wasBusy && !busy && !wanted && !next.lastError) {
    doneAt = now;
    synced = wasSync;
  }
  // The sync flag lives until the job it asked for is over.
  const syncWanted = busy || wanted ? t.syncWanted : false;
  return { status: next, wanted, syncWanted, runsBase: t.runsBase, doneAt, synced };
}

export type ExportBadge =
  | { kind: "none" }
  | { kind: "running"; syncing: boolean }
  | { kind: "stale"; error: string }
  | { kind: "done"; imported: LastImport | null };

/** What the badge shows now (reference renderExport). */
export function badgeOf(t: ExportTrack, now: number): ExportBadge {
  const s = t.status;
  const busy = t.wanted || busyOf(s);
  if (busy) return { kind: "running", syncing: t.syncWanted || Boolean(s && s.syncing) };
  if (s && s.lastError) return { kind: "stale", error: s.lastError };
  if (t.doneAt && now - t.doneAt < EXPORT_DONE_MS) {
    const imported = t.synced && s && s.lastImport && !s.lastImport.error ? s.lastImport : null;
    return { kind: "done", imported };
  }
  return { kind: "none" };
}

/** Is a job (ours or the backend's) still in flight? */
export function inFlight(t: ExportTrack): boolean {
  return t.wanted || busyOf(t.status);
}
