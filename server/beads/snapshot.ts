/**
 * The per-project snapshot and its cache — port of loadSnapshot and friends,
 * including the reference's caching epic (single-flight loads, the last good
 * snapshot on failure, a retry window, invalidation by generation).
 *
 * On top of the reference: every good load is saved to disk (disk.ts), and
 * the first request for a project in a fresh process reads that file. If its
 * revision is still the project's, it is the current snapshot and bd is not
 * asked at all. If not, it answers reads at once as a stand-in while one
 * `bd list` runs in the background; the client's revision poll then sees the
 * newer revision and asks again. A write never plans against a stand-in.
 */

import fs from "node:fs";
import path from "node:path";
import type { Comment, Counts, Mode, Stale } from "../../shared/types.ts";
import { countUp, indexIssues, normalize, readIssuesJsonl, type Issue } from "./issues.ts";
import { revisionOf } from "./project.ts";
import { BD_LIST_TIMEOUT_MS, findBd, firstLine, looksLikeNoDatabase, runBd, type BdResult } from "./run.ts";
import { defer, sleep } from "./timers.ts";
import { dropProject, readSnapshot as readDisk, scheduleSave, touch } from "./disk.ts";
import { log } from "./log.ts";

export interface LoadError {
  code: string;
  message: string;
}

export interface Snapshot {
  revision: string;
  mode: Mode;
  root: string;
  beadsDir: string;
  prefix: string | null;
  issues: Issue[];
  byId: Map<string, Issue>;
  roots: string[];
  counts: Counts;
  warnings: string[];
  error: LoadError | null;
  loadedAt: number;
  /** id -> comment thread; dies with the snapshot, so a new revision refetches. */
  commentCache: Map<string, Comment[]>;
  /** Set when this is the last good snapshot standing in for a failed load. */
  stale?: Stale;
  /** Read back from the disk cache rather than loaded from bd by this process. */
  fromDisk?: boolean;
}

export interface LoadOptions {
  /** Run bd even if the revision has not moved. */
  force?: boolean;
  /** Only data known to match the project now: no stand-in from disk (writes plan against this). */
  fresh?: boolean;
  /** The revision the caller already holds: a stand-in of that revision tells it nothing, so wait. */
  have?: string;
}

function msFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const v = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * Knobs. `errorRetryMs`: how long a failed `bd list` stands for its revision
 * before a request may try again. `loadRetryDelayMs`: the pause before the one
 * automatic second try. Tests lower them; the env names match the reference.
 */
export const tuning = {
  errorRetryMs: msFromEnv("CBD_ERROR_RETRY_MS", 5000),
  loadRetryDelayMs: msFromEnv("CBD_LOAD_RETRY_DELAY_MS", 300),
};

/** Failures a second try cannot fix. */
const NO_RETRY = new Set(["timeout", "too_big", "no_bd"]);

interface Job {
  revision: string;
  gen: number;
  promise: Promise<Snapshot>;
}

interface Entry {
  current: Snapshot | null;
  lastGood: Snapshot | null;
  gen: number;
  inflight: Job | null;
  failure: { revision: string; gen: number; at: number; result: Snapshot } | null;
  loadError: Stale | null;
  /** The disk cache was looked at (once per entry, on its first load). */
  diskTried: boolean;
  /** A disk copy of an older revision answering reads until the first load after it settles. */
  standIn: Snapshot | null;
}

/** Per-project state, keyed by beadsDir. */
const cache = new Map<string, Entry>();

export function entryFor(beadsDir: string): Entry {
  let entry = cache.get(beadsDir);
  if (!entry) {
    entry = {
      current: null, lastGood: null, gen: 0, inflight: null, failure: null, loadError: null,
      diskTried: false, standIn: null,
    };
    cache.set(beadsDir, entry);
  }
  return entry;
}

/**
 * Load (or reuse) the full issue set. Runs `bd list` only when the revision
 * moved, never twice at once, and a failure after a success hands back the
 * last good snapshot with `stale` set. In a fresh process the disk cache
 * answers first (see the top of this file).
 */
export function loadSnapshot(root: string, beadsDir: string, opts: LoadOptions = {}): Promise<Snapshot> {
  return loadSnapshotOnce(root, beadsDir, opts, false);
}

