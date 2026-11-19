/**
 * The RPC handlers — port of the reference's routing (dist/server.js).
 *
 * Each one is a plain function of (input, ctx) so tests can call it without a
 * daemon. What changed against the HTTP original, and why:
 *
 * - The project comes from the workspace id, resolved by the daemon
 *   (server/workspaces.ts), then walked up to its `.beads` as before.
 * - The daemon kills an RPC after 30 s. Reads wait for a load at most
 *   BUDGET_MS and otherwise answer `busy` — the load keeps running and lands
 *   in the cache for the next poll. A write that landed but whose reload did
 *   not finish in time answers ok:true with `issue: null, reloading: true`.
 * - The background export is requested just before the reply instead of just
 *   after it (an RPC has no "after the reply").
 * - After a restart the first read may be answered from the disk cache
 *   (server/beads/snapshot.ts); writes always plan against fresh data.
 * - beads.tree with `deltas` answers a moved revision with only the rows that
 *   moved, when it remembers the client's (server/beads/history.ts).
 */

import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput, RpcOutput } from "@getpaseo/plugin";
import type {
  commentRpc, createRpc, editRpc, exportRpc, healthRpc, issueRpc, jobStatusRpc,
  pingRpc, revisionRpc, searchRpc, syncRpc, treeRpc,
} from "../shared/rpc.ts";
import type { Failure } from "../shared/types.ts";
import { workspaceDirectory } from "./workspaces.ts";
import { resolveProject, revisionOf } from "./beads/project.ts";
import { findBd } from "./beads/run.ts";
import {
  forgetProject, invalidateProject, loadErrorOf, loadSnapshot, warmProject, type LoadOptions, type Snapshot,
} from "./beads/snapshot.ts";
import { issueCard, searchIssues } from "./beads/card.ts";
import { deltaFrom, remember, rowsOf } from "./beads/history.ts";
import { planComment, planCreate, planEdit, runComment, runCreate, runEdit } from "./beads/write.ts";
import { exportStatus, requestExport, requestSync } from "./beads/export.ts";
import { within } from "./beads/timers.ts";
import { log } from "./beads/log.ts";

type Ctx = PluginHandlerContext;

/** Cap on search results handed to the panel. */
const SEARCH_LIMIT = 2000;

/** How long one handler may wait for bd, well inside the daemon's 30 s. */
export const handlerTuning = { budgetMs: 25000 };

interface Located {
  ok: true;
  directory: string;
  root: string;
  beadsDir: string;
}

/** Workspace id → the `.beads` it last resolved to; read when a workspace is archived. */
const seen = new Map<string, string>();

/** Workspace id → directory (via the daemon) → `.beads`. Empty states are Failures, not throws. */
async function locate(ctx: Ctx, workspaceId: string): Promise<Located | Failure> {
  const directory = await workspaceDirectory(ctx, workspaceId);
  if (!directory) return { ok: false, code: "unknown_workspace", project: null, bdFound: Boolean(findBd()) };
  const verdict = resolveProject(directory);
  if (!verdict.ok) return { ok: false, code: verdict.code, project: verdict.project, bdFound: Boolean(findBd()) };
  seen.set(workspaceId, verdict.beadsDir);
  return { ok: true, directory, root: verdict.root, beadsDir: verdict.beadsDir };
}

const BUSY: Failure = { ok: false, code: "busy", message: "bd is still loading this project; try again" };

/** The snapshot, or null when the load overran the budget (it keeps running). */
async function snapshotWithin(loc: Located, ms: number, opts: LoadOptions = {}): Promise<Snapshot | null> {
  const r = await within(loadSnapshot(loc.root, loc.beadsDir, opts), Math.max(0, ms));
  return r.done ? r.value : null;
}

function staleOf(snapshot: Snapshot): { stale?: Snapshot["stale"] } {
  return snapshot.stale ? { stale: snapshot.stale } : {};
}

function loadFailure(snapshot: Snapshot): Failure {
  return { ok: false, code: snapshot.error!.code, message: snapshot.error!.message, beadsDir: snapshot.beadsDir, bdFound: Boolean(findBd()) };
}

