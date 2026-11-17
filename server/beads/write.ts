/**
 * Planning and running writes — port of planEdit / runEdit / planCreate /
 * runCreate / planComment / runComment.
 *
 * Planning is separate from running so every rejection happens before
 * anything runs: a request with one bad field changes nothing at all.
 */

import type { Snapshot } from "./snapshot.ts";
import { firstLine, runBdWrite, type BdResult } from "./run.ts";

/** Statuses beads knows. Anything else is passed through untouched. */
export const STATUSES = ["open", "in_progress", "blocked", "deferred", "closed"];

/**
 * Built-in issue types (`bd types`). A type already in use in the project
 * counts as valid too — a project may define types.custom, which we cannot read.
 */
export const ISSUE_TYPES = ["task", "bug", "feature", "chore", "epic", "decision", "spike", "story", "milestone"];

/** Short text fields that go straight onto `bd update`'s argv. */
const TEXT_FIELDS: Record<string, string> = {
  description: "-d",
  design: "--design",
  acceptance_criteria: "--acceptance",
  notes: "--notes",
};

/**
 * Ceiling on the text an edit may carry, summed over the four blocks. Every
 * text field travels as an argv element (bd has no stdin door for
 * --acceptance or --notes); Linux allows ~2 MB of argv.
 */
const MAX_TEXT_BYTES = 512 * 1024;

/** One comment: a tenth of an issue's text budget. */
const MAX_COMMENT_BYTES = 64 * 1024;

const MAX_AUTHOR_BYTES = 200;

export type Rejection = { ok: false; code: string; message: string };
export type WriteFailure = { ok: false; code: string; message: string; exitCode: number | null };

export interface EditPlan {
  reopen: boolean;
  args: string[];
  close: { reason: string } | null;
}

const bad = (code: string, message: string): Rejection => ({ ok: false, code, message });

const READ_ONLY: Rejection = bad(
  "read_only_mode",
  "this project has no beads database — issues.jsonl is bd's to write, not ours",
);

function labelList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((l): l is string => typeof l === "string" && l.trim() !== "").map((l) => l.trim());
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

/** Would making `candidate` the parent of `id` close a loop? */
function isDescendant(snapshot: Snapshot, candidate: string, id: string): boolean {
  let cur = snapshot.byId.get(candidate);
  let guard = 0;
  while (cur && guard++ < 512) {
    if (cur.id === id) return true;
    cur = cur.parent ? snapshot.byId.get(cur.parent) : undefined;
  }
  return false;
}

function knownType(snapshot: Snapshot, v: unknown): v is string {
  return typeof v === "string" && (ISSUE_TYPES.includes(v) || snapshot.counts.byType[v] != null);
}

/**
 * Turn changed fields into the exact `bd` calls. A status change routes
 * through `bd close` / `bd reopen`, the commands that keep closed_at and
 * close_reason honest.
 */