async function loadSnapshotOnce(
  root: string, beadsDir: string, opts: LoadOptions, joinAny: boolean,
): Promise<Snapshot> {
  const entry = entryFor(beadsDir);
  const revision = revisionOf(beadsDir);
  if (!entry.diskTried) primeFromDisk(entry, root, beadsDir, revision);
  touch(beadsDir);

  if (!opts.force) {
    if (entry.current && entry.current.revision === revision) return entry.current;
    const failure = entry.failure;
    if (failure && failure.revision === revision && failure.gen === entry.gen
      && Date.now() - failure.at < tuning.errorRetryMs) {
      return failure.result;
    }
    // After a restart: the older disk copy answers now, bd catches up behind it.
    const standIn = entry.standIn;
    if (standIn && !opts.fresh && standIn.revision !== opts.have) {
      if (!entry.inflight) startLoad(entry, root, beadsDir, revision).catch(() => {});
      return standIn;
    }
  }

  const running = entry.inflight;
  if (running) {
    // The running load answers if it reads what this caller would read; if
    // the data moved or a write landed since it started, wait it out and go
    // round once more — once.
    if (joinAny || (!opts.force && running.revision === revision && running.gen === entry.gen)) {
      return running.promise;
    }
    await running.promise.catch(() => {});
    return loadSnapshotOnce(root, beadsDir, opts, true);
  }

  return startLoad(entry, root, beadsDir, revision);
}

function startLoad(entry: Entry, root: string, beadsDir: string, revision: string): Promise<Snapshot> {
  const job: Job = { revision, gen: entry.gen, promise: Promise.resolve(null as unknown as Snapshot) };
  job.promise = (async () => {
    try {
      return settle(entry, await readSnapshot(root, beadsDir, revision, entry.lastGood), job.gen);
    } finally {
      if (entry.inflight === job) entry.inflight = null;
    }
  })();
  entry.inflight = job;
  return job.promise;
}

/**
 * The disk copy, indexed, as a Snapshot — or null when there is none (or it
 * was unusable; disk.ts has already dropped it). Synchronous: ~100–150 ms for
 * a 4000-issue project, against up to a minute of `bd list`.
 */
function snapshotFromDisk(root: string, beadsDir: string): Snapshot | null {
  const t0 = Date.now();
  const d = readDisk(beadsDir);
  if (!d) return null;
  const { byId, roots } = indexIssues(d.issues);
  log(`disk cache: ${d.issues.length} issues read back in ${Date.now() - t0} ms`);
  return {
    revision: d.revision,
    mode: d.mode,
    root,
    beadsDir,
    prefix: d.prefix,
    issues: d.issues,
    byId,
    roots,
    counts: countUp(d.issues),
    warnings: d.warnings,
    error: null,
    loadedAt: d.savedAt,
    commentCache: new Map(),
    fromDisk: true,
  };
}

/** First load of an entry with nothing in memory: take what the disk cache has. */
function primeFromDisk(entry: Entry, root: string, beadsDir: string, revision: string): void {
  entry.diskTried = true;
  if (entry.current || entry.lastGood) return;
  const saved = snapshotFromDisk(root, beadsDir);
  if (!saved) return;
  entry.lastGood = saved;
  if (saved.revision === revision) entry.current = saved;
  else entry.standIn = saved;
}

function settle(entry: Entry, snapshot: Snapshot, gen: number): Snapshot {
  // Whatever the outcome, bd has answered: the disk copy stops standing in
  // (on a failure it still serves, marked stale, as the last good one).
  if (gen === entry.gen) entry.standIn = null;
  if (!snapshot.error) {
    if (entry.loadError) log(`bd list recovered in ${snapshot.beadsDir}`);
    // A load that started before a write beats the last good one, but must
    // not answer as current: the write is not in it.
    if (gen === entry.gen) {
      entry.current = snapshot;
      // Off the reply's turn (a big project takes 100–200 ms to write), and
      // not for an entry forgotten meanwhile (its workspace was archived).
      if (cache.get(snapshot.beadsDir) === entry) scheduleSave(snapshot);
    }
    entry.lastGood = snapshot;
    entry.failure = null;
    entry.loadError = null;
    return snapshot;
  }
  const stale: Stale = { code: snapshot.error.code, message: snapshot.error.message, at: Date.now() };
  entry.loadError = stale;
  // A copy, so `stale` never leaks into lastGood; the comment cache is shared
  // by reference on purpose — the data under it is the same.
  const result = entry.lastGood ? { ...entry.lastGood, stale } : snapshot;
  entry.failure = { revision: snapshot.revision, gen, at: stale.at, result };
  return result;
}

async function listIssues(root: string): Promise<{ listed: BdResult; issues: Issue[]; error: LoadError | null }> {
  // Flag order matters: --no-pager belongs to `list`, not to the root command.
  const listed = await runBd(root, ["list", "--all", "-n", "0", "--no-pager"], { timeoutMs: BD_LIST_TIMEOUT_MS });
  let issues: Issue[] = [];
  let error: LoadError | null = null;
  if (listed.ok) {
    try {
      const parsed = JSON.parse(listed.stdout || "[]");
      const rows: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(parsed.issues) ? parsed.issues : [];
      issues = rows.map(normalize).filter((i): i is Issue => i !== null);
    } catch (err) {
      error = { code: "bad_json", message: `bd returned unparseable JSON: ${(err as Error)?.message}` };
    }
  } else if (!findBd()) {
    error = { code: "no_bd", message: "bd was not found on PATH" };
  } else if (listed.timedOut) {
    error = { code: "timeout", message: `bd timed out after ${BD_LIST_TIMEOUT_MS} ms` };
  } else if (listed.truncated) {
    error = { code: "too_big", message: "bd output exceeded the size limit" };
  }
  return { listed, issues, error };
}