/** Never let an unexpected throw become the daemon's bare error string. */
async function guarded<T>(name: string, fn: () => Promise<T>): Promise<T | Failure> {
  try {
    return await fn();
  } catch (err) {
    const message = err && typeof err === "object" && "message" in err ? String((err as Error).message) : String(err);
    log(`${name} failed: ${message}`);
    return { ok: false, code: "internal", message };
  }
}

// ── reads ──────────────────────────────────────────────────────────────

export function ping(input: RpcInput<typeof pingRpc>, ctx: Ctx): Promise<RpcOutput<typeof pingRpc>> {
  return guarded("beads.ping", async () => {
    const directory = await workspaceDirectory(ctx, input.workspaceId);
    if (!directory) return { ok: false as const, code: "unknown_workspace" };
    return { ok: true as const, directory, bd: findBd() };
  });
}

export function health(input: RpcInput<typeof healthRpc>, ctx: Ctx): Promise<RpcOutput<typeof healthRpc>> {
  return guarded("beads.health", async () => {
    const loc = await locate(ctx, input.workspaceId);
    if (!loc.ok) return loc;
    const snapshot = await snapshotWithin(loc, handlerTuning.budgetMs);
    if (!snapshot) return BUSY;
    if (snapshot.error) return loadFailure(snapshot);
    return {
      ok: true as const,
      mode: snapshot.mode,
      root: snapshot.root,
      beadsDir: snapshot.beadsDir,
      prefix: snapshot.prefix,
      bdFound: Boolean(findBd()),
      counts: snapshot.counts,
      warnings: snapshot.warnings,
      revision: snapshot.revision,
      ...staleOf(snapshot),
    };
  });
}

/**
 * What the panel polls. Deliberately runs no bd and waits for nothing; the
 * first poll for a project this process has not seen warms it after replying.
 */
export function revision(input: RpcInput<typeof revisionRpc>, ctx: Ctx): Promise<RpcOutput<typeof revisionRpc>> {
  return guarded("beads.revision", async () => {
    const loc = await locate(ctx, input.workspaceId);
    if (!loc.ok) return loc;
    warmProject(loc.root, loc.beadsDir);
    return {
      ok: true as const,
      revision: revisionOf(loc.beadsDir),
      export: exportStatus(loc.beadsDir),
      loadError: loadErrorOf(loc.beadsDir),
    };
  });
}

export function tree(input: RpcInput<typeof treeRpc>, ctx: Ctx): Promise<RpcOutput<typeof treeRpc>> {
  return guarded("beads.tree", async () => {
    const loc = await locate(ctx, input.workspaceId);
    if (!loc.ok) return loc;
    // A client holding the disk copy's revision waits for bd instead of being told "unchanged".
    const snapshot = await snapshotWithin(loc, handlerTuning.budgetMs, { have: input.have });
    if (!snapshot) return BUSY;
    if (snapshot.error) return { ...loadFailure(snapshot), project: loc.root };
    const { have, deltas } = input;
    // A client already holding this revision is told so instead of getting
    // the same rows again. Never for a stale answer: that one has to arrive.
    if (have && have === snapshot.revision && !snapshot.stale) {
      if (deltas) return { ok: true as const, unchanged: true as const, revision: snapshot.revision, mode: snapshot.mode };
      return {
        ok: true as const,
        unchanged: true as const,
        revision: snapshot.revision,
        counts: snapshot.counts,
        mode: snapshot.mode,
        export: exportStatus(loc.beadsDir),
      };
    }
    const head = {
      ok: true as const,
      unchanged: false as const,
      mode: snapshot.mode,
      root: snapshot.root,
      beadsDir: snapshot.beadsDir,
      prefix: snapshot.prefix,
      revision: snapshot.revision,
      counts: snapshot.counts,
      warnings: snapshot.warnings,
    };
    // A stale answer (the last good set after a failed load) always arrives
    // in full, whatever the client holds.
    if (snapshot.stale) return { ...head, issues: rowsOf(snapshot.issues).rows, stale: snapshot.stale };
    if (!deltas) return { ...head, issues: rowsOf(snapshot.issues).rows };
    // What this client will hold after the reply: a base for its next ask.
    remember(loc.beadsDir, snapshot.revision, snapshot.mode, snapshot.issues);
    const delta = have ? deltaFrom(loc.beadsDir, have, snapshot.mode, snapshot.issues) : null;
    if (delta) return { ...head, delta: true as const, base: have!, upsert: delta.upsert, removed: delta.removed };
    return { ...head, issues: rowsOf(snapshot.issues).rows };
  });
}

