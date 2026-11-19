/**
 * The issue tree as the panel draws it: parent links, sibling order, the
 * filters, the flattened list of visible rows, and the linked-issue lists a
 * card shows. Pure — no React, no clock unless one is passed in.
 *
 * Ported from the reference tab (cloudcli-plugin-beads, dist/index.js:
 * applyRows, SORTERS, rowCmp, passes, rebuildFlat, relEntry, relCmp,
 * relChildTree, and the label slots of rebuildFilterOptions).
 */

import { markRank, naturalCmp, readinessOf } from "./charts/rows.ts";
import { STATUS_ORDER } from "./charts/types.ts";
import type { TreeRow } from "./types.ts";

/** Categorical slots available to labels. Past the eighth, labels go muted (slot 0). */
export const LABEL_SLOTS = 8;

/** Type -> letter glyph. Unknown types fall back to their first letter. */
export const TYPE_GLYPH: Record<string, string> = {
  epic: "E", feature: "F", bug: "B", task: "T", chore: "C", decision: "D",
  "merge-request": "R", molecule: "L", gate: "G", convoy: "V",
};

/** Only these three carry a categorical hue; the rest stay in muted ink. */
export const TYPE_COLORED: readonly string[] = ["epic", "bug", "feature"];

export function typeGlyph(type: string | null | undefined): string {
  const t = type || "task";
  return TYPE_GLYPH[t] ?? t.slice(0, 1).toUpperCase();
}

/** A tree column: `flex` columns share the leftover width; `always` cannot be switched off. */
export interface ColumnDef {
  key: string;
  width?: number;
  /** The STRINGS key of a short caption for a narrow column. */
  short?: string;
  num?: boolean;
  flex?: boolean;
  always?: boolean;
}

/** Tree columns, in render order (reference COLUMNS). */
export const COLUMNS: readonly ColumnDef[] = [
  { key: "priority", width: 22, short: "shPri", num: true },
  { key: "type", width: 18, short: "shType" },
  { key: "id", flex: true },
  { key: "title", always: true, flex: true },
  { key: "labels", width: 120 },
  { key: "kids", width: 26, short: "shKids", num: true },
  { key: "mark", width: 68, short: "shMark" },
  { key: "status", width: 108 },
  { key: "assignee", width: 130 },
  { key: "created", width: 118, num: true },
  { key: "updated", width: 118, num: true },
  { key: "comments", width: 34, short: "shCm", num: true },
];

/** Columns on screen when nothing has been configured yet. */
export const COLUMNS_DEFAULT: readonly string[] = ["priority", "type", "id", "title", "labels", "kids", "mark", "status"];

/** Columns the linked-issue lists inside a card can show (reference REL_COLUMNS). */
export const REL_COLUMNS: readonly ColumnDef[] = [
  { key: "priority", width: 24, short: "shPri", num: true },
  { key: "type", width: 18, short: "shType" },
  { key: "id", width: 118 },
  { key: "title", always: true, flex: true },
  { key: "labels", width: 104 },
  { key: "status", width: 100 },
  { key: "assignee", width: 112 },
  { key: "updated", width: 84, num: true },
];
export const REL_COLUMNS_DEFAULT: readonly string[] = ["priority", "type", "id", "title", "status"];

export interface Sort {
  key: string;
  dir: 1 | -1;
}

/** Linked issues start sorted by key, ascending. */
export const REL_SORT_DEFAULT: Sort = { key: "id", dir: 1 };

/** What a sorter reads: a tree row, or a linked-issue entry built from one. */
export interface Sortable {
  id: string;
  title?: string | null;
  issue_type?: string | null;
  labels?: string[] | null;
  priority?: number | null;
  status?: string | null;
  assignee?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  comment_count?: number | null;
  ready?: boolean | null;
  blockers?: string[] | null;
}

type Sorter = (a: Sortable, b: Sortable, kidsOf: (id: string) => number) => number;

const MAX_CHAR = "￿";

function statusRank(s: string | null | undefined): number {
  const i = STATUS_ORDER.indexOf(s ?? "");
  return i < 0 ? STATUS_ORDER.length : i;
}

