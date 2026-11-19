/**
 * The last good snapshot of each project, kept on disk so a plugin reload or a
 * daemon restart can answer from a file instead of waiting out a full
 * `bd list` (up to a minute on a large project).
 *
 * Where: `$PASEO_HOME/plugin-data/beads/` (`~/.paseo/...` without it), or
 * `CBD_CACHE_DIR` — tests point it at a temporary directory, never at the real
 * one. The directory is 0700 and every file 0600: the files hold issue text,
 * which can quote secrets. One file per project, named by a hash of the
 * absolute `.beads` path, so the name says nothing about the project.
 *
 * Writes are atomic: a private temp file (`wx`, 0600), fsync, rename over the
 * old one. A reader — this process or another — sees the old file or the new
 * one whole, never a mix; a write cut short leaves only a `.tmp`, which no
 * read looks at and `sweep` removes. A file that does not parse, has another
 * shape or format, or belongs to another `.beads` is deleted on read.
 *
 * Last use is the file's mtime: a save sets it, `touch` and a successful read
 * move it to now (`utimes`, at most once per `touchEveryMs`). Not atime: under
 * relatime/noatime the kernel keeps it on its own schedule, and the content's
 * own `savedAt` is what says how old the data is. No index file — a second
 * file to keep consistent with the first buys nothing over one stat each.
 *
 * Nothing here logs issue content (invariant 6): file names are hashes, and a
 * line carries a code, a count or a size.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { ModeSchema, type Mode } from "../../shared/types.ts";
import { normalize, type Issue } from "./issues.ts";
import type { Snapshot } from "./snapshot.ts";
import { log } from "./log.ts";

/** Bump when the stored shape changes; a file of another format is dropped. */
export const FORMAT = 1;

const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Knobs; tests lower them. */
export const diskTuning = {
  /** A snapshot whose JSON is bigger is not cached (and an older file goes). */
  maxFileBytes: 64 * MB,
  /** `sweep` removes the least recently used files until the rest fit. */
  maxTotalBytes: 256 * MB,
  /** `sweep` removes a project not used for this long. */
  maxIdleDays: 30,
  /** A temp file this old is a write that never finished. */
  tmpMaxAgeMs: 60_000,
  /** `touch` writes the time of use at most this often per project. */
  touchEveryMs: 60 * 60 * 1000,
};

/** One project's snapshot as read back: the caller indexes it (indexIssues). */
export interface DiskSnapshot {
  format: number;
  beadsDir: string;
  revision: string;
  mode: Mode;
  prefix: string | null;
  warnings: string[];
  /** Normalized, the graph fields (blockers, childIds, …) still empty. */
  issues: Issue[];
  /** When the snapshot was loaded from bd (its `loadedAt`). */
  savedAt: number;
}

export interface SweepResult {
  /** Files removed, temp files included. */
  removed: number;
  freedBytes: number;
  /** Snapshot files left and their total size. */
  kept: number;
  keptBytes: number;
}

const NAME = /^[0-9a-f]{24}\.json$/;
const TMP = /^[0-9a-f]{24}\.json\.\d+\.[0-9a-f]+\.tmp$/;

/** The top of the file only; each issue goes through normalize(), which is lenient. */
const FileSchema = z.object({
  format: z.number(),
  beadsDir: z.string(),
  revision: z.string(),
  mode: ModeSchema,
  prefix: z.string().nullable(),
  warnings: z.array(z.string()),
  issues: z.custom<unknown[]>((v) => Array.isArray(v)),
  savedAt: z.number(),
});

/** Graph fields indexIssues rebuilds; storing them would only grow the file. */
type StoredIssue = Omit<Issue, "links" | "blockers" | "activeBlockers" | "ready" | "childIds" | "incoming"> & {
  dependencies: { depends_on_id: string; type: string }[];
};

export function cacheDir(): string {
  const override = process.env.CBD_CACHE_DIR;
  if (override) return path.resolve(override);
  return path.join(process.env.PASEO_HOME || path.join(os.homedir(), ".paseo"), "plugin-data", "beads");
}

export function cacheFileFor(beadsDir: string): string {
  const hash = createHash("sha1").update(path.resolve(beadsDir)).digest("hex").slice(0, 24);
  return path.join(cacheDir(), `${hash}.json`);
}

/** file -> when its mtime was last moved to "now" by this process. */
const touched = new Map<string, number>();