export function planEdit(snapshot: Snapshot, id: string, fields: unknown): { ok: true; plan: EditPlan } | Rejection {
  const issue = snapshot.byId.get(id);
  if (!issue) return bad("not_found", `no issue ${id} in this project`);
  if (snapshot.mode !== "bd") return READ_ONLY;
  if (!isPlainObject(fields)) return bad("bad_fields", "fields must be an object");

  const args: string[] = [];

  if ("title" in fields) {
    if (typeof fields.title !== "string" || !fields.title.trim()) return bad("bad_title", "title must be a non-empty string");
    args.push("--title", fields.title);
  }
  if ("issue_type" in fields) {
    if (!knownType(snapshot, fields.issue_type)) return bad("bad_type", `unknown issue type "${String(fields.issue_type)}"`);
    args.push("-t", fields.issue_type);
  }
  if ("priority" in fields) {
    const v = fields.priority;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 4) {
      return bad("bad_priority", "priority must be an integer from 0 to 4");
    }
    args.push("-p", String(v));
  }
  if ("assignee" in fields) {
    if (typeof fields.assignee !== "string") return bad("bad_assignee", "assignee must be a string");
    args.push("-a", fields.assignee);
  }
  if ("external_ref" in fields) {
    if (typeof fields.external_ref !== "string") return bad("bad_external_ref", "external_ref must be a string");
    args.push("--external-ref", fields.external_ref);
  }
  if ("parent" in fields) {
    const v = fields.parent;
    if (typeof v !== "string") return bad("bad_parent", "parent must be a string");
    if (v === id) return bad("bad_parent", "an issue cannot be its own parent");
    if (v && !snapshot.byId.has(v)) return bad("bad_parent", `no issue ${v} in this project`);
    if (v && isDescendant(snapshot, v, id)) return bad("bad_parent", `${v} is below ${id} — that would close a loop`);
    args.push("--parent", v); // empty string is bd's own "detach from parent"
  }

  let bytes = 0;
  for (const [field, flag] of Object.entries(TEXT_FIELDS)) {
    if (!(field in fields)) continue;
    const v = fields[field];
    if (typeof v !== "string") return bad("bad_text", `${field} must be a string`);
    bytes += Buffer.byteLength(v, "utf8");
    args.push(flag, v);
  }
  if (bytes > MAX_TEXT_BYTES) {
    return bad("too_long", `the text fields add up to ${bytes} bytes, over the ${MAX_TEXT_BYTES} limit`);
  }

  for (const label of labelList(fields.addLabels)) args.push("--add-label", label);
  for (const label of labelList(fields.removeLabels)) args.push("--remove-label", label);

  let reopen = false;
  let close: { reason: string } | null = null;
  if ("status" in fields) {
    const v = fields.status;
    // The current status is always allowed through: a project using `pinned`
    // or a custom status must still be able to change its other fields.
    if (typeof v !== "string" || !(STATUSES.includes(v) || v === issue.status)) {
      return bad("bad_status", `unknown status "${String(v)}"`);
    }
    if (v !== issue.status) {
      if (v === "closed") {
        close = { reason: typeof fields.close_reason === "string" ? fields.close_reason : "" };
      } else if (issue.status === "closed") {
        reopen = true;
        // reopen always lands on `open`; anything else needs one more step.
        if (v !== "open") args.push("-s", v);
      } else {
        args.push("-s", v);
      }
    }
  }

  if (!args.length && !reopen && !close) return bad("no_changes", "nothing to change");
  return { ok: true, plan: { reopen, args, close } };
}

function failure(res: BdResult, what: string): WriteFailure {
  return {
    ok: false,
    code: "bd_failed",
    message: firstLine(res.stderr) || (res.timedOut ? `bd ${what} timed out` : `bd ${what} exited with ${res.code}`),
    exitCode: res.code,
  };
}

/** Execute a plan, stopping at the first failure. Order: reopen → update → close. */
export async function runEdit(root: string, id: string, plan: EditPlan): Promise<{ ok: true } | WriteFailure> {
  if (plan.reopen) {
    const res = await runBdWrite(root, ["reopen", id]);
    if (!res.ok) return failure(res, "reopen");
  }
  if (plan.args.length) {
    const res = await runBdWrite(root, ["update", id, ...plan.args]);
    if (!res.ok) return failure(res, "update");
  }
  if (plan.close) {
    const args = ["close", id];
    if (plan.close.reason) args.push("-r", plan.close.reason);
    const res = await runBdWrite(root, args);
    if (!res.ok) return failure(res, "close");
  }
  return { ok: true };
}

/**
 * A new-issue form into the `bd create` call. Close to planEdit and
 * deliberately not shared with it: create and update disagree on flag names,
 * on what is required and on what is expressible.
 */