/** Per-column comparators for the sortable header. Ties are broken by id by the caller. */
export const SORTERS: Record<string, Sorter> = {
  type: (a, b) => String(a.issue_type).localeCompare(String(b.issue_type)),
  id: (a, b) => naturalCmp(a.id, b.id),
  title: (a, b) => String(a.title ?? "").localeCompare(String(b.title ?? "")),
  labels: (a, b) => String((a.labels ?? [])[0] ?? MAX_CHAR).localeCompare(String((b.labels ?? [])[0] ?? MAX_CHAR)),
  kids: (a, b, kidsOf) => kidsOf(a.id) - kidsOf(b.id),
  // Ready first, then untouched, then blocked — the order you triage in.
  mark: (a, b) => markRank({ ...a, status: a.status ?? "" }) - markRank({ ...b, status: b.status ?? "" }),
  priority: (a, b) => (a.priority == null ? 99 : a.priority) - (b.priority == null ? 99 : b.priority),
  status: (a, b) => statusRank(a.status) - statusRank(b.status),
  assignee: (a, b) => String(a.assignee || MAX_CHAR).localeCompare(String(b.assignee || MAX_CHAR)),
  created: (a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
  updated: (a, b) => String(a.updated_at ?? "").localeCompare(String(b.updated_at ?? "")),
  comments: (a, b) => (a.comment_count ?? 0) - (b.comment_count ?? 0),
};

/** The chosen column, ties broken by the natural id order; no sort = id order. */
export function compareBy(sort: Sort | null, kidsOf: (id: string) => number = () => 0) {
  const sorter = sort ? SORTERS[sort.key] : undefined;
  return (a: Sortable, b: Sortable): number => {
    if (!sorter || !sort) return naturalCmp(a.id, b.id);
    return (sorter(a, b, kidsOf) || 0) * sort.dir || naturalCmp(a.id, b.id);
  };
}

/** Header click: asc → desc → off (the tree); the card lists have no "off" (two states). */
export function nextSort(cur: Sort | null, key: string, withOff: boolean): Sort | null {
  if (cur && cur.key === key) {
    if (cur.dir === 1) return { key, dir: -1 };
    return withOff ? null : { key, dir: 1 };
  }
  return { key, dir: 1 };
}

// ── the index ─────────────────────────────────────────────────────────

export interface TreeIndex {
  rows: readonly TreeRow[];
  byId: Map<string, TreeRow>;
  /** parent id → child ids, natural order. A parent that is not in the list makes its child a root. */
  kids: Map<string, string[]>;
  roots: string[];
  /** label → categorical slot 1..8, or 0 past the eighth; fixed by the project's sorted label list. */
  labelSlots: Map<string, number>;
}

export function buildIndex(rows: readonly TreeRow[]): TreeIndex {
  const byId = new Map<string, TreeRow>();
  for (const row of rows) byId.set(row.id, row);
  const kids = new Map<string, string[]>();
  const roots: string[] = [];
  const labels = new Set<string>();
  for (const row of rows) {
    for (const l of row.labels ?? []) labels.add(l);
    if (row.parent && row.parent !== row.id && byId.has(row.parent)) {
      const list = kids.get(row.parent);
      if (list) list.push(row.id);
      else kids.set(row.parent, [row.id]);
    } else {
      roots.push(row.id);
    }
  }
  for (const list of kids.values()) list.sort(naturalCmp);
  roots.sort(naturalCmp);
  const labelSlots = new Map<string, number>();
  let slot = 0;
  for (const label of Array.from(labels).sort()) {
    slot++;
    labelSlots.set(label, slot <= LABEL_SLOTS ? slot : 0);
  }
  return { rows, byId, kids, roots, labelSlots };
}

/** Every ancestor of an issue, nearest first (guarded against cycles). */
export function ancestorsOf(index: TreeIndex, id: string): string[] {
  const out: string[] = [];
  let cur = index.byId.get(id);
  let guard = 0;
  while (cur && cur.parent && guard++ < 256 && index.byId.has(cur.parent)) {
    out.push(cur.parent);
    cur = index.byId.get(cur.parent);
  }
  return out;
}

/** Ids with children — what "expand all" opens. */
export function parentIds(index: TreeIndex): string[] {
  return Array.from(index.kids.keys());
}

// ── filters ───────────────────────────────────────────────────────────

export interface Filters {
  statuses: string[];
  types: string[];
  priorities: number[];
  labels: string[];
  readiness: ("ready" | "blocked")[];
  /** Created within the last N days, or null for any time. */
  createdDays: number | null;
  assignee: string | null;
}

export const NO_FILTERS: Filters = {
  statuses: [], types: [], priorities: [], labels: [], readiness: [], createdDays: null, assignee: null,
};

export function activeFilterCount(f: Filters): number {
  return (f.statuses.length ? 1 : 0) + (f.types.length ? 1 : 0) + (f.priorities.length ? 1 : 0)
    + (f.readiness.length ? 1 : 0) + (f.createdDays != null ? 1 : 0) + (f.labels.length ? 1 : 0) + (f.assignee ? 1 : 0);
}

export interface VisibilityInput {
  showClosed: boolean;
  filters: Filters;
  /** The quick search as typed; matched against id, title and labels. */
  query: string;
  /** Ids the server's full-text search returned for `query`, if it has answered. */
  searchIds?: ReadonlySet<string> | null;
  /** For the "created within" filter. */
  now?: number;
}

/**
 * A predicate for "is this row on screen". A query that spells out a key
 * whole means that one issue only (keys nest and get quoted in other issues).
 */
export function visibility(index: TreeIndex, v: VisibilityInput): (row: TreeRow) => boolean {
  const f = v.filters;
  const statuses = new Set(f.statuses);
  const types = new Set(f.types);
  const priorities = new Set(f.priorities);
  const labels = new Set(f.labels);
  const readiness = new Set<string>(f.readiness);
  const q = v.query.trim().toLowerCase();
  let only: string | null = null;
  if (q) for (const row of index.rows) if (row.id.toLowerCase() === q) { only = row.id; break; }
  const now = v.now ?? Date.now();
  return (row) => {
    if (!v.showClosed && row.status === "closed") return false;
    if (statuses.size && !statuses.has(row.status)) return false;
    if (types.size && !types.has(row.issue_type)) return false;
    if (priorities.size && (row.priority == null || !priorities.has(row.priority))) return false;
    // Labels are an OR: "show me anything touching these areas".
    if (labels.size && !(row.labels ?? []).some((l) => labels.has(l))) return false;
    if (f.assignee && row.assignee !== f.assignee) return false;
    if (readiness.size && !readiness.has(readinessOf(row))) return false;
    if (f.createdDays != null) {
      const at = row.created_at ? Date.parse(row.created_at) : NaN;
      if (!Number.isFinite(at) || now - at > f.createdDays * 86400000) return false;
    }
    if (q) {
      if (only !== null) return row.id === only;
      const local = `${row.id}\n${row.title}\n${(row.labels ?? []).join(" ")}`.toLowerCase().includes(q);
      if (!local && !(v.searchIds && v.searchIds.has(row.id))) return false;
    }
    return true;
  };
}

// ── the flattened, visible tree ──────────────────────────────────────

export interface FlatNode {
  id: string;
  row: TreeRow;
  depth: number;
  hasKids: boolean;
  open: boolean;
  /** Children in the whole project, filters or not (the ▸N column). */
  kidCount: number;
  /** Its real parent is hidden by the filter; it hangs under the nearest visible ancestor. */
  detached: boolean;
}

export interface FlatTree {
  nodes: FlatNode[];
  /** How many rows pass the filters (folded ones included). */
  visible: number;
}

/**
 * Flatten the tree to the rows that are drawn. A node whose parent is
 * filtered out reattaches to the nearest visible ancestor (or the root) and
 * is marked detached. Sorting reorders siblings, never the hierarchy. With a
 * live query the branches leading to a hit open by themselves.
 */
export function flattenTree(
  index: TreeIndex,
  passes: (row: TreeRow) => boolean,
  expanded: ReadonlySet<string>,
  sort: Sort | null,
  autoExpand = false,
): FlatTree {
  const visible = new Set<string>();
  for (const row of index.rows) if (passes(row)) visible.add(row.id);

  const displayParent = new Map<string, string | null>();
  for (const id of visible) {
    const cur = index.byId.get(id);
    let parent = cur ? cur.parent : null;
    let guard = 0;
    while (parent && guard++ < 256) {
      if (visible.has(parent)) break;
      const p = index.byId.get(parent);
      parent = p ? p.parent : null;
    }
    displayParent.set(id, parent && visible.has(parent) ? parent : null);
  }

  const byParent = new Map<string | null, string[]>();
  for (const id of visible) {
    const p = displayParent.get(id) ?? null;
    const list = byParent.get(p);
    if (list) list.push(id);
    else byParent.set(p, [id]);
  }
  const kidsOf = (id: string) => (index.kids.get(id) ?? []).length;
  const cmp = compareBy(sort, kidsOf);
  for (const list of byParent.values()) list.sort((a, b) => cmp(index.byId.get(a)!, index.byId.get(b)!));

  const auto = new Set<string>();
  if (autoExpand) {
    for (const id of visible) {
      let p = displayParent.get(id) ?? null;
      let guard = 0;
      while (p && guard++ < 256) {
        auto.add(p);
        p = displayParent.get(p) ?? null;
      }
    }
  }
  const isOpen = (id: string) => expanded.has(id) || auto.has(id);

  const nodes: FlatNode[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const id of byParent.get(parent) ?? []) {
      const row = index.byId.get(id)!;
      const children = byParent.get(id) ?? [];
      const open = children.length > 0 && isOpen(id);
      nodes.push({
        id,
        row,
        depth,
        hasKids: children.length > 0,
        open,
        kidCount: kidsOf(id),
        detached: Boolean(row.parent) && (displayParent.get(id) ?? null) !== row.parent,
      });
      if (open) walk(id, depth + 1);
    }
  };
  walk(null, 0);
  return { nodes, visible: visible.size };
}

