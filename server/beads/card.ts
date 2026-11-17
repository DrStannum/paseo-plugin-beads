/**
 * Projections of a snapshot: the light tree row and the full card — port of
 * treeRow / refOf / issueCard.
 */

import type { Card, Comment, OtherRef, Ref, TreeRow } from "../../shared/types.ts";
import type { Issue } from "./issues.ts";
import type { Snapshot } from "./snapshot.ts";
import { runBd } from "./run.ts";

/** Everything the tree, filters, badges and charts need — no heavy text. */
export function treeRow(issue: Issue): TreeRow {
  return {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    priority: issue.priority,
    issue_type: issue.issue_type,
    parent: issue.parent,
    labels: issue.labels,
    assignee: issue.assignee,
    owner: issue.owner,
    created_at: issue.created_at,
    created_by: issue.created_by,
    updated_at: issue.updated_at,
    // The charts rebuild the flow of work from created/started/closed; without
    // the last two they would fall back to "last touched" and be quietly wrong.
    started_at: issue.started_at,
    closed_at: issue.closed_at,
    dependency_count: issue.dependency_count,
    dependent_count: issue.dependent_count,
    comment_count: issue.comment_count,
    blockers: issue.activeBlockers,
    ready: issue.ready,
  };
}

function refOf(snapshot: Snapshot, id: string, type: string): Ref {
  const target = snapshot.byId.get(id);
  return {
    id,
    type,
    title: target ? target.title : null,
    status: target ? target.status : null,
    issue_type: target ? target.issue_type : null,
    missing: !target,
  };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/**
 * The full card. The comment thread is cached on the snapshot: opening the
 * same card twice costs one `bd comments`; a new revision brings a new
 * snapshot with an empty cache. Only a thread that actually arrived is kept.
 */
export async function issueCard(snapshot: Snapshot, id: string): Promise<Card | null> {
  const issue = snapshot.byId.get(id);
  if (!issue) return null;

  const outgoing = issue.links.filter((l) => l.type !== "parent-child");
  const incoming = issue.incoming.filter((l) => l.type !== "parent-child");
  const other: OtherRef[] = [
    ...outgoing
      .filter((l) => l.type !== "blocks" && l.type !== "discovered-from")
      .map((l) => ({ ...refOf(snapshot, l.to, l.type), direction: "out" as const })),
    ...incoming
      .filter((l) => l.type !== "blocks" && l.type !== "discovered-from")
      .map((l) => ({ ...refOf(snapshot, l.from, l.type), direction: "in" as const })),
  ];

  const relations = {
    parent: issue.parent ? refOf(snapshot, issue.parent, "parent-child") : null,
    children: issue.childIds.map((c) => refOf(snapshot, c, "parent-child")),
    // "blocks" on an issue means "I depend on that one" — it is my blocker.
    blockedBy: outgoing.filter((l) => l.type === "blocks").map((l) => refOf(snapshot, l.to, "blocks")),
    blocking: incoming.filter((l) => l.type === "blocks").map((l) => refOf(snapshot, l.from, "blocks")),
    discoveredFrom: outgoing.filter((l) => l.type === "discovered-from").map((l) => refOf(snapshot, l.to, "discovered-from")),
    discovered: incoming.filter((l) => l.type === "discovered-from").map((l) => refOf(snapshot, l.from, "discovered-from")),
    other,
  };

  let comments: Comment[] = [];
  let commentsAvailable = snapshot.mode === "bd";
  const cached = snapshot.commentCache.get(id);
  if (commentsAvailable && issue.comment_count > 0 && cached) {
    comments = cached;
  } else if (commentsAvailable && issue.comment_count > 0) {
    const res = await runBd(snapshot.root, ["comments", id]);
    if (res.ok) {
      try {
        const parsed = JSON.parse(res.stdout || "[]");
        if (Array.isArray(parsed)) {
          comments = parsed.map((c: any) => ({
            id: str(c?.id),
            author: str(c?.author),
            text: str(c?.text) || str(c?.body) || "",
            created_at: str(c?.created_at),
          }));
          snapshot.commentCache.set(id, comments);
        }
      } catch {
        commentsAvailable = false;
      }
    } else {
      commentsAvailable = false;
    }
  }

  const { links: _links, incoming: _incoming, childIds: _childIds, ...rest } = issue;
  return {
    ...rest,
    ready: issue.ready,
    blockers: issue.activeBlockers,
    relations,
    comments,
    commentsAvailable,
    mode: snapshot.mode,
  };
}

/**
 * Full-text search across the heavy fields. A query that spells out an issue
 * key exactly answers with that issue alone — keys nest and get quoted in
 * other issues, so the substring pass would bury the one asked for.
 */
export function searchIssues(snapshot: Snapshot, query: string, limit = 2000): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  for (const issue of snapshot.issues) {
    if (String(issue.id).toLowerCase() === needle) return [issue.id];
  }
  const hits: string[] = [];
  for (const issue of snapshot.issues) {
    const hay = `${issue.id}\n${issue.title}\n${issue.description || ""}\n${issue.design || ""}\n${
      issue.acceptance_criteria || ""
    }\n${issue.notes || ""}\n${issue.labels.join(" ")}`;
    if (hay.toLowerCase().includes(needle)) {
      hits.push(issue.id);
      if (hits.length >= limit) break;
    }
  }
  return hits;
}