export function planCreate(snapshot: Snapshot, fields: unknown): { ok: true; args: string[] } | Rejection {
  if (snapshot.mode !== "bd") return READ_ONLY;
  if (!isPlainObject(fields)) return bad("bad_fields", "fields must be an object");

  if (typeof fields.title !== "string" || !fields.title.trim()) return bad("bad_title", "title must be a non-empty string");
  // The title is positional; everything else is a flag.
  const args = [fields.title.trim()];

  if ("issue_type" in fields) {
    if (!knownType(snapshot, fields.issue_type)) return bad("bad_type", `unknown issue type "${String(fields.issue_type)}"`);
    args.push("-t", fields.issue_type);
  }
  if ("priority" in fields && fields.priority !== null) {
    const v = fields.priority;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 4) {
      return bad("bad_priority", "priority must be an integer from 0 to 4");
    }
    args.push("-p", String(v));
  }
  if ("assignee" in fields && fields.assignee) {
    if (typeof fields.assignee !== "string") return bad("bad_assignee", "assignee must be a string");
    args.push("-a", fields.assignee);
  }
  if ("external_ref" in fields && fields.external_ref) {
    if (typeof fields.external_ref !== "string") return bad("bad_external_ref", "external_ref must be a string");
    args.push("--external-ref", fields.external_ref);
  }
  if ("parent" in fields && fields.parent) {
    const v = fields.parent;
    if (typeof v !== "string") return bad("bad_parent", "parent must be a string");
    if (!snapshot.byId.has(v)) return bad("bad_parent", `no issue ${v} in this project`);
    args.push("--parent", v);
  }

  let bytes = 0;
  for (const [field, flag] of Object.entries(TEXT_FIELDS)) {
    if (!(field in fields)) continue;
    const v = fields[field];
    if (typeof v !== "string") return bad("bad_text", `${field} must be a string`);
    if (!v) continue; // an empty block is simply not passed
    bytes += Buffer.byteLength(v, "utf8");
    args.push(flag, v);
  }
  if (bytes > MAX_TEXT_BYTES) {
    return bad("too_long", `the text fields add up to ${bytes} bytes, over the ${MAX_TEXT_BYTES} limit`);
  }

  for (const label of labelList(fields.labels)) {
    // -l is comma-separated: a comma inside would silently make two labels.
    if (label.includes(",")) return bad("bad_label", `a label cannot contain a comma: "${label}"`);
    args.push("-l", label);
  }
  return { ok: true, args };
}

/** `bd create --json` answers with one object (update answers with an array). */
export async function runCreate(root: string, args: string[]): Promise<{ ok: true; id: string } | WriteFailure> {
  const res = await runBdWrite(root, ["create", ...args]);
  if (!res.ok) return failure(res, "create");
  let id: string | null = null;
  try {
    const parsed = JSON.parse(res.stdout || "null");
    if (parsed && typeof parsed.id === "string") id = parsed.id;
    else if (Array.isArray(parsed) && parsed[0] && typeof parsed[0].id === "string") id = parsed[0].id;
  } catch {
    // without an id the caller cannot go on — reported below
  }
  if (!id) return { ok: false, code: "bad_json", message: "bd create did not report the new issue id", exitCode: res.code };
  return { ok: true, id };
}

/**
 * Check a comment before anything runs. `author`, if given, becomes the
 * comment's --actor; blank falls through to the plugin's own identity.
 */
export function planComment(
  snapshot: Snapshot, id: string, text: unknown, author?: unknown,
): { ok: true; text: string; author: string | undefined } | Rejection {
  if (snapshot.mode !== "bd") {
    return bad("read_only_mode", "this project has no beads database — comments live in it, not in issues.jsonl");
  }
  if (!snapshot.byId.has(id)) return bad("not_found", `no issue ${id} in this project`);
  if (typeof text !== "string" || !text.trim()) return bad("bad_comment", "a comment must be a non-empty string");
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > MAX_COMMENT_BYTES) return bad("too_long", `the comment is ${bytes} bytes, over the ${MAX_COMMENT_BYTES} limit`);
  if (author != null && typeof author !== "string") return bad("bad_author", "author must be a string");
  const trimmed = author ? (author as string).trim() : "";
  if (Buffer.byteLength(trimmed, "utf8") > MAX_AUTHOR_BYTES) {
    return bad("too_long", `author is over the ${MAX_AUTHOR_BYTES}-byte limit`);
  }
  return { ok: true, text, author: trimmed || undefined };
}

/** `bd comment <id> <text>`; the text is one argv element, so a multi-line body stays one comment. */
export async function runComment(root: string, id: string, text: string, author?: string): Promise<{ ok: true } | WriteFailure> {
  const res = await runBdWrite(root, ["comment", id, text], { actor: author });
  if (!res.ok) return failure(res, "comment");
  return { ok: true };
}