/** Rows whose content moved between two snapshots — what a poll flashes. */
export function changedIds(prev: readonly TreeRow[], next: readonly TreeRow[]): string[] {
  if (!prev.length) return [];
  const before = new Map<string, TreeRow>();
  for (const r of prev) before.set(r.id, r);
  const out: string[] = [];
  for (const r of next) {
    const b = before.get(r.id);
    if (!b || b.updated_at !== r.updated_at || b.status !== r.status) out.push(r.id);
  }
  return out;
}

// ── a card's linked-issue lists ──────────────────────────────────────

/** A link as the card's relations carry it. */
export interface RelItem {
  id: string;
  type?: string;
  title?: string | null;
  status?: string | null;
  issue_type?: string | null;
  missing?: boolean;
  direction?: "in" | "out";
}

export interface RelEntry extends Sortable {
  id: string;
  title: string;
  status: string;
  issue_type: string;
  priority: number | null;
  assignee: string | null;
  labels: string[];
  missing: boolean;
  linkType?: string;
  direction?: "in" | "out";
  depth: number;
  kids: number;
  open: boolean;
}

/** A link filled in from the tree row it points at (the card's own ref is light). */
export function relEntry(index: TreeIndex | null, item: RelItem): RelEntry {
  const row = index?.byId.get(item.id) ?? null;
  return {
    id: item.id,
    title: item.title || row?.title || "",
    status: item.status || row?.status || "open",
    issue_type: item.issue_type || row?.issue_type || "task",
    priority: row ? row.priority : null,
    assignee: row ? row.assignee : null,
    labels: row ? row.labels ?? [] : [],
    created_at: row ? row.created_at : null,
    updated_at: row ? row.updated_at : null,
    comment_count: row ? row.comment_count : 0,
    ready: Boolean(row && row.ready),
    blockers: row ? row.blockers ?? [] : [],
    missing: Boolean(item.missing),
    linkType: item.type,
    direction: item.direction,
    depth: 0,
    kids: 0,
    open: false,
  };
}

