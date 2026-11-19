/**
 * The background export / sync job — port of exportFlagsFor / requestExport /
 * requestSync / exportStatus.
 *
 * In Paseo this is also what keeps long work off the RPC path: the daemon
 * kills an RPC after 30 s, so export and sync only *start* inside a handler
 * and the panel polls beads.revision / beads.job-status for the outcome.
 */

import fs from "node:fs";
import path from "node:path";
import type { ExportStatus, LastImport } from "../../shared/types.ts";
import { revisionOf } from "./project.ts";
import { BD_EXPORT_TIMEOUT_MS, firstLine, runBdWrite } from "./run.ts";
import { entryFor, invalidateProject, loadSnapshot } from "./snapshot.ts";
import { log } from "./log.ts";

/** `_type` values bd calls "infrastructure beads". */
const INFRA_TYPES = new Set(["agent", "role", "message"]);

/**
 * Export flags from what issues.jsonl already holds: `bd export` drops
 * memories, infra beads, templates and gates by default, so exporting over a
 * file that has them with no flags would silently delete records.
 */
export function exportFlagsFor(jsonlFile: string): string[] {
  let text: string;
  try {
    text = fs.readFileSync(jsonlFile, "utf8");
  } catch {
    return [];
  }
  const extra = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const type = obj && typeof obj._type === "string" ? obj._type : "issue";
    if (type !== "issue") extra.add(type);
  }
  if (!extra.size) return [];
  let memories = false;
  let infra = false;
  for (const type of extra) {
    if (type === "memory") memories = true;
    else if (INFRA_TYPES.has(type)) infra = true;
    else return ["--all"]; // templates, gates, whatever beads grows next
  }
  const flags: string[] = [];
  if (memories) flags.push("--include-memories");
  if (infra) flags.push("--include-infra");
  return flags;
}

interface Slot {
  root: string;
  running: boolean;
  /** A further export is owed once the current one finishes. One slot, not a queue. */
  dirty: boolean;
  lastOkAt: number | null;
  lastError: string | null;
  lastDurationMs: number | null;
  runs: number;
  wantImport: boolean;
  /** The pass in progress is a sync (import, then export), not a plain export. */
  syncPass: boolean;
  lastImport: LastImport | null;
  supersededFrom: string | null;
  revision: string | null;
  loop: Promise<void> | null;
  /** Which `.beads` directory the state is about (see identityOf). */
  identity: string | null;
  /** Its workspace was archived mid-run: drop the slot once the loop ends, unless asked again. */
  forgotten: boolean;
}

/**
 * Keyed by the `.beads` path, which outlives the project there: an archived
 * workspace (forgetExport) or a `.beads` deleted and made again (identity)
 * must not hand its old error or counters to the next project on that path.
 */
const slots = new Map<string, Slot>();

/** The directory itself, not its path: device, inode and birth time. Null when it is gone. */
function identityOf(beadsDir: string): string | null {
  try {
    const st = fs.statSync(beadsDir);
    return `${st.dev}:${st.ino}:${Math.round(st.birthtimeMs)}`;
  } catch {
    return null;
  }
}

function exportSlot(beadsDir: string): Slot {
  let slot = slots.get(beadsDir);
  const identity = identityOf(beadsDir);
  // Another directory at this path: the old outcome is not this project's.
  // A running loop keeps its slot (a second one would export alongside it);
  // its next pass records the new identity.
  if (slot && !slot.running && slot.identity !== identity) slot = undefined;
  if (!slot) {
    slot = {
      root: "", running: false, dirty: false, lastOkAt: null, lastError: null, lastDurationMs: null,
      runs: 0, wantImport: false, syncPass: false, lastImport: null, supersededFrom: null, revision: null, loop: null,
      identity, forgotten: false,
    };
    slots.set(beadsDir, slot);
  }
  return slot;
}

/**
 * A workspace on this `.beads` was archived and no other known one uses it:
 * forget the export state. A loop still running keeps the slot until it ends,
 * so a request meanwhile joins it rather than starting a second export.
 */
export function forgetExport(beadsDir: string): void {
  const slot = slots.get(beadsDir);
  if (!slot) return;
  if (slot.running) slot.forgotten = true;
  else slots.delete(beadsDir);
}

export function exportStatus(beadsDir: string): ExportStatus {
  const s = exportSlot(beadsDir);
  return {
    running: s.running,
    pending: s.dirty,
    lastOkAt: s.lastOkAt,
    lastError: s.lastError,
    lastDurationMs: s.lastDurationMs,
    runs: s.runs,
    supersededFrom: s.supersededFrom,
    revision: s.revision,
    lastImport: s.lastImport,
    // A sync is running, or one is owed after the pass in progress. The
    // reference reads only wantImport here, which the loop clears before its
    // first await, so its syncing is almost never true; this port also
    // counts the pass that is importing / exporting for a sync.
    syncing: s.running && (s.syncPass || s.wantImport),
    // "the database has moved on from the file"
    stale: Boolean(s.lastError) || s.running || s.dirty,
  };
}

/**
 * Ask for an export, collapsing bursts: while one runs, further requests only
 * raise a flag that buys exactly one more run.
 */