export function issue(input: RpcInput<typeof issueRpc>, ctx: Ctx): Promise<RpcOutput<typeof issueRpc>> {
  return guarded("beads.issue", async () => {
    const loc = await locate(ctx, input.workspaceId);
    if (!loc.ok) return loc;
    const started = Date.now();
    const snapshot = await snapshotWithin(loc, handlerTuning.budgetMs);
    if (!snapshot) return BUSY;
    if (snapshot.error) return loadFailure(snapshot);
    const r = await within(issueCard(snapshot, input.id), handlerTuning.budgetMs - (Date.now() - started));
    if (!r.done) return BUSY;
    if (!r.value) return { ok: false as const, code: "not_found", id: input.id };
    return { ok: true as const, revision: snapshot.revision, issue: r.value, ...staleOf(snapshot) };
  });
}

export function search(input: RpcInput<typeof searchRpc>, ctx: Ctx): Promise<RpcOutput<typeof searchRpc>> {
  return guarded("beads.search", async () => {
    const loc = await locate(ctx, input.workspaceId);
    if (!loc.ok) return loc;
    const snapshot = await snapshotWithin(loc, handlerTuning.budgetMs);
    if (!snapshot) return BUSY;
    if (snapshot.error) return loadFailure(snapshot);
    const ids = searchIssues(snapshot, input.q, SEARCH_LIMIT);
    return { ok: true as const, q: input.q, ids, truncated: ids.length >= SEARCH_LIMIT, ...staleOf(snapshot) };
  });
}

// ── writes ─────────────────────────────────────────────────────────────

/**
 * The shared tail of every write: drop the superseded snapshot, reload once
 * (so the reply carries rebuilt relations and the next tree is a cache hit),
 * answer with the card, and queue the export. If the reload fails the write
 * still happened: ok:true with the last good card marked stale, or null.
 */
async function afterWrite(loc: Located, id: string, started: number) {
  invalidateProject(loc.beadsDir);
  const remaining = handlerTuning.budgetMs - (Date.now() - started);
  const fresh = await snapshotWithin(loc, remaining, { fresh: true });
  if (!fresh) {
    requestExport(loc.root, loc.beadsDir);
    return { ok: true as const, revision: revisionOf(loc.beadsDir), issue: null, reloading: true };
  }
  const card = fresh.error ? null : await issueCard(fresh, id);
  // Last thing before the reply, as close to the reference's "after the
  // reply" as an RPC gets: the revision the client is handed is the one the
  // export will announce as supersededFrom.
  requestExport(loc.root, loc.beadsDir);
  return { ok: true as const, revision: fresh.revision, issue: card, ...staleOf(fresh) };
}

/**
 * The snapshot a write plans against, or the Failure that stops it before bd
 * is asked. Never the disk cache's older copy: a plan diffs against what the
 * issue is now.
 */
async function writeBase(loc: Located): Promise<Snapshot | Failure> {
  const snapshot = await snapshotWithin(loc, handlerTuning.budgetMs, { fresh: true });
  if (!snapshot) return BUSY;
  if (snapshot.error) return { ok: false, code: snapshot.error.code, message: snapshot.error.message };
  return snapshot;
}

export function edit(input: RpcInput<typeof editRpc>, ctx: Ctx): Promise<RpcOutput<typeof editRpc>> {
  return guarded("beads.edit", async () => {
    const started = Date.now();
    const loc = await locate(ctx, input.workspaceId);
    if (!loc.ok) return loc;
    const snapshot = await writeBase(loc);
    if ("ok" in snapshot) return snapshot;
    const planned = planEdit(snapshot, input.id, input.fields);
    if (!planned.ok) return planned;
    const applied = await runEdit(loc.root, input.id, planned.plan);
    if (!applied.ok) {
      log(`beads.edit: bd failed, exit ${applied.exitCode}`);
      return applied;
    }
    return afterWrite(loc, input.id, started);
  });
}