export interface RelList {
  /** What is drawn (folded branches left out). */
  rows: RelEntry[];
  /** Every entry, folded or not — what the progress bar counts. */
  all: RelEntry[];
}

/** A flat block (blocked by, blocking, …), in the card lists' sort. */
export function relFlat(index: TreeIndex | null, items: readonly RelItem[], sort: Sort): RelList {
  const cmp = compareBy(sort);
  const flat = items.map((i) => relEntry(index, i)).sort(cmp);
  return { rows: flat, all: flat };
}

/**
 * The children of an issue, all the way down, from the tree the panel holds;
 * folded until asked (`expanded`). Without the issue in the tree, the card's
 * own one-level list.
 */
export function relChildTree(
  index: TreeIndex | null,
  rootId: string,
  items: readonly RelItem[],
  sort: Sort,
  expanded: ReadonlySet<string>,
): RelList {
  if (!index || !index.kids.has(rootId)) return relFlat(index, items, sort);
  const cmp = compareBy(sort);
  const rows: RelEntry[] = [];
  const all: RelEntry[] = [];
  const walk = (parentId: string, depth: number, shown: boolean) => {
    if (depth > 24) return;
    const entries = (index.kids.get(parentId) ?? []).map((cid) => relEntry(index, { id: cid, type: "parent-child" })).sort(cmp);
    for (const entry of entries) {
      const kids = (index.kids.get(entry.id) ?? []).length;
      const node: RelEntry = { ...entry, depth, kids, open: kids > 0 && expanded.has(entry.id) };
      all.push(node);
      if (shown) rows.push(node);
      if (kids) walk(entry.id, depth + 1, shown && node.open);
    }
  };
  walk(rootId, 0, true);
  return { rows, all };
}

