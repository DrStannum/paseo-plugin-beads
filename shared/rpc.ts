/**
 * RPC contracts between the panel and the plugin server — the port of the
 * reference's HTTP routes (/health /rev /tree /issue /search, POST /issue
 * /create /comment /export /sync).
 *
 * Every input names the workspace; the server asks the daemon for its
 * directory itself and never takes a path from the client. Every output is a
 * union of {ok:true, …} and Failure: a thrown error reaches the client only as
 * a bare string, so expected failures are returned, not thrown.
 */

import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import {
  CardSchema,
  CountsSchema,
  ExportStatusSchema,
  FailureSchema,
  ModeSchema,
  StaleSchema,
  TreeRowSchema,
} from "./types.ts";

/** Every call names the workspace; the server resolves its directory itself. */
export const WorkspaceInput = z.object({ workspaceId: z.string().min(1) });

const stale = { stale: StaleSchema.optional() };

export const pingRpc = defineRpc({
  name: "beads.ping",
  input: WorkspaceInput,
  output: z.union([
    z.object({ ok: z.literal(true), directory: z.string(), bd: z.string().nullable() }),
    FailureSchema,
  ]),
});

/** Port of GET /health: mode, where .beads is, counts, warnings. Runs `bd list` if needed. */
export const healthRpc = defineRpc({
  name: "beads.health",
  input: WorkspaceInput,
  output: z.union([
    z.object({
      ok: z.literal(true),
      mode: ModeSchema,
      root: z.string(),
      beadsDir: z.string(),
      prefix: z.string().nullable(),
      bdFound: z.boolean(),
      counts: CountsSchema,
      warnings: z.array(z.string()),
      revision: z.string(),
      ...stale,
    }),
    FailureSchema,
  ]),
});

/**
 * Port of GET /rev: the cheap change marker the panel polls. Never runs bd;
 * carries the background job's status and the last failed load.
 */
export const revisionRpc = defineRpc({
  name: "beads.revision",
  input: WorkspaceInput,
  output: z.union([
    z.object({
      ok: z.literal(true),
      revision: z.string(),
      export: ExportStatusSchema,
      loadError: StaleSchema.nullable(),
    }),
    FailureSchema,
  ]),
});

/**
 * Port of GET /tree[?have=rev], plus deltas. Three answers to a client that
 * names the revision it holds (`have`):
 *
 * - `unchanged` — `have` is current: a few bytes, no rows.
 * - a delta (`delta: true`) — only for `deltas: true`, when the server still
 *   remembers `have`'s rows and few of them moved: the rows changed or added
 *   since `base` (= `have`) and the ids removed. Apply it only on top of
 *   `base`; on any other revision ask again without `have`.
 * - the full set — the first load, an unknown `have`, a big gap, a stale
 *   answer (the last good snapshot after a failed load).
 *
 * Without `deltas` the answers are the original two, unchanged keeps
 * `counts` and `export`; with it, unchanged drops them (the revision poll
 * carries the export, and the counts are those of the rows already held).
 */
export const treeRpc = defineRpc({
  name: "beads.tree",
  input: WorkspaceInput.extend({ have: z.string().optional(), deltas: z.boolean().optional() }),
  output: z.union([
    z.object({
      ok: z.literal(true),
      unchanged: z.literal(true),
      revision: z.string(),
      mode: ModeSchema,
      counts: CountsSchema.optional(),
      export: ExportStatusSchema.optional(),
    }),
    z.object({
      ok: z.literal(true),
      unchanged: z.literal(false),
      delta: z.literal(true),
      base: z.string(),
      mode: ModeSchema,
      root: z.string(),
      beadsDir: z.string(),
      prefix: z.string().nullable(),
      revision: z.string(),
      counts: CountsSchema,
      warnings: z.array(z.string()),
      upsert: z.array(TreeRowSchema),
      removed: z.array(z.string()),
    }),
    z.object({
      ok: z.literal(true),
      unchanged: z.literal(false),
      mode: ModeSchema,
      root: z.string(),
      beadsDir: z.string(),
      prefix: z.string().nullable(),
      revision: z.string(),
      counts: CountsSchema,
      warnings: z.array(z.string()),
      issues: z.array(TreeRowSchema),
      ...stale,
    }),
    FailureSchema,
  ]),
});

/** Port of GET /issue: the full card. */
export const issueRpc = defineRpc({
  name: "beads.issue",
  input: WorkspaceInput.extend({ id: z.string().min(1) }),
  output: z.union([
    z.object({ ok: z.literal(true), revision: z.string(), issue: CardSchema, ...stale }),
    FailureSchema,
  ]),
});

/** Port of GET /search: ids whose heavy text matches. */
export const searchRpc = defineRpc({
  name: "beads.search",
  input: WorkspaceInput.extend({ q: z.string() }),
  output: z.union([
    z.object({ ok: z.literal(true), q: z.string(), ids: z.array(z.string()), truncated: z.boolean(), ...stale }),
    FailureSchema,
  ]),
});

/**
 * The fields travel loosely typed on purpose: the server validates each one
 * and answers with a precise code (bad_priority, bad_status, …), where a zod
 * rejection here would reach the client as a bare error string.
 * See EditFields / CreateFields in ./types.ts for what is accepted.
 */
const Fields = z.record(z.string(), z.unknown());

/** The answer to every write that changes an issue: the fresh card (null if the reload failed). */
const WrittenSchema = z.object({
  ok: z.literal(true),
  revision: z.string(),
  issue: CardSchema.nullable(),
  ...stale,
  /** The post-write reload did not finish in time; the write itself landed. */
  reloading: z.boolean().optional(),
});

/** Port of POST /issue. */
export const editRpc = defineRpc({
  name: "beads.edit",
  input: WorkspaceInput.extend({ id: z.string().min(1), fields: Fields }),
  output: z.union([WrittenSchema, FailureSchema]),
});

/** Port of POST /create: bd mints the id. */
export const createRpc = defineRpc({
  name: "beads.create",
  input: WorkspaceInput.extend({ fields: Fields }),
  output: z.union([WrittenSchema.extend({ id: z.string() }), FailureSchema]),
});

/** Port of POST /comment. `author` becomes the comment's --actor. */
export const commentRpc = defineRpc({
  name: "beads.comment",
  input: WorkspaceInput.extend({ id: z.string().min(1), text: z.string(), author: z.string().optional() }),
  output: z.union([WrittenSchema, FailureSchema]),
});

const JobSchema = z.union([z.object({ ok: z.literal(true), export: ExportStatusSchema }), FailureSchema]);

/** Port of POST /export: start (or queue) the background export; poll job-status. */
export const exportRpc = defineRpc({ name: "beads.export", input: WorkspaceInput, output: JobSchema });

/** Port of POST /sync: import the file, then export the database, in the background. */
export const syncRpc = defineRpc({ name: "beads.sync", input: WorkspaceInput, output: JobSchema });

/** The background job's status alone (beads.revision carries it too). */
export const jobStatusRpc = defineRpc({ name: "beads.job-status", input: WorkspaceInput, output: JobSchema });
