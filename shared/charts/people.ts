/**
 * Who carries the work (assignees) and who raises it (authors).
 *
 * Ported from the reference tab (cloudcli-plugin-beads, dist/index.js:
 * aggregatePeople, aggregateAuthors, personWip, sortedPeople, sortedAuthors,
 * and the direction rule of sortPeopleBy/sortAuthorsBy). Both readings cut
 * their sparklines on the same grid the flow uses (flowGrid), so a person's
 * row is comparable with the totals and with the next person's.
 *
 * What this cannot know: `assignee` is the current value and beads keeps no
 * history of reassignment, so an issue closed months ago counts for whoever
 * holds it today.
 */

import { flowGrid, flowItems } from "./flow.ts";
import { naturalCmp } from "./rows.ts";
import { medianOf, tsOf, type Frame } from "./time.ts";
import { DAY_MS, STALE_WIP_DAYS, type ChartRow, type Period, type PinnedStep, type Step } from "./types.ts";

export interface Person {
  /** The assignee; "" for the row of issues nobody is on. */
  name: string;
  unassigned: boolean;
  /** Everything they hold now: doneAll + wip + waiting. */
  total: number;
  /** Closed within the period (the ranking key). */
  closed: number;
  doneAll: number;
  wip: number;
  waiting: number;
  /** Closes per step of the shared grid. */
  series: number[];
  /** Median days from creation to close, of the period's closes. */
  medianLead: number | null;
  byStatus: Map<string, number>;
}

export interface PeopleReading {
  step: Step;
  bounds: number[];
  frames: Frame[];
  /** Number of steps. */
  points: number;
  /** Named people by closes desc, ties by name; the unassigned row always last. */
  people: Person[];
  undated: number;
  dropped: number;
  empty: boolean;
}

const zeros = (n: number) => { const a: number[] = []; for (let i = 0; i < n; i++) a.push(0); return a; };

/** A row per assignee over the period. Issues with nobody on them get their own row. */
export function aggregatePeople<R extends ChartRow>(rows: readonly R[], period: Period, now: number, pinned: PinnedStep = "auto"): PeopleReading {
  const { items, undated } = flowItems(rows);
  const grid = items.length ? flowGrid(items, period, now, pinned) : null;
  if (!grid || !grid.k) return { step: "week", bounds: [], frames: [], points: 0, people: [], undated, dropped: 0, empty: true };
  const { step, bounds, frames, k, bucketOf, dropped } = grid;

  const by = new Map<string, Person & { leads: number[] }>();
  for (const it of items) {
    const name = it.row.assignee || "";
    let p = by.get(name);
    if (!p) {
      p = {
        name, unassigned: name === "",
        total: 0, closed: 0, doneAll: 0, wip: 0, waiting: 0,
        series: zeros(k), medianLead: null, byStatus: new Map(), leads: [],
      };
      by.set(name, p);
    }
    p.total += 1;
    p.byStatus.set(it.row.status, (p.byStatus.get(it.row.status) || 0) + 1);
    if (it.closed != null) {
      p.doneAll += 1;
      const zi = bucketOf(it.closed);
      if (zi >= 0) {
        p.closed += 1;
        p.series[zi] = p.series[zi]! + 1;
        p.leads.push((it.closed - it.created) / DAY_MS);
      }
    } else if (it.started != null) {
      p.wip += 1;
    } else {
      p.waiting += 1;
    }
  }

  const people: Person[] = [];
  by.forEach((p) => {
    p.leads.sort((a, b) => a - b);
    const { leads, ...rest } = p;
    people.push({ ...rest, medianLead: medianOf(leads) });
  });
  people.sort((a, b) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
    return b.closed - a.closed || a.name.localeCompare(b.name);
  });

  return { step, bounds, frames, points: k, people, undated, dropped, empty: false };
}

export interface Author {
  /** created_by; "" for issues nobody is recorded as raising. */
  name: string;
  anonymous: boolean;
  /** Raised within the period (the ranking key). */
  raised: number;
  /** Everything they ever raised (in the selection): closed + open. */
  total: number;
  closed: number;
  open: number;
  /** Raised per step of the shared grid. */
  series: number[];
}

export interface AuthorsReading {
  step: Step;
  bounds: number[];
  frames: Frame[];
  points: number;
  /** By raised desc, ties by name; the anonymous row always last. */
  authors: Author[];
  undated: number;
  dropped: number;
  empty: boolean;
}

/**
 * A row per author (`created_by`). An issue is raised exactly once, so over
 * the whole history `total` sums to the dated issues of the selection — the
 * sum the assignee table cannot make.
 */