/**
 * `bd list`, one more try if a second try can help, and issues.jsonl when
 * there is no database. `revision` is taken before the read, so a write during
 * it shows up as a moved revision.
 */
async function readSnapshot(root: string, beadsDir: string, revision: string, lastGood: Snapshot | null): Promise<Snapshot> {
  const warnings: string[] = [];
  let mode: Mode = "bd";

  let attempt = await listIssues(root);
  let retried = false;
  const failed = !attempt.listed.ok || attempt.error;
  if (failed && !(attempt.error && NO_RETRY.has(attempt.error.code)) && !looksLikeNoDatabase(attempt.listed.stderr)) {
    // A busy database or a half-written file fails once and then works.
    await sleep(tuning.loadRetryDelayMs);
    attempt = await listIssues(root);
    retried = true;
  }
  const { listed } = attempt;
  let { issues, error } = attempt;
  if (listed.ok && listed.stderr.trim()) warnings.push(firstLine(listed.stderr));

  // No database is the other supported shape, not a failure — but a project
  // that already answered from its database is not one of those: swapping in
  // the poorer jsonl view would quietly turn an editable panel read-only.
  if (!error && !listed.ok && lastGood && lastGood.mode === "bd" && !looksLikeNoDatabase(listed.stderr)) {
    error = { code: "bd_failed", message: firstLine(listed.stderr) || `bd list exited with ${listed.code}` };
  }
  if (error || !listed.ok) {
    if (!error || looksLikeNoDatabase(listed.stderr)) {
      const jsonlFile = path.join(beadsDir, "issues.jsonl");
      if (fs.existsSync(jsonlFile)) {
        mode = "jsonl";
        const read = readIssuesJsonl(jsonlFile);
        issues = read.issues;
        if (read.skipped) warnings.push(`${read.skipped} unparseable line(s) in issues.jsonl`);
        error = null;
      } else if (!error) {
        error = { code: "not_initialized", message: firstLine(listed.stderr) || "bd found no beads project here" };
      }
    }
  }

  if (error) {
    // Enough to tell a lock from a timeout from a broken install: bd's own
    // first stderr line (bounded), never stdout — that is issue text.
    const why = firstLine(listed.stderr).slice(0, 200);
    log(
      `bd list failed in ${beadsDir}: ${error.code}, exit ${listed.code}`
      + `${listed.timedOut ? ", timed out" : ""}${retried ? ", after one retry" : ""}`
      + `${lastGood ? ", serving the last good snapshot" : ""}${why ? ` — ${why}` : ""}`,
    );
    issues = [];
  }

  const { byId, roots } = indexIssues(issues);
  return {
    revision,
    mode,
    root,
    beadsDir,
    prefix: issues.length ? String(issues[0]!.id).split(/[-.]/)[0] ?? null : null,
    issues,
    byId,
    roots,
    counts: countUp(issues),
    warnings,
    error,
    loadedAt: Date.now(),
    commentCache: new Map(),
  };
}

/** Drop every snapshot held in memory (tests, plugin cleanup). The disk cache stays. */
export function clearCache(): void {
  cache.clear();
}

/**
 * Mark one project's snapshot as superseded the moment a write lands, so the
 * next read re-runs `bd list`. The last good snapshot stays; so does the disk
 * file — the reload overwrites it.
 */
export function invalidateProject(beadsDir: string): void {
  const entry = entryFor(beadsDir);
  entry.gen++;
  entry.current = null;
  entry.failure = null;
  entry.standIn = null;
}

/**
 * Forget a project in memory and on disk (its workspace was archived). A
 * load still running lands nowhere: settle only saves for a live entry.
 */
export function forgetProject(beadsDir: string): void {
  cache.delete(beadsDir);
  dropProject(beadsDir);
}

/**
 * Warm a project not seen yet by this process, after the current turn — the
 * caller (the revision poll) answers first. From disk this is a file read;
 * otherwise it starts the one `bd list` the panel's tree will join.
 */
export function warmProject(root: string, beadsDir: string): void {
  if (cache.has(beadsDir)) return;
  defer(() => {
    if (!cache.has(beadsDir)) loadSnapshot(root, beadsDir).catch(() => {});
  });
}

/** The last failed load, if none has succeeded since. Cheap. */
export function loadErrorOf(beadsDir: string): Stale | null {
  const entry = cache.get(beadsDir);
  return entry && entry.loadError ? entry.loadError : null;
}