function code(err: unknown): string {
  const c = (err as NodeJS.ErrnoException | null)?.code;
  return typeof c === "string" ? c : "error";
}

function kb(bytes: number): string {
  return `${Math.round(bytes / 1024)} KB`;
}

function ensureDir(): string {
  const dir = cacheDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // mkdir's mode goes through the umask, and an existing directory keeps its own.
  fs.chmodSync(dir, 0o700);
  return dir;
}

function removeQuietly(file: string): void {
  try {
    fs.rmSync(file, { force: true });
  } catch {
    // gone already, or not ours to remove — either way not worth a throw
  }
}

/**
 * The stored form is bd's own (`dependencies` with `depends_on_id`), so
 * reading it back is normalize() — the same lenient path as `bd list`.
 */
function toStored(issue: Issue): StoredIssue {
  const { links, blockers: _b, activeBlockers: _a, ready: _r, childIds: _c, incoming: _i, ...rest } = issue;
  return { ...rest, dependencies: links.map((l) => ({ depends_on_id: l.to, type: l.type })) };
}

function writeAll(fd: number, buf: Buffer): void {
  let off = 0;
  while (off < buf.length) off += fs.writeSync(fd, buf, off, buf.length - off);
}

/**
 * Save a good snapshot (not one with an error, not a stale stand-in) over the
 * project's file. Synchronous; never throws — a failure is logged by code and
 * the cache simply stays as it was. Returns whether the file was written.
 */
export function saveSnapshot(s: Snapshot): boolean {
  if (s.error || s.stale) return false;
  const file = cacheFileFor(s.beadsDir);
  let tmp: string | null = null;
  try {
    const t0 = Date.now();
    const body = {
      format: FORMAT,
      beadsDir: path.resolve(s.beadsDir),
      revision: s.revision,
      mode: s.mode,
      prefix: s.prefix,
      warnings: s.warnings,
      issues: s.issues.map(toStored),
      savedAt: s.loadedAt,
    };
    const buf = Buffer.from(JSON.stringify(body), "utf8");
    if (buf.length > diskTuning.maxFileBytes) {
      // An older file would be served after a restart for ever older data.
      removeQuietly(file);
      touched.delete(file);
      log(`disk cache: ${s.issues.length} issues, ${kb(buf.length)} — too big, not cached`);
      return false;
    }
    ensureDir();
    tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      fs.fchmodSync(fd, 0o600); // the umask may have taken bits away; set it exactly
      writeAll(fd, buf);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
    tmp = null;
    touched.set(file, Date.now());
    const ms = Date.now() - t0;
    if (ms > 200) log(`disk cache: saved ${s.issues.length} issues, ${kb(buf.length)} in ${ms} ms`);
    return true;
  } catch (err) {
    if (tmp) removeQuietly(tmp);
    log(`disk cache: save failed (${code(err)})`);
    return false;
  }
}

/** file -> the newest snapshot waiting for scheduleSave's turn. */
const pending = new Map<string, Snapshot>();
let pendingTurn: ReturnType<typeof setImmediate> | null = null;

/**
 * saveSnapshot on the next turn of the event loop, after the reply that
 * produced the snapshot has gone out: serializing a 4000-issue project
 * (~13 MB) blocks for ~100–200 ms. Several calls for one project before that
 * turn write once, the last snapshot.
 */
export function scheduleSave(s: Snapshot): void {
  if (s.error || s.stale) return;
  pending.set(cacheFileFor(s.beadsDir), s);
  if (!pendingTurn) pendingTurn = setImmediate(flushPendingSaves);
}

/** Write whatever scheduleSave is holding, now. */
export function flushPendingSaves(): void {
  if (pendingTurn) clearImmediate(pendingTurn);
  pendingTurn = null;
  const list = [...pending.values()];
  pending.clear();
  for (const s of list) saveSnapshot(s);
}

/** Drop the saves not yet written (plugin cleanup: no 200 ms stall in its 2 s). */
export function cancelPendingSaves(): void {
  if (pendingTurn) clearImmediate(pendingTurn);
  pendingTurn = null;
  pending.clear();
}

function drop(file: string, why: string): null {
  removeQuietly(file);
  touched.delete(file);
  log(`disk cache: ${path.basename(file)} unreadable (${why}), dropped`);
  return null;
}

/**
 * The project's saved snapshot, or null: no file, or one that could not be
 * used — that one is deleted, so the next save starts clean. Counts as a use.
 */
