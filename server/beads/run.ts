/**
 * Running `bd` — port of findBd / runBd / runBdWrite / spawnBd from the
 * reference (cloudcli-beads dist/beads.js).
 *
 * Reads and writes go through two separate functions on purpose: the read
 * path is safe because it structurally cannot reach the write code, not
 * because someone remembered a flag. Every read carries --readonly; a write
 * may only be one of WRITE_SUBCOMMANDS, always with --dolt-auto-commit off.
 *
 * `node:child_process` spawn rather than the SDK's execCommand: execCommand is
 * promisified execFile with Node's 1 MiB default buffer, and a full
 * `bd list --json` of a large project is several MiB.
 */

import fs from "node:fs";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { trackTimer, untrackTimer } from "./timers.ts";

/** Hard stop for a `bd` call. A hydrated 1200-issue dump takes ~1 s. */
export const BD_TIMEOUT_MS = 15000;

/** Hard cap on a `bd` call's stdout. The same dump is ~3 MB. */
export const BD_MAX_STDOUT = 64 * 1024 * 1024;

/** Hard stop for `bd export` / `bd import` — the slow calls, run in the background. */
export const BD_EXPORT_TIMEOUT_MS = 120000;

/** Where `bd` normally lives when PATH is not enough. */
const BD_FALLBACKS = ["/usr/local/bin/bd", "/usr/bin/bd"];

/** The identity writes are made under when neither the caller nor $BEADS_ACTOR names one. */
export const DEFAULT_ACTOR = "paseo-beads";

/**
 * Subcommands the write path may run. The set is the whole contract: anything
 * else is refused rather than executed. `delete` is absent on purpose.
 */
export const WRITE_SUBCOMMANDS: ReadonlySet<string> = new Set([
  "create", "update", "close", "reopen", "export", "import", "comment",
]);

export interface BdResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface RunOptions {
  timeoutMs?: number;
  /** write only: pass --json (default true). `export` writes JSONL to -o and must not. */
  json?: boolean;
  /** write only: the --actor for this call (a comment's author). */
  actor?: string;
}

let bdPathCache: string | null | undefined;

/** Resolve the `bd` binary: PATH first, then the usual absolute spots. */
export function findBd(): string | null {
  if (bdPathCache !== undefined) return bdPathCache;
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const candidate of [...dirs.map((d) => path.join(d, "bd")), ...BD_FALLBACKS]) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return (bdPathCache = candidate);
    } catch {
      // next
    }
  }
  return (bdPathCache = null);
}

/** Tests swap `bd` stubs in and out through PATH. */
export function resetBdPath(): void {
  bdPathCache = undefined;
}

/** Run `bd` read-only in a project. --readonly is not optional. */
export function runBd(root: string, args: string[], opts: RunOptions = {}): Promise<BdResult> {
  return spawnBd(root, ["--readonly", "--json", "-C", root, ...args], opts, false);
}

/**
 * Run a *writing* `bd` command (subcommand first, then its flags).
 *
 * --actor: bd falls back to $BEADS_ACTOR / git user.name / $USER, and the
 * scrubbed env handed to bd has none of those, so it is passed explicitly.
 *
 * --dolt-auto-commit off is passed always: measured on bd 1.1.0, a write with
 * the flag omitted still advances the dolt commit, whatever the docs say.
 */
export function runBdWrite(root: string, args: string[], opts: RunOptions = {}): Promise<BdResult> {
  const sub = args[0] ?? "";
  if (!WRITE_SUBCOMMANDS.has(sub)) {
    return Promise.resolve({
      ok: false, code: null, stdout: "",
      stderr: `refusing to run "bd ${sub}": not a write subcommand this plugin performs`,
      timedOut: false, truncated: false,
    });
  }
  const actor = (opts.actor && opts.actor.trim()) || process.env.BEADS_ACTOR || DEFAULT_ACTOR;
  const argv = [
    ...(opts.json === false ? [] : ["--json"]),
    "--actor", actor,
    "--dolt-auto-commit", "off",
    "-C", root,
    ...args,
  ];
  return spawnBd(root, argv, opts, true);
}

// ── lifecycle ──────────────────────────────────────────────────────────

const readChildren = new Set<ChildProcess>();
const writeChildren = new Set<ChildProcess>();
let shuttingDown = false;

/**
 * Plugin cleanup. Reads are killed — losing one costs nothing. Writes are let
 * finish (killing `bd update` halfway is worse than letting it land), but they
 * no longer hold the plugin process open: their handles are unref'd.
 */
export function shutdownRuns(): void {
  shuttingDown = true;
  for (const child of readChildren) child.kill("SIGKILL");
  for (const child of writeChildren) child.unref();
}

/** Tests only: back to a fresh process. */
export function resetRuns(): void {
  shuttingDown = false;
  resetBdPath();
}

/** How many bd processes are alive right now (tests use this to prove cleanup). */
export function liveRuns(): number {
  return readChildren.size + writeChildren.size;
}

function spawnBd(root: string, argv: string[], opts: RunOptions, write: boolean): Promise<BdResult> {
  const bin = findBd();
  if (!bin || shuttingDown) {
    return Promise.resolve({
      ok: false, code: null, stdout: "",
      stderr: shuttingDown ? "the plugin is shutting down" : "bd not found on PATH",
      timedOut: false, truncated: false,
    });
  }
  return new Promise((resolve) => {
    // A scrubbed env: no BEADS_* leaking in from the daemon, no colour codes.
    const child = spawn(bin, argv, {
      cwd: root,
      env: { PATH: process.env.PATH || "", HOME: process.env.HOME || "", NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const pool = write ? writeChildren : readChildren;
    pool.add(child);
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let done = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs ?? BD_TIMEOUT_MS);
    trackTimer(timer);

    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => {
      if (truncated) return;
      stdout += chunk;
      if (stdout.length > BD_MAX_STDOUT) {
        truncated = true;
        child.kill("SIGKILL");
      }
    });
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      if (stderr.length < 8192) stderr += chunk;
    });

    const finish = (code: number | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      untrackTimer(timer);
      pool.delete(child);
      resolve({ ok: code === 0 && !timedOut && !truncated, code, stdout, stderr, timedOut, truncated });
    };
    child.on("error", (err) => {
      stderr += String(err && err.message ? err.message : err);
      finish(null);
    });
    child.on("close", finish);
  });
}

/** bd's way of saying "this project has no hydrated database". */
export function looksLikeNoDatabase(stderr: string): boolean {
  return /no beads (database|project) found|bd init|BEADS_DIR/i.test(stderr);
}

export function firstLine(s: string | null | undefined): string {
  return String(s || "").trim().split("\n")[0] || "";
}