/** Statuses of a block's issues in bd's order (unknown ones after), with counts. */
export function statusBreakdown(entries: readonly { status: string }[]): { status: string; n: number }[] {
  const by = new Map<string, number>();
  for (const e of entries) by.set(e.status, (by.get(e.status) ?? 0) + 1);
  const order = STATUS_ORDER.filter((s) => by.has(s)).concat(Array.from(by.keys()).filter((s) => STATUS_ORDER.indexOf(s) < 0));
  return order.map((status) => ({ status, n: by.get(status) ?? 0 }));
}

// ── the filter panel ─────────────────────────────────────────────────

/** "Created within" windows the panel offers; null = any time. One choice, not a multi-select. */
export const CREATED_WINDOWS: readonly (number | null)[] = [null, 1, 7, 30, 90];

export interface FilterOptions {
  /** Statuses present, bd's order first, with counts over every row. */
  statuses: { key: string; n: number }[];
  /** Types present, most common first. */
  types: { key: string; n: number }[];
  /** Priority levels actually used, P0 first. */
  priorities: { key: number; n: number }[];
  readiness: { key: "ready" | "blocked"; n: number }[];
  /** Every label, sorted, with how many issues carry it. */
  labels: { key: string; n: number }[];
  /** Assignees, sorted. */
  people: string[];
}

/** What the filter panel offers, from the whole list (reference rebuildFilterOptions). */
export function filterOptions(rows: readonly TreeRow[]): FilterOptions {
  const byStatus = new Map<string, number>();
  const byType = new Map<string, number>();
  const byPri = new Map<number, number>();
  const byLabel = new Map<string, number>();
  const people = new Set<string>();
  let ready = 0;
  let blocked = 0;
  for (const row of rows) {
    byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
    const type = row.issue_type || "task";
    byType.set(type, (byType.get(type) ?? 0) + 1);
    if (row.priority != null) byPri.set(row.priority, (byPri.get(row.priority) ?? 0) + 1);
    for (const l of row.labels ?? []) byLabel.set(l, (byLabel.get(l) ?? 0) + 1);
    if (row.assignee) people.add(row.assignee);
    const r = readinessOf(row);
    if (r === "ready") ready++;
    else if (r === "blocked") blocked++;
  }
  return {
    statuses: STATUS_ORDER.filter((s) => byStatus.has(s)).map((key) => ({ key, n: byStatus.get(key)! })),
    types: Array.from(byType.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, n]) => ({ key, n })),
    priorities: Array.from(byPri.keys())
      .sort((a, b) => a - b)
      .map((key) => ({ key, n: byPri.get(key)! })),
    readiness: [
      { key: "ready", n: ready },
      { key: "blocked", n: blocked },
    ],
    labels: Array.from(byLabel.keys())
      .sort()
      .map((key) => ({ key, n: byLabel.get(key)! })),
    people: Array.from(people).sort(),
  };
}

/** Add or remove one value of a multi-select filter. */
export function toggleValue<T>(list: readonly T[], value: T): T[] {
  return list.indexOf(value) >= 0 ? list.filter((x) => x !== value) : list.concat([value]);
}

