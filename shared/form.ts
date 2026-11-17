/**
 * The edit / create form as data (reference openEditor: computeFields,
 * isDirty, the option lists and the autocomplete suggestions). Pure, so the
 * diffing — the part that decides what bd is asked to overwrite — is tested
 * without a screen.
 *
 * Every field is held as the form shows it: text as a string ("" for none),
 * priority as a number or null, labels as a list. The original issue is
 * turned into the same shape once, so "changed" is a plain comparison.
 */

import { STATUS_ORDER } from "./charts/types.ts";
import type { Card, CreateFields, EditFields } from "./types.ts";

/** Types `bd update -t` accepts out of the box (reference EDIT_TYPES). */
export const EDIT_TYPES: readonly string[] = ["task", "bug", "feature", "chore", "epic", "decision", "spike", "story", "milestone"];

export interface IssueForm {
  title: string;
  issue_type: string;
  status: string;
  priority: number | null;
  assignee: string;
  external_ref: string;
  parent: string;
  labels: string[];
  /** Sent only when the status moves to closed. */
  close_reason: string;
  description: string;
  design: string;
  acceptance_criteria: string;
  notes: string;
}

/** The form an existing issue opens with. */
export function formFromCard(card: Card): IssueForm {
  return {
    title: card.title ?? "",
    issue_type: card.issue_type,
    status: card.status,
    priority: card.priority,
    assignee: card.assignee ?? "",
    external_ref: card.external_ref ?? "",
    parent: card.parent ?? "",
    labels: (card.labels ?? []).slice(),
    close_reason: card.status === "closed" ? card.close_reason ?? "" : "",
    description: card.description ?? "",
    design: card.design ?? "",
    acceptance_criteria: card.acceptance_criteria ?? "",
    notes: card.notes ?? "",
  };
}

/** A new issue: bd's own defaults (task, P2, open), optionally under a parent. */
export function blankForm(parent?: string | null): IssueForm {
  return {
    title: "", issue_type: "task", status: "open", priority: 2, assignee: "", external_ref: "",
    parent: parent ?? "", labels: [], close_reason: "",
    description: "", design: "", acceptance_criteria: "", notes: "",
  };
}

/**
 * What a save sends. Creating: everything the form holds (blank fields left
 * out). Editing: only the fields that changed — `bd update --notes` replaces
 * the whole field, so an untouched one is never sent back.
 */
export function computeFields(original: IssueForm, form: IssueForm, creating: true): CreateFields;
export function computeFields(original: IssueForm, form: IssueForm, creating: false): EditFields;
export function computeFields(original: IssueForm, form: IssueForm, creating: boolean): EditFields | CreateFields;
export function computeFields(original: IssueForm, form: IssueForm, creating: boolean): EditFields | CreateFields {
  if (creating) {
    const f: CreateFields = { title: form.title.trim(), issue_type: form.issue_type };
    if (form.priority != null) f.priority = form.priority;
    if (form.assignee.trim()) f.assignee = form.assignee.trim();
    if (form.external_ref.trim()) f.external_ref = form.external_ref.trim();
    if (form.parent.trim()) f.parent = form.parent.trim();
    if (form.labels.length) f.labels = form.labels.slice();
    if (form.description) f.description = form.description;
    if (form.design) f.design = form.design;
    if (form.acceptance_criteria) f.acceptance_criteria = form.acceptance_criteria;
    if (form.notes) f.notes = form.notes;
    return f;
  }
  const f: EditFields = {};
  const title = form.title.trim();
  if (title && title !== original.title) f.title = title;
  if (form.issue_type !== original.issue_type) f.issue_type = form.issue_type;
  if (form.status !== original.status) {
    f.status = form.status;
    if (form.status === "closed") f.close_reason = form.close_reason.trim();
  }
  // The select offers "unset" only when the issue had no priority, so null never goes out as a change.
  if (form.priority !== original.priority && form.priority != null) f.priority = form.priority;
  const text = (k: "assignee" | "external_ref" | "parent") => {
    const v = form[k].trim();
    if (v !== original[k]) f[k] = v;
  };
  text("assignee");
  text("external_ref");
  text("parent");
  const before = new Set(original.labels);
  const after = new Set(form.labels);
  const added = form.labels.filter((l) => !before.has(l));
  const removed = original.labels.filter((l) => !after.has(l));
  if (added.length) f.addLabels = added;
  if (removed.length) f.removeLabels = removed;
  for (const k of ["description", "design", "acceptance_criteria", "notes"] as const) {
    if (form[k] !== original[k]) f[k] = form[k];
  }
  return f;
}

/** Is there anything to save (and to lose)? Creating needs a title; editing, any change. */
export function isDirty(original: IssueForm, form: IssueForm, creating: boolean): boolean {
  if (creating) return Boolean(form.title.trim());
  return Object.keys(computeFields(original, form, false)).length > 0;
}

/**
 * Has the reader typed anything at all? Wider than isDirty when creating:
 * a description without a title is still work a stray click must not lose.
 */
export function hasInput(original: IssueForm, form: IssueForm, creating: boolean): boolean {
  if (!creating) return isDirty(original, form, false);
  return JSON.stringify(original) !== JSON.stringify(form);
}

/** Add a label (trimmed, once). */
export function addLabel(labels: readonly string[], label: string): string[] {
  const v = label.trim();
  if (!v || labels.indexOf(v) >= 0) return labels.slice();
  return labels.concat(v);
}

/** Options of the type select: bd's built-ins, the project's own, and the current one. */
export function typeChoices(projectTypes: readonly string[], current: string): string[] {
  const out = EDIT_TYPES.slice();
  for (const t of projectTypes.concat(current)) if (t && out.indexOf(t) < 0) out.push(t);
  return out;
}

/** Options of a status menu: bd's five in order, then any custom one in use, then the current. */
export function statusChoices(projectStatuses: readonly string[], current: string): string[] {
  const out = STATUS_ORDER.slice();
  for (const s of projectStatuses.concat(current)) if (s && out.indexOf(s) < 0) out.push(s);
  return out;
}

/**
 * Autocomplete: the entries containing the needle (case-insensitive), the
 * excluded ones dropped, at most `limit`.
 */
export function suggest(entries: readonly string[], needle: string, exclude: readonly string[] = [], limit = 50): string[] {
  const n = needle.trim().toLowerCase();
  const out: string[] = [];
  for (const e of entries) {
    if (exclude.indexOf(e) >= 0) continue;
    if (n && e.toLowerCase().indexOf(n) < 0) continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** Suggestions for the assignee: everyone assigned or owning something, sorted. */
export function peopleOf(rows: readonly { assignee: string | null; owner: string | null }[]): string[] {
  const set = new Set<string>();
  for (const r of rows) {
    if (r.assignee) set.add(r.assignee);
    if (r.owner) set.add(r.owner);
  }
  return Array.from(set).sort();
}

/** Parent candidates: id + title, never the issue itself; matched on either. */
export function parentChoices(
  rows: readonly { id: string; title: string }[], self: string | null, needle: string, limit = 50,
): { id: string; title: string }[] {
  const n = needle.trim().toLowerCase();
  const out: { id: string; title: string }[] = [];
  for (const r of rows) {
    if (r.id === self) continue;
    if (n && r.id.toLowerCase().indexOf(n) < 0 && r.title.toLowerCase().indexOf(n) < 0) continue;
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}