export function create(input: RpcInput<typeof createRpc>, ctx: Ctx): Promise<RpcOutput<typeof createRpc>> {
  return guarded("beads.create", async () => {
    const started = Date.now();
    const loc = await locate(ctx, input.workspaceId);
    if (!loc.ok) return loc;
    const snapshot = await writeBase(loc);
    if ("ok" in snapshot) return snapshot;
    const planned = planCreate(snapshot, input.fields);
    if (!planned.ok) return planned;
    const made = await runCreate(loc.root, planned.args);
    if (!made.ok) {
      log(`beads.create: ${made.code}, exit ${made.exitCode}`);
      return made;
    }
    // bd, not the caller, decides the id the panel has to select.
    return { ...(await afterWrite(loc, made.id, started)), id: made.id };
  });
}

export function comment(input: RpcInput<typeof commentRpc>, ctx: Ctx): Promise<RpcOutput<typeof commentRpc>> {
  return guarded("beads.comment", async () => {
    const started = Date.now();
    const loc = await locate(ctx, input.workspaceId);
    if (!loc.ok) return loc;
    const snapshot = await writeBase(loc);
    if ("ok" in snapshot) return snapshot;
    const planned = planComment(snapshot, input.id, input.text, input.author);
    if (!planned.ok) return planned;
    const added = await runComment(loc.root, input.id, planned.text, planned.author);
    if (!added.ok) {
      log(`beads.comment: bd failed, exit ${added.exitCode}`);
      return added;
    }
    return afterWrite(loc, input.id, started);
  });
}

export function exportNow(input: RpcInput<typeof exportRpc>, ctx: Ctx): Promise<RpcOutput<typeof exportRpc>> {
  return guarded("beads.export", async () => {
    const loc = await locate(ctx, input.workspaceId);
    if (!loc.ok) return loc;
    requestExport(loc.root, loc.beadsDir);
    return { ok: true as const, export: exportStatus(loc.beadsDir) };
  });
}

export function sync(input: RpcInput<typeof syncRpc>, ctx: Ctx): Promise<RpcOutput<typeof syncRpc>> {
  return guarded("beads.sync", async () => {
    const loc = await locate(ctx, input.workspaceId);
    if (!loc.ok) return loc;
    // Same background slot as the export, so a sync and a save cannot overlap.
    requestSync(loc.root, loc.beadsDir);
    return { ok: true as const, export: exportStatus(loc.beadsDir) };
  });
}

export function jobStatus(input: RpcInput<typeof jobStatusRpc>, ctx: Ctx): Promise<RpcOutput<typeof jobStatusRpc>> {
  return guarded("beads.job-status", async () => {
    const loc = await locate(ctx, input.workspaceId);
    if (!loc.ok) return loc;
    return { ok: true as const, export: exportStatus(loc.beadsDir) };
  });
}

// ── lifecycle ──────────────────────────────────────────────────────────

/**
 * A workspace was archived: forget its project's snapshot, in memory and on
 * disk — unless another workspace this process has seen opens the same
 * `.beads`. One it has not seen (opened before a restart, not asked since)
 * may share it too; then its next open is a cold load, nothing worse.
 */
export function workspaceArchived(workspace: { id: string; cwd: string }): void {
  try {
    let beadsDir = seen.get(workspace.id) ?? null;
    seen.delete(workspace.id);
    if (!beadsDir) {
      const verdict = resolveProject(workspace.cwd);
      if (verdict.ok) beadsDir = verdict.beadsDir;
    }
    if (!beadsDir) return;
    for (const other of seen.values()) if (other === beadsDir) return;
    forgetProject(beadsDir);
    log("disk cache: a workspace was archived, its project's snapshot dropped");
  } catch (err) {
    log(`workspace.archived failed: ${(err as Error)?.message ?? String(err)}`);
  }
}

/** Tests only. */
export function forgetWorkspacesForTests(): void {
  seen.clear();
}
