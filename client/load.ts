/**
 * The pure half of the data layer: how one beads.tree / beads.issue answer is
 * folded into the state on screen, and the constants of the loading cadence.
 * No React here, so the tests can run it under node.
 */

import { changedIds } from "../shared/tree.ts";
import type { Card, Counts, ExportStatus, Failure, Mode, Stale, TreeRow } from "../shared/types.ts";

/** Poll interval choices and default: part of the host settings (shared/settings.ts). */
export { POLL_CHOICES, POLL_DEFAULT_MS } from "../shared/settings.ts";
/** Ceiling of the backoff after failures (or the chosen interval, if longer). */
export const POLL_BACKOFF_MAX_MS = 300000;
/** Workspaces whose last good tree stays cached between mounts. */
export const CACHE_PROJECTS = 8;
/** How long a row changed by a poll stays highlighted. */
export const FLASH_MS = 6000;
/** The server answered `busy` (bd still loading): ask again this soon. */
export const BUSY_RETRY_MS = 1500;
/** How long an unused tree / card lingers in the cache. */
export const TREE_GC_MS = 24 * 3600 * 1000;
export const CARD_GC_MS = 30 * 60 * 1000;

/** A full tree answer: what the panel draws from. */
export interface TreeData {
  mode: Mode;
  root: string;
  beadsDir: string;
  prefix: string | null;
  revision: string;
  counts: Counts;
  warnings: string[];
  issues: TreeRow[];
}

/** Why the rows on screen may be behind: a refresh that failed, or the backend's last good copy. */
export interface LoadIssue {
  kind: "failed" | "backend";
  code?: string;
  message?: string;
}

export interface TreeState {
  /** The last good full answer; null until one arrived. */
  tree: TreeData | null;
  revision: string | null;
  /** Why there is nothing to draw — only while `tree` is null. */
  empty: Failure | null;
  loadIssue: LoadIssue | null;
  /** The server is still loading bd (it answered `busy`); a retry is due. */
  busy: boolean;
  /** Consecutive failed rounds — what the poll backs off on. */
  failures: number;
  /** id → when a poll saw it change. */
  flashed: Record<string, number>;
  export: ExportStatus | null;
}

export const EMPTY: TreeState = {
  tree: null, revision: null, empty: null, loadIssue: null, busy: false, failures: 0, flashed: {}, export: null,
};

/** Reasons that may be answered "nothing changed"; a button press always fetches. */
export type LoadReason = "project" | "revalidate" | "poll" | "manual" | "save";
export const SOFT: readonly LoadReason[] = ["project", "revalidate", "poll"];

export function treeKey(hostId: string, workspaceId: string) {
  return ["beads", hostId, workspaceId, "tree"] as const;
}
export function cardKey(hostId: string, workspaceId: string, id: string) {
  return ["beads", hostId, workspaceId, "card", id] as const;
}

function messageOf(err: unknown): string {
  return err && typeof err === "object" && "message" in err ? String((err as Error).message) : String(err);
}

function keepFlashes(flashed: Record<string, number>, now: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of Object.keys(flashed)) if (now - flashed[id]! < FLASH_MS) out[id] = flashed[id]!;
  return out;
}

/**
 * One beads.tree round, folded into the state on screen. Pure apart from the
 * call: exported for the tests.
 */
export async function runTree(
  prev: TreeState | undefined,
  reason: LoadReason,
  workspaceId: string,
  call: (input: { workspaceId: string; have?: string }) => Promise<unknown>,
  now: () => number = Date.now,
): Promise<TreeState> {
  const p = prev ?? EMPTY;
  const soft = SOFT.indexOf(reason) >= 0;
  const have = soft && p.tree && p.revision ? p.revision : undefined;
  let res: any;
  try {
    res = await call(have ? { workspaceId, have } : { workspaceId });
  } catch (err) {
    res = { ok: false, code: "internal", message: messageOf(err) };
  }
  if (!res || !res.ok) {
    const fail: Failure = res && typeof res.code === "string" ? res : { ok: false, code: "internal" };
    if (fail.code === "busy") return { ...p, busy: true };
    const failures = Math.min(p.failures + 1, 16);
    if (p.tree) {
      // A blip must not cost the reader the list they are reading.
      return { ...p, busy: false, failures, loadIssue: { kind: "failed", code: fail.code, message: fail.message } };
    }
    return { ...EMPTY, empty: fail, failures, export: p.export };
  }
  if (res.unchanged) {
    // Only offered when there is a tree; an answer without one asks again in full.
    if (!p.tree) return runTree(p, "manual", workspaceId, call, now);
    return { ...p, revision: res.revision, busy: false, failures: 0, loadIssue: null, export: res.export ?? p.export };
  }
  const data: TreeData = {
    mode: res.mode, root: res.root, beadsDir: res.beadsDir, prefix: res.prefix, revision: res.revision,
    counts: res.counts, warnings: res.warnings ?? [], issues: res.issues ?? [],
  };
  const stale: Stale | undefined = res.stale;
  const loadIssue: LoadIssue | null = stale ? { kind: "backend", code: stale.code, message: stale.message } : null;
  // A stale answer is a failure the backend absorbed: keep backing off.
  const failures = stale ? Math.min(p.failures + 1, 16) : 0;
  const t = now();
  if (p.tree && soft && data.revision === p.revision) {
    // Nothing moved: keep the very object on screen, so nothing repaints.
    return { ...p, busy: false, failures, loadIssue, empty: null };
  }
  let flashed = keepFlashes(p.flashed, t);
  if (p.tree && (reason === "poll" || reason === "revalidate")) {
    const moved = changedIds(p.tree.issues, data.issues);
    if (moved.length) {
      flashed = { ...flashed };
      for (const id of moved) flashed[id] = t;
    }
  }
  return { tree: data, revision: data.revision, empty: null, loadIssue, busy: false, failures, flashed, export: p.export };
}

// ── cards ─────────────────────────────────────────────────────────────

export interface CardState {
  card: Card | null;
  /** The revision the card was read at. */
  revision: string | null;
  /** The last reload failed (or came back stale): the copy shown may be behind. */
  note: { code?: string; message?: string } | null;
  /** Never loaded. */
  failed: boolean;
}

/** One beads.issue round, folded over the copy on screen (exported for the tests). */
export async function runCard(prev: CardState | undefined, workspaceId: string, id: string, call: (input: { workspaceId: string; id: string }) => Promise<unknown>): Promise<CardState> {
  let res: any;
  try {
    res = await call({ workspaceId, id });
  } catch (err) {
    res = { ok: false, code: "internal", message: messageOf(err) };
  }
  if (res && res.ok && res.issue) {
    const note = res.stale ? { code: res.stale.code, message: res.stale.message } : null;
    // Same content: keep the object on screen so nothing repaints.
    const same = prev?.card && JSON.stringify(prev.card) === JSON.stringify(res.issue);
    return { card: same ? prev!.card : res.issue, revision: res.revision, note, failed: false };
  }
  const note = { code: res?.code, message: res?.message };
  if (prev?.card) return { ...prev, note };
  if (res?.code === "busy") throw Object.assign(new Error("busy"), { busy: true });
  return { card: null, revision: null, note, failed: true };
}

