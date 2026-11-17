/**
 * One issue in the shape the rest of the plugin speaks, from either source
 * (`bd list --json` or `.beads/issues.jsonl`), and the graph over a set of
 * them — port of normalize / readIssuesJsonl / indexIssues / countUp.
 */

import fs from "node:fs";
import type { Counts } from "../../shared/types.ts";

export interface Link {
  to: string;
  type: string;
}

export interface Issue {
  id: string;
  title: string;
  description: string | null;
  design: string | null;
  acceptance_criteria: string | null;
  notes: string | null;
  status: string;
  priority: number | null;
  issue_type: string;
  owner: string | null;
  assignee: string | null;
  external_ref: string | null;
  spec_id: string | null;
  labels: string[];
  created_at: string | null;
  created_by: string | null;
  updated_at: string | null;
  started_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
  defer_until: string | null;
  parent: string | null;
  links: Link[];
  dependency_count: number;
  dependent_count: number;
  comment_count: number;
  // filled by indexIssues
  blockers: string[];
  activeBlockers: string[];
  ready: boolean;
  childIds: string[];
  incoming: { from: string; type: string }[];
}

/** Dependency link type that means "this issue's parent is depends_on_id". */
const PARENT_LINK = "parent-child";

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Fields absent in jsonl land as null / empty and the UI degrades silently. */
export function normalize(raw: any): Issue | null {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
  const deps: any[] = Array.isArray(raw.dependencies) ? raw.dependencies : [];
  const own: Link[] = deps
    .filter((d) => d && typeof d.depends_on_id === "string" && (!d.issue_id || d.issue_id === raw.id))
    .map((d) => ({ to: d.depends_on_id, type: typeof d.type === "string" ? d.type : "depends-on" }));

  // In jsonl mode there is no `parent` column — the parent-child link is it.
  const parentLink = own.find((d) => d.type === PARENT_LINK);

  return {
    id: raw.id,
    title: str(raw.title) || raw.id,
    description: str(raw.description),
    design: str(raw.design),
    acceptance_criteria: str(raw.acceptance_criteria),
    notes: str(raw.notes),
    status: str(raw.status) || "open",
    priority: num(raw.priority),
    issue_type: str(raw.issue_type) || "task",
    owner: str(raw.owner),
    assignee: str(raw.assignee),
    external_ref: str(raw.external_ref),
    spec_id: str(raw.spec_id),
    labels: Array.isArray(raw.labels) ? raw.labels.filter((l: unknown) => typeof l === "string") : [],
    created_at: str(raw.created_at),
    created_by: str(raw.created_by),
    updated_at: str(raw.updated_at),
    started_at: str(raw.started_at),
    closed_at: str(raw.closed_at),
    close_reason: str(raw.close_reason),
    defer_until: str(raw.defer_until),
    parent: str(raw.parent) || (parentLink ? parentLink.to : null),
    links: own,
    dependency_count: num(raw.dependency_count) ?? own.length,
    dependent_count: num(raw.dependent_count) ?? 0,
    comment_count: num(raw.comment_count) ?? 0,
    blockers: [],
    activeBlockers: [],
    ready: false,
    childIds: [],
    incoming: [],
  };
}

/**
 * Read `.beads/issues.jsonl` line by line. Only `_type: issue` records belong
 * in the tree; broken lines are skipped (a half-flushed last line is normal
 * while an agent writes).
 */
export function readIssuesJsonl(file: string): { issues: Issue[]; skipped: number } {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return { issues: [], skipped: 0 };
  }
  const issues: Issue[] = [];
  let skipped = 0;
  let start = 0;
  while (start <= text.length) {
    let end = text.indexOf("\n", start);
    if (end === -1) end = text.length;
    const line = text.slice(start, end).trim();
    start = end + 1;
    if (!line) continue;
    let obj: any;
    try {
      obj = JSON.parse(line);
    } catch {
      skipped++;
      continue;
    }
    if (obj && obj._type && obj._type !== "issue") continue;
    const norm = normalize(obj);
    if (norm) issues.push(norm);
    else skipped++;
  }
  return { issues, skipped };
}

/**
 * Index a flat list into the graph the UI needs. `ready` is "open, and every
 * blocker closed" — reproduces `bd ready` exactly without another spawn.
 */
export function indexIssues(issues: Issue[]): { byId: Map<string, Issue>; roots: string[] } {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const children = new Map<string, string[]>();
  const incoming = new Map<string, { from: string; type: string }[]>();

  for (const issue of issues) {
    // A parent pointing at a missing issue is not a parent — the node is a root.
    if (issue.parent && !byId.has(issue.parent)) issue.parent = null;
    if (issue.parent === issue.id) issue.parent = null;
    for (const link of issue.links) {
      let list = incoming.get(link.to);
      if (!list) incoming.set(link.to, (list = []));
      list.push({ from: issue.id, type: link.type });
    }
  }
  for (const issue of issues) {
    if (!issue.parent) continue;
    let list = children.get(issue.parent);
    if (!list) children.set(issue.parent, (list = []));
    list.push(issue.id);
  }
  for (const issue of issues) {
    const blockers = issue.links.filter((l) => l.type === "blocks").map((l) => l.to);
    const active = blockers.filter((b) => {
      const target = byId.get(b);
      return target ? target.status !== "closed" : false; // an unknown blocker can't block
    });
    issue.blockers = blockers;
    issue.activeBlockers = active;
    issue.ready = issue.status === "open" && active.length === 0;
    issue.childIds = children.get(issue.id) || [];
    issue.incoming = incoming.get(issue.id) || [];
  }
  return { byId, roots: issues.filter((i) => !i.parent).map((i) => i.id) };
}

export function countUp(issues: Issue[]): Counts {
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let ready = 0;
  let blocked = 0;
  for (const issue of issues) {
    byStatus[issue.status] = (byStatus[issue.status] || 0) + 1;
    byType[issue.issue_type] = (byType[issue.issue_type] || 0) + 1;
    if (issue.ready) ready++;
    if (issue.activeBlockers.length && issue.status !== "closed") blocked++;
  }
  return { total: issues.length, byStatus, byType, ready, blocked };
}