export function readSnapshot(beadsDir: string): DiskSnapshot | null {
  const file = cacheFileFor(beadsDir);
  let text: string;
  try {
    const st = fs.statSync(file);
    if (!st.isFile()) return drop(file, "not_a_file");
    if (st.size > diskTuning.maxFileBytes) return drop(file, "too_big");
    text = fs.readFileSync(file, "utf8");
  } catch (err) {
    if (code(err) === "ENOENT") return null;
    return drop(file, code(err));
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return drop(file, "bad_json");
  }
  const parsed = FileSchema.safeParse(raw);
  if (!parsed.success) return drop(file, "bad_shape");
  const top = parsed.data;
  if (top.format !== FORMAT) return drop(file, "other_format");
  if (top.beadsDir !== path.resolve(beadsDir)) return drop(file, "other_project");

  const issues: Issue[] = [];
  for (const row of top.issues) {
    const issue = normalize(row);
    if (!issue) return drop(file, "bad_issue");
    issues.push(issue);
  }
  touch(beadsDir, { force: true });
  return { ...top, issues };
}

/**
 * Mark the project as used now, so `sweep` keeps it. Cheap to call on every
 * request: the file's time moves at most once per `touchEveryMs`.
 */
export function touch(beadsDir: string, opts: { force?: boolean } = {}): void {
  const file = cacheFileFor(beadsDir);
  const now = Date.now();
  const last = touched.get(file);
  if (!opts.force && last !== undefined && now - last < diskTuning.touchEveryMs) return;
  try {
    const t = new Date(now);
    fs.utimesSync(file, t, t);
    touched.set(file, now);
  } catch (err) {
    if (code(err) !== "ENOENT") log(`disk cache: touch failed (${code(err)})`);
  }
}

/** Forget the project's file (its workspace was archived). */
export function dropProject(beadsDir: string): void {
  const file = cacheFileFor(beadsDir);
  pending.delete(file);
  removeQuietly(file);
  touched.delete(file);
}

/**
 * Tidy the directory: temp files of writes that never finished, projects not
 * used for `maxIdleDays`, then the least recently used until the rest fit in
 * `maxTotalBytes`. Only readdir + stat + unlink, and only files named the way
 * this module names them. Never throws.
 */
export function sweep(opts: { maxTotalBytes?: number; maxIdleDays?: number } = {}): SweepResult {
  const maxTotalBytes = opts.maxTotalBytes ?? diskTuning.maxTotalBytes;
  const maxIdleMs = (opts.maxIdleDays ?? diskTuning.maxIdleDays) * DAY_MS;
  const result: SweepResult = { removed: 0, freedBytes: 0, kept: 0, keptBytes: 0 };
  const dir = cacheDir();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch (err) {
    if (code(err) !== "ENOENT") log(`disk cache: sweep failed (${code(err)})`);
    return result;
  }

  const now = Date.now();
  const live: { file: string; size: number; used: number }[] = [];
  const remove = (file: string, size: number) => {
    try {
      fs.unlinkSync(file);
      touched.delete(file);
      result.removed++;
      result.freedBytes += size;
      return true;
    } catch (err) {
      if (code(err) !== "ENOENT") log(`disk cache: sweep could not remove a file (${code(err)})`);
      return false;
    }
  };

  for (const name of names) {
    const isTmp = TMP.test(name);
    if (!isTmp && !NAME.test(name)) continue;
    const file = path.join(dir, name);
    let st: fs.Stats;
    try {
      st = fs.lstatSync(file);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (isTmp) {
      if (now - st.mtimeMs > diskTuning.tmpMaxAgeMs) remove(file, st.size);
      continue;
    }
    if (now - st.mtimeMs > maxIdleMs) {
      remove(file, st.size);
      continue;
    }
    live.push({ file, size: st.size, used: st.mtimeMs });
  }

  let total = live.reduce((sum, f) => sum + f.size, 0);
  live.sort((a, b) => a.used - b.used);
  const keep: typeof live = [];
  for (const f of live) {
    if (total > maxTotalBytes && remove(f.file, f.size)) total -= f.size;
    else keep.push(f);
  }
  result.kept = keep.length;
  result.keptBytes = keep.reduce((sum, f) => sum + f.size, 0);
  if (result.removed) log(`disk cache: swept ${result.removed} file(s), ${kb(result.freedBytes)} freed`);
  return result;
}
