/**
 * The explorer's compact view, the pure half: which issues are the reader's,
 * how they split into "in progress" and "ready", what the quick search keeps,
 * the counts, and what the explorer panel remembers (client/explorer.tsx
 * draws it).
 *
 * "Mine" is the assignee being the reader's name from the plugin settings
 * (the same value "Assign to me" writes), compared trimmed and without case.
 * "Ready" is the tree's own rule (readinessOf: open, every blocker closed —
 * `bd ready`), so the explorer and the tab's readiness filter never disagree.
 */

import { z } from "zod";
import { naturalCmp, readinessOf } from "./charts/rows.ts";
import type { TreeRow } from "./types.ts";

export type Section = "doing" | "ready";
/** Top to bottom: what is in hand, then what to pick up next. */
export const SECTIONS: readonly Section[] = ["doing", "ready"];
/** Rows a section shows before "N more" (and per press of it). */
export const EXPLORER_PAGE = 30;

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** Assigned to the reader. A blank name owns nothing. */
export function isMine(row: Pick<TreeRow, "assignee">, me: string): boolean {
  const who = norm(me);
  return Boolean(who) && norm(row.assignee) === who;
}

/** Which section an issue belongs to, or null (closed, blocked, deferred, open with blockers). */
export function sectionOf(row: Pick<TreeRow, "status" | "ready" | "blockers">): Section | null {
  if (row.status === "in_progress") return "doing";
  if (readinessOf(row) === "ready") return "ready";
  return null;
}

/** Most urgent first (no priority last), then by id the natural way. */
export function compareMine(a: Pick<TreeRow, "priority" | "id">, b: Pick<TreeRow, "priority" | "id">): number {
  const pa = a.priority ?? 99;
  const pb = b.priority ?? 99;
  return pa - pb || naturalCmp(a.id, b.id);
}

/**
 * The quick search: every word in the id or the title, or a hit of the
 * server's full-text search for this query (`hits`, null while there is none).
 */
export function matchesQuery(row: Pick<TreeRow, "id" | "title">, query: string, hits: ReadonlySet<string> | null = null): boolean {
  const words = norm(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  if (hits && hits.has(row.id)) return true;
  const text = `${row.id} ${row.title}`.toLowerCase();
  return words.every((w) => text.indexOf(w) >= 0);
}

export interface ExplorerCounts {
  /** Mine, in progress. */
  doing: number;
  /** Mine, ready to pick up. */
  ready: number;
  /** Mine and not closed, whatever the state (blocked and deferred too). */
  open: number;
}

export interface ExplorerView {
  /** The rows each section shows, sorted; the search applied. */
  sections: Record<Section, TreeRow[]>;
  /** Before the search: the reader's own numbers. */
  counts: ExplorerCounts;
}

/** The reader's in-progress and ready issues of a tree, searched and counted. */
export function explorerView(rows: readonly TreeRow[], opts: { me: string; query?: string; hits?: ReadonlySet<string> | null }): ExplorerView {
  const sections: Record<Section, TreeRow[]> = { doing: [], ready: [] };
  const counts: ExplorerCounts = { doing: 0, ready: 0, open: 0 };
  if (!norm(opts.me)) return { sections, counts };
  const query = opts.query ?? "";
  for (const row of rows) {
    if (!isMine(row, opts.me)) continue;
    if (row.status !== "closed") counts.open++;
    const s = sectionOf(row);
    if (!s) continue;
    counts[s]++;
    if (matchesQuery(row, query, opts.hits ?? null)) sections[s].push(row);
  }
  sections.doing.sort(compareMine);
  sections.ready.sort(compareMine);
  return { sections, counts };
}

/**
 * What an explorer panel remembers (its own tab state, apart from the tab's):
 * the search and the folded sections. Each field falls back on its own.
 */
export const ExplorerStateSchema = z.preprocess(
  (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {}),
  z.object({
    query: z.string().catch(""),
    collapsed: z
      .array(z.string())
      .transform((list) => SECTIONS.filter((s) => list.indexOf(s) >= 0))
      .catch([]),
  }),
);
export type ExplorerState = { query: string; collapsed: Section[] };
export const EXPLORER_DEFAULT: ExplorerState = { query: "", collapsed: [] };