export function aggregateAuthors<R extends ChartRow>(rows: readonly R[], period: Period, now: number, pinned: PinnedStep = "auto"): AuthorsReading {
  const { items, undated } = flowItems(rows);
  const grid = items.length ? flowGrid(items, period, now, pinned) : null;
  if (!grid || !grid.k) return { step: "week", bounds: [], frames: [], points: 0, authors: [], undated, dropped: 0, empty: true };
  const { step, bounds, frames, k, bucketOf, dropped } = grid;

  const by = new Map<string, Author>();
  for (const it of items) {
    const name = it.row.created_by || "";
    let a = by.get(name);
    if (!a) {
      a = { name, anonymous: name === "", raised: 0, total: 0, closed: 0, open: 0, series: zeros(k) };
      by.set(name, a);
    }
    a.total += 1;
    if (it.closed != null) a.closed += 1;
    else a.open += 1;
    const ci = bucketOf(it.created);
    if (ci >= 0) {
      a.raised += 1;
      a.series[ci] = a.series[ci]! + 1;
    }
  }

  const authors: Author[] = [];
  by.forEach((a) => authors.push(a));
  authors.sort((a, b) => {
    if (a.anonymous !== b.anonymous) return a.anonymous ? 1 : -1;
    return b.raised - a.raised || a.name.localeCompare(b.name);
  });

  return { step, bounds, frames, points: k, authors, undated, dropped, empty: false };
}

export interface WipItem<R> {
  row: R;
  /** Whole days held: since the start, or the last touch for a moved status with no start. */
  ageDays: number;
  /** Held at least STALE_WIP_DAYS — flagged, with the days spelled out beside it either way. */
  stale: boolean;
}

/**
 * One person's work in progress, oldest first (ties by natural id) — what they
 * are sitting on. `name` is "" for the unassigned.
 */
export function personWip<R extends ChartRow>(rows: readonly R[], name: string, now: number): WipItem<R>[] {
  const out: WipItem<R>[] = [];
  for (const row of rows) {
    if ((row.assignee || "") !== name) continue;
    if (row.status === "closed") continue;
    const started = tsOf(row.started_at) ?? (row.status === "in_progress" || row.status === "blocked"
      ? tsOf(row.updated_at) : null);
    if (started == null) continue;
    const ageDays = Math.max(0, Math.floor((now - started) / DAY_MS));
    out.push({ row, ageDays, stale: ageDays >= STALE_WIP_DAYS });
  }
  out.sort((a, b) => b.ageDays - a.ageDays || naturalCmp(a.row.id, b.row.id));
  return out;
}

/** A column sort the reader picked; key null keeps the reading's own ranking. */
export interface TableSort<K extends string> {
  key: K | null;
  dir: 1 | -1;
}

export type PeopleSortKey = "name" | "closed" | "wip" | "waiting" | "total" | "medianLead";
export type AuthorSortKey = "name" | "raised" | "closed" | "open" | "total";

/** The table's columns in drawing order (the sparkline column is not sortable). */
export const PEOPLE_COLUMNS: readonly PeopleSortKey[] = ["name", "closed", "wip", "waiting", "total", "medianLead"];
export const AUTHOR_COLUMNS: readonly AuthorSortKey[] = ["name", "raised", "closed", "open", "total"];

/**
 * The sort after a header press: the same column flips; a new one opens
 * descending for counts ("who did most") and A to Z for a name.
 */
export function nextSort<K extends string>(cur: TableSort<K>, key: K): TableSort<K> {
  const dir: 1 | -1 = cur.key === key ? (cur.dir === 1 ? -1 : 1) : (key === "name" ? 1 : -1);
  return { key, dir };
}

/**
 * People in the reader's order. The unassigned row stays last whatever the
 * column; a missing median sorts last in either direction.
 */
export function sortPeople(people: readonly Person[], sort: TableSort<PeopleSortKey>): Person[] {
  const { key, dir } = sort;
  const out = people.slice();
  if (!key) return out;
  out.sort((a, b) => {
    if (a.unassigned !== b.unassigned) return a.unassigned ? 1 : -1;
    if (key === "name") return dir * a.name.localeCompare(b.name);
    const av = a[key];
    const bv = b[key];
    if (av == null || bv == null) return av == null ? (bv == null ? 0 : 1) : -1;
    return dir * (av - bv);
  });
  return out;
}

/** Authors in the reader's order; the anonymous row stays last. */
export function sortAuthors(authors: readonly Author[], sort: TableSort<AuthorSortKey>): Author[] {
  const { key, dir } = sort;
  const out = authors.slice();
  if (!key) return out;
  out.sort((a, b) => {
    if (a.anonymous !== b.anonymous) return a.anonymous ? 1 : -1;
    if (key === "name") return dir * a.name.localeCompare(b.name);
    return dir * (a[key] - b[key]);
  });
  return out;
}

/** The shared scale of a table's bars and sparklines: the largest value, at least 1. */
export function tableScale<T extends { series: number[] }>(rows: readonly T[], meter: (row: T) => number): { meter: number; spark: number } {
  let m = 1;
  let s = 1;
  for (const r of rows) {
    const v = meter(r);
    if (v > m) m = v;
    for (const x of r.series) if (x > s) s = x;
  }
  return { meter: m, spark: s };
}

/** The rows one person holds (assignee), or one author raised; "" for nobody. */
export function rowsOfPerson<R extends ChartRow>(rows: readonly R[], name: string): R[] {
  return rows.filter((r) => (r.assignee || "") === name);
}
export function rowsOfAuthor<R extends ChartRow>(rows: readonly R[], name: string): R[] {
  return rows.filter((r) => (r.created_by || "") === name);
}
