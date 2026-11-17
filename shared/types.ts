/**
 * The shapes the server hands the panel, as zod schemas (the RPC output
 * contracts) and their inferred types (what the client works with).
 *
 * The daemon parses every RPC output with these schemas and zod objects strip
 * unknown keys, so a field the server sends but this file does not declare
 * never reaches the client. Add it here first.
 */

import { z } from "zod";

const str = z.string().nullable();

export const ModeSchema = z.enum(["bd", "jsonl"]);
export type Mode = z.infer<typeof ModeSchema>;

export const CountsSchema = z.object({
  total: z.number(),
  byStatus: z.record(z.string(), z.number()),
  byType: z.record(z.string(), z.number()),
  ready: z.number(),
  blocked: z.number(),
});
export type Counts = z.infer<typeof CountsSchema>;

/** A failed load standing in for itself with the last good snapshot. */
export const StaleSchema = z.object({ code: z.string(), message: z.string(), at: z.number() });
export type Stale = z.infer<typeof StaleSchema>;

export const LastImportSchema = z.object({
  at: z.number(),
  changed: z.number(),
  added: z.number(),
  skippedStale: z.number(),
  error: str,
  noFile: z.boolean().optional(),
});
export type LastImport = z.infer<typeof LastImportSchema>;

/** The background export/sync job of one project. */
export const ExportStatusSchema = z.object({
  running: z.boolean(),
  pending: z.boolean(),
  lastOkAt: z.number().nullable(),
  lastError: str,
  lastDurationMs: z.number().nullable(),
  runs: z.number(),
  /** Revision the file had before the last successful export… */
  supersededFrom: str,
  /** …and after it: the pair names two revisions holding the same data. */
  revision: str,
  lastImport: LastImportSchema.nullable(),
  syncing: z.boolean(),
  stale: z.boolean(),
});
export type ExportStatus = z.infer<typeof ExportStatusSchema>;

/** A tree row: what the tree, filters, badges and charts need — no heavy text. */
export const TreeRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  priority: z.number().nullable(),
  issue_type: z.string(),
  parent: str,
  labels: z.array(z.string()),
  assignee: str,
  owner: str,
  created_at: str,
  created_by: str,
  updated_at: str,
  started_at: str,
  closed_at: str,
  dependency_count: z.number(),
  dependent_count: z.number(),
  comment_count: z.number(),
  /** Active (not yet closed) blockers. */
  blockers: z.array(z.string()),
  ready: z.boolean(),
});
export type TreeRow = z.infer<typeof TreeRowSchema>;

export const RefSchema = z.object({
  id: z.string(),
  type: z.string(),
  title: str,
  status: str,
  issue_type: str,
  missing: z.boolean(),
});
export type Ref = z.infer<typeof RefSchema>;

export const OtherRefSchema = RefSchema.extend({ direction: z.enum(["in", "out"]) });
export type OtherRef = z.infer<typeof OtherRefSchema>;

export const RelationsSchema = z.object({
  parent: RefSchema.nullable(),
  children: z.array(RefSchema),
  blockedBy: z.array(RefSchema),
  blocking: z.array(RefSchema),
  discoveredFrom: z.array(RefSchema),
  discovered: z.array(RefSchema),
  other: z.array(OtherRefSchema),
});
export type Relations = z.infer<typeof RelationsSchema>;

export const CommentSchema = z.object({
  id: str,
  author: str,
  text: z.string(),
  created_at: str,
});
export type Comment = z.infer<typeof CommentSchema>;

/** The full card: every field, relations both ways, the comment thread. */
export const CardSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: str,
  design: str,
  acceptance_criteria: str,
  notes: str,
  status: z.string(),
  priority: z.number().nullable(),
  issue_type: z.string(),
  owner: str,
  assignee: str,
  external_ref: str,
  spec_id: str,
  labels: z.array(z.string()),
  created_at: str,
  created_by: str,
  updated_at: str,
  started_at: str,
  closed_at: str,
  close_reason: str,
  defer_until: str,
  parent: str,
  dependency_count: z.number(),
  dependent_count: z.number(),
  comment_count: z.number(),
  /** Active blockers, as on the tree row. */
  blockers: z.array(z.string()),
  activeBlockers: z.array(z.string()),
  ready: z.boolean(),
  relations: RelationsSchema,
  comments: z.array(CommentSchema),
  commentsAvailable: z.boolean(),
  mode: ModeSchema,
});
export type Card = z.infer<typeof CardSchema>;

/**
 * An expected failure. `code` is one of the reference's codes (no_beads,
 * not_found, bad_priority, …) plus Paseo's own: unknown_workspace, busy.
 */
export const FailureSchema = z.object({
  ok: z.literal(false),
  code: z.string(),
  message: z.string().optional(),
  /** Empty states: the directory that was looked at. */
  project: z.string().nullable().optional(),
  bdFound: z.boolean().optional(),
  beadsDir: z.string().optional(),
  /** Write failures: bd's exit code. */
  exitCode: z.number().nullable().optional(),
  id: z.string().optional(),
});
export type Failure = z.infer<typeof FailureSchema>;

/** Fields an edit may carry; the server validates each (see planEdit). */
export interface EditFields {
  title?: string;
  issue_type?: string;
  priority?: number;
  assignee?: string;
  external_ref?: string;
  /** "" detaches from the parent. */
  parent?: string;
  description?: string;
  design?: string;
  acceptance_criteria?: string;
  notes?: string;
  addLabels?: string[];
  removeLabels?: string[];
  status?: string;
  close_reason?: string;
}

/** Fields a new issue may carry; `title` is required. */
export interface CreateFields {
  title: string;
  issue_type?: string;
  priority?: number | null;
  assignee?: string;
  external_ref?: string;
  parent?: string;
  description?: string;
  design?: string;
  acceptance_criteria?: string;
  notes?: string;
  labels?: string[];
}