export function requestExport(root: string, beadsDir: string): void {
  const slot = exportSlot(beadsDir);
  slot.root = root;
  slot.forgotten = false;
  if (slot.running) {
    slot.dirty = true;
    return;
  }
  startLoop(slot, beadsDir);
}

/**
 * Reconcile file and database: `bd import` (without --allow-stale, so a stale
 * row cannot overwrite newer work), then `bd export`. Same slot as the export.
 */
export function requestSync(root: string, beadsDir: string): void {
  const slot = exportSlot(beadsDir);
  slot.root = root;
  slot.forgotten = false;
  slot.wantImport = true;
  if (slot.running) {
    slot.dirty = true;
    return;
  }
  startLoop(slot, beadsDir);
}

function startLoop(slot: Slot, beadsDir: string): void {
  slot.running = true;
  slot.loop = runExportLoop(slot, beadsDir).catch((err) => {
    log(`export loop failed in ${beadsDir}: ${(err as Error)?.message ?? "unknown"}`);
  });
}

/** Tests: wait for every running job to finish. */
export async function settleExports(): Promise<void> {
  await Promise.all([...slots.values()].map((s) => s.loop));
}

export function clearExports(): void {
  slots.clear();
}

/**
 * Pull issues.jsonl into the database, reporting what actually moved (from a
 * before/after snapshot diff — bd's own count includes identical rows).
 */
async function runImport(slot: Slot, beadsDir: string): Promise<boolean> {
  const jsonl = path.join(beadsDir, "issues.jsonl");
  if (!fs.existsSync(jsonl)) {
    slot.lastImport = { at: Date.now(), changed: 0, added: 0, skippedStale: 0, error: null, noFile: true };
    return true;
  }

  const before = new Map<string, string | null>();
  const source = entryFor(beadsDir).current || await loadSnapshot(slot.root, beadsDir);
  for (const issue of source.issues || []) before.set(issue.id, issue.updated_at);

  const res = await runBdWrite(slot.root, ["import", "-i", jsonl], { timeoutMs: BD_EXPORT_TIMEOUT_MS });
  if (!res.ok) {
    slot.lastImport = {
      at: Date.now(), changed: 0, added: 0, skippedStale: 0,
      error: firstLine(res.stderr) || (res.timedOut ? "bd import timed out" : `bd import exited with ${res.code}`),
    };
    log(`bd import failed in ${beadsDir}: exit ${res.code}${res.timedOut ? ", timed out" : ""}`);
    // Exporting now would write the database over a file that was just refused.
    return false;
  }

  let skippedStale = 0;
  try {
    const parsed = JSON.parse(res.stdout || "{}");
    if (Number.isFinite(parsed.skipped)) skippedStale = parsed.skipped;
  } catch {
    // the diff below is the real answer
  }

  invalidateProject(beadsDir);
  const after = await loadSnapshot(slot.root, beadsDir);
  let changed = 0;
  let added = 0;
  for (const issue of after.issues || []) {
    if (!before.has(issue.id)) added++;
    else if (before.get(issue.id) !== issue.updated_at) changed++;
  }
  slot.lastImport = { at: Date.now(), changed, added, skippedStale, error: null };
  return true;
}

async function runExportLoop(slot: Slot, beadsDir: string): Promise<void> {
  slot.running = true;
  const jsonl = path.join(beadsDir, "issues.jsonl");
  try {
    do {
      slot.dirty = false;
      slot.identity = identityOf(beadsDir);
      const withImport = slot.wantImport;
      slot.wantImport = false;
      slot.syncPass = withImport;
      if (withImport && !(await runImport(slot, beadsDir))) {
        slot.lastError = slot.lastImport?.error ?? "bd import failed";
        slot.supersededFrom = null;
        slot.revision = null;
        continue;
      }
      slot.runs++;
      const startedAt = Date.now();
      // Taken immediately before the spawn: exactly the revision clients hold.
      const before = revisionOf(beadsDir);
      const res = await runBdWrite(
        slot.root,
        ["export", ...exportFlagsFor(jsonl), "-o", jsonl],
        { timeoutMs: BD_EXPORT_TIMEOUT_MS, json: false },
      );
      slot.lastDurationMs = Date.now() - startedAt;
      if (res.ok) {
        slot.lastOkAt = Date.now();
        slot.lastError = null;
        // The file moved, the data did not: relabel a snapshot read at
        // `before` and record the pair, so nobody refetches a tree they hold.
        const after = revisionOf(beadsDir);
        const entry = entryFor(beadsDir);
        if (entry.current && entry.current.revision === before) entry.current.revision = after;
        if (entry.lastGood && entry.lastGood.revision === before) entry.lastGood.revision = after;
        slot.supersededFrom = before;
        slot.revision = after;
      } else {
        slot.lastError = firstLine(res.stderr) || (res.timedOut ? "bd export timed out" : `bd export exited with ${res.code}`);
        slot.supersededFrom = null;
        slot.revision = null;
        log(`bd export failed in ${beadsDir}: exit ${res.code}${res.timedOut ? ", timed out" : ""}`);
      }
    } while (slot.dirty);
  } finally {
    slot.running = false;
    slot.syncPass = false;
    if (slot.forgotten && slots.get(beadsDir) === slot) slots.delete(beadsDir);
  }
}