/** One removable chip under the toolbar. */
export type ActiveChip =
  | { kind: "status"; value: string }
  | { kind: "type"; value: string }
  | { kind: "priority"; value: number }
  | { kind: "readiness"; value: "ready" | "blocked" }
  | { kind: "created"; value: number }
  | { kind: "label"; value: string }
  | { kind: "assignee"; value: string };

/** The active filters as chips, in the reference's order (renderActiveChips). */
export function activeChips(f: Filters): ActiveChip[] {
  const out: ActiveChip[] = [];
  for (const value of f.statuses) out.push({ kind: "status", value });
  for (const value of f.types) out.push({ kind: "type", value });
  for (const value of f.priorities) out.push({ kind: "priority", value });
  for (const value of f.readiness) out.push({ kind: "readiness", value });
  if (f.createdDays != null) out.push({ kind: "created", value: f.createdDays });
  for (const value of f.labels) out.push({ kind: "label", value });
  if (f.assignee) out.push({ kind: "assignee", value: f.assignee });
  return out;
}

/** The filters without one chip. */
export function removeChip(f: Filters, chip: ActiveChip): Filters {
  switch (chip.kind) {
    case "status":
      return { ...f, statuses: f.statuses.filter((x) => x !== chip.value) };
    case "type":
      return { ...f, types: f.types.filter((x) => x !== chip.value) };
    case "priority":
      return { ...f, priorities: f.priorities.filter((x) => x !== chip.value) };
    case "readiness":
      return { ...f, readiness: f.readiness.filter((x) => x !== chip.value) };
    case "created":
      return { ...f, createdDays: null };
    case "label":
      return { ...f, labels: f.labels.filter((x) => x !== chip.value) };
    case "assignee":
      return { ...f, assignee: null };
  }
}

/** A label that vanished from the project cannot stay in the filter. Same object if nothing changed. */
export function pruneLabels(f: Filters, present: ReadonlySet<string>): Filters {
  const keep = f.labels.filter((l) => present.has(l));
  return keep.length === f.labels.length ? f : { ...f, labels: keep };
}

/** Server full-text hits, tagged with the query they answer. */
export interface SearchHits {
  q: string;
  ids: ReadonlySet<string>;
}

/**
 * The hits that may join the local match: only ones for the query as it is
 * now. Results of an earlier query would let rows that no longer match flash
 * by while the next request is in flight (reference bug cbd-pe9).
 */
export function hitsFor(hits: SearchHits | null, query: string): ReadonlySet<string> | null {
  const q = query.trim();
  return hits && q.length >= SEARCH_MIN && hits.q === q ? hits.ids : null;
}

/** The server is asked from this many characters on, after SEARCH_DEBOUNCE_MS of quiet. */
export const SEARCH_MIN = 2;
export const SEARCH_DEBOUNCE_MS = 220;

// ── the list's first commit ──────────────────────────────────────────

/**
 * Rows the tree renders in its first commit: what a window `windowH` px tall
 * can show (plus one), between 10 and 40. On web each row costs a few ms, so
 * more only delays the first frame; the list renders the rest in batches
 * after it.
 */
export function firstRows(windowH: number, rowH: number): number {
  if (!(windowH > 0)) return 40;
  return Math.max(10, Math.min(40, Math.ceil(windowH / rowH) + 1));
}

// ── the card pane's width ────────────────────────────────────────────

/** Card pane limits (reference CARD_MIN_W / TREE_MIN_W) and the untouched split. */
export const CARD_MIN_W = 320;
export const TREE_MIN_W = 340;
export const CARD_MAX_DEFAULT_W = 640;

/**
 * The card pane's width out of `shared` px the tree and card split between
 * them. Untouched (`want` null) it is the reference's 55/45 flex split capped
 * at 640; a dragged width is clamped every time, so a window that shrank since
 * cannot leave the tree with no room.
 */
export function cardPaneWidth(want: number | null, shared: number): number {
  const max = Math.max(CARD_MIN_W, shared - TREE_MIN_W);
  const w = want == null ? Math.min(CARD_MAX_DEFAULT_W, shared * 0.45) : want;
  return Math.round(Math.min(Math.max(w, CARD_MIN_W), max));
}
