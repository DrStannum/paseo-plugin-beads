/**
 * How the filtered work moved over a period — the "Over time" reading.
 *
 * Ported from the reference tab (cloudcli-plugin-beads, dist/index.js:
 * flowItems, flowGrid, aggregateFlow, and the arithmetic of etaRow and
 * drawCohorts). One call, aggregateFlow, feeds every block of the reading:
 *
 * - tiles: totals.created / closed / net / openNow / wipNow / medianLead;
 * - when the backlog clears: etaOf(flow);
 * - pace (arriving against finished): points[].created / .closed, smoothed
 *   with rollingMean(values, smoothingWindow(step)); the hit strips report the
 *   raw counts;
 * - opened against closed: points[].created / .closed;
 * - the cumulative flow: points[].done / .wip / .waiting (sum = scope);
 * - waiting and working: points[].pickup / .work (+ pickupN / workN);
 * - predictability: points[].lead / .leadP85 (+ leadN);
 * - age of the open backlog: points[].age (+ ageN);
 * - work in progress: points[].wip;
 * - bugs, arriving and leaving: points[].bugShareIn / .bugShareOut, keyed by
 *   totals.bugsCreated of totals.created and totals.bugsClosed of totals.closed;
 * - what became of each step's intake: cohortTable(flow);
 * - footers: dropped (steps cut off the oldest end) and undated (left out).
 *
 * Beads keeps three timestamps per issue — created, started, closed — and no
 * history of status changes: everything here is reconstructed from those
 * three. Every value that has no sample is null, never zero, so a chart can
 * draw a gap where nothing was measured.
 */

import { bucketNext, bucketStart, chartStep, lastStepIsRunning, medianOf, quantileOf, stepDays, tsOf, type Frame } from "./time.ts";
import { CHART_MAX_POINTS, COHORT_AGES, COHORT_ROWS, DAY_MS, type ChartRow, type Period, type PinnedStep, type Step } from "./types.ts";

/** An issue reduced to the three moments the series is built from. */
export interface FlowItem<R extends ChartRow = ChartRow> {
  created: number;
  started: number | null;
  closed: number | null;
  row: R;
}

/**
 * The issues as flow items, with the data that cannot be true straightened:
 * a status that says the work moved but no timestamp saying when falls back
 * to the last touch (then creation); a start or close before creation is
 * moved to creation; a close before the start drops the start (a reopen's
 * trace — waiting → done). Issues with no creation date are counted, not kept.
 */
export function flowItems<R extends ChartRow>(rows: readonly R[]): { items: FlowItem<R>[]; undated: number } {
  const items: FlowItem<R>[] = [];
  let undated = 0;
  for (const row of rows) {
    const created = tsOf(row.created_at);
    if (created == null) { undated++; continue; }
    let started = tsOf(row.started_at);
    let closed = tsOf(row.closed_at);
    if (closed == null && row.status === "closed") closed = tsOf(row.updated_at) ?? created;
    if (started == null && (row.status === "in_progress" || row.status === "blocked")) {
      started = tsOf(row.updated_at) ?? created;
    }
    if (started != null && started < created) started = created;
    if (closed != null && closed < created) closed = created;
    if (started != null && closed != null && closed < started) started = null;
    items.push({ created, started, closed, row });
  }
  return { items, undated };
}

/** The time axis every reading shares. */
export interface FlowGrid {
  step: Step;
  /** Bucket starts, oldest first. */
  bounds: number[];
  /** Each bucket's start and end; the last ends at `now`. */
  frames: Frame[];
  k: number;
  /** Index of the bucket a moment belongs to; -1 for anything before the series. */
  bucketOf: (ts: number) => number;
  /** Buckets dropped off the oldest end to stay within CHART_MAX_POINTS. */
  dropped: number;
}

/**
 * The bucket grid for a set of items. Shared on purpose: a person's sparkline
 * is only comparable with the totals and with the next person's if all are cut
 * on the same steps. Never starts before the project did. `items` must not be
 * empty.
 */
export function flowGrid(items: readonly { created: number }[], period: Period, now: number, pinned: PinnedStep = "auto"): FlowGrid {
  let minCreated = Infinity;
  for (const it of items) if (it.created < minCreated) minCreated = it.created;
  const spanDays = Math.max(1, (now - minCreated) / DAY_MS);
  const step: Step = pinned === "auto" ? chartStep(period, spanDays) : pinned;
  const from = Math.max(period == null ? minCreated : now - period * DAY_MS, minCreated);
  const all: number[] = [];
  for (let b = bucketStart(from, step); b <= now; b = bucketNext(b, step)) all.push(b);
  const dropped = Math.max(0, all.length - CHART_MAX_POINTS);
  const bounds = dropped ? all.slice(dropped) : all;
  const k = bounds.length;

  const bucketOf = (ts: number): number => {
    if (!k || ts < bounds[0]!) return -1;
    let lo = 0;
    let hi = k - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bounds[mid]! <= ts) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  const frames = bounds.map((b, i) => ({ start: b, end: i + 1 < k ? bounds[i + 1]! - 1 : now }));
  return { step, bounds, frames, k, bucketOf, dropped };
}

/** One step of the flow. */
export interface FlowPoint extends Frame {
  /** State at the end of the step: waiting + wip + done = the scope then. */
  waiting: number;
  wip: number;
  done: number;
  /** Events within the step. */
  created: number;
  closed: number;
  /** Median days from creation to start, of the issues started in the step. */
  pickup: number | null;
  pickupN: number;
  /** Median days from start to close, of the issues closed in the step that had a start. */
  work: number | null;
  workN: number;
  /** Median and 85th percentile of days from creation to close, of the issues closed in the step. */
  lead: number | null;
  leadP85: number | null;
  leadN: number;
  /** Median age in days of what is still open at the end of the step. */
  age: number | null;
  ageN: number;
  bugsIn: number;
  bugsOut: number;
  /** Percent of the step's intake / output that is bugs; null where the step had none. */
  bugShareIn: number | null;
  bugShareOut: number | null;
}

export interface CohortSpan {
  age: number;
  /** Closed within `age` steps of being raised. */
  closed: number;
  /** Whether that many steps have fully elapsed (the running step does not count). */
  grown: boolean;
}

export interface Cohort {
  start: number;
  raised: number;
  /** Of those, closed by now. */
  closed: number;
  within: CohortSpan[];
}

export interface Drain {
  /** Net closes per step over the period (closed − created) / steps. */
  rate: number;
  /** Steps to empty at that rate; null when the backlog is not shrinking. */
  steps: number | null;
  /** The moment it would be empty; null with `steps`. */
  at: number | null;
}

export interface FlowTotals {
  created: number;
  closed: number;
  /** created − closed: positive means the backlog grew. */
  net: number;
  openNow: number;
  wipNow: number;
  doneNow: number;
  scope: number;
  medianLead: number | null;
  bugsCreated: number;
  bugsClosed: number;
  drain: Drain;
}

export interface Flow {
  step: Step;
  points: FlowPoint[];
  cohorts: Cohort[];
  undated: number;
  dropped: number;
  /** No dated issue at all: nothing to draw. */
  empty: boolean;
  totals: FlowTotals;
}

const sortNum = (a: number, b: number) => a - b;

/**
 * The whole Over-time reading of the filtered rows.
 *
 * @param period days back, or null for the whole history
 * @param now the moment to count from — a parameter, never the clock
 * @param pinned the step the reader pinned, if any
 */
export function aggregateFlow<R extends ChartRow>(rows: readonly R[], period: Period, now: number, pinned: PinnedStep = "auto"): Flow {
  const { items, undated } = flowItems(rows);
  const grid = items.length ? flowGrid(items, period, now, pinned) : null;

  // No dated issue — or, which the reference did not guard, every one dated
  // after `now`, so the grid has no step at all.
  if (!grid || !grid.k) {
    return {
      step: "week", points: [], cohorts: [], undated, dropped: 0, empty: true,
      totals: {
        created: 0, closed: 0, net: 0, openNow: 0, wipNow: 0, doneNow: 0, scope: 0, medianLead: null,
        bugsCreated: 0, bugsClosed: 0, drain: { rate: 0, steps: null, at: null },
      },
    };
  }

  const { step, frames, k, bucketOf, dropped } = grid;

  // State changes as deltas, prefix-summed afterwards; slot 0 is everything
  // that happened before the series starts.
  const zeros = (n: number) => { const a: number[] = []; for (let i = 0; i < n; i++) a.push(0); return a; };
  const lists = (n: number) => { const a: number[][] = []; for (let i = 0; i < n; i++) a.push([]); return a; };
  const dWait = zeros(k + 1);
  const dWip = zeros(k + 1);
  const dDone = zeros(k + 1);
  const perCreated = zeros(k);
  const perClosed = zeros(k);
  const leads: number[] = [];
  const perPickup = lists(k);
  const perWork = lists(k);
  const perLead = lists(k);
  const bugsIn = zeros(k);
  const bugsOut = zeros(k);
  const cohRaised = zeros(k);
  const cohClosed = zeros(k);
  const cohWithin = COHORT_AGES.map(() => zeros(k));
  const inc = (a: number[], i: number, by = 1) => { a[i] = a[i]! + by; };

  for (const it of items) {
    const ci = bucketOf(it.created);
    const bug = it.row.issue_type === "bug";
    inc(dWait, ci + 1);
    if (ci >= 0) {
      inc(perCreated, ci);
      inc(cohRaised, ci);
      if (bug) inc(bugsIn, ci);
    }
    if (it.started != null) {
      const si = bucketOf(it.started);
      inc(dWait, si + 1, -1);
      inc(dWip, si + 1);
      if (si >= 0) perPickup[si]!.push((it.started - it.created) / DAY_MS);
    }
    if (it.closed != null) {
      const zi = bucketOf(it.closed);
      if (it.started != null) inc(dWip, zi + 1, -1);
      else inc(dWait, zi + 1, -1);
      inc(dDone, zi + 1);
      if (zi >= 0) {
        inc(perClosed, zi);
        leads.push((it.closed - it.created) / DAY_MS);
        perLead[zi]!.push((it.closed - it.created) / DAY_MS);
        // Only work ever marked as started can say how long the doing took.
        if (it.started != null) perWork[zi]!.push((it.closed - it.started) / DAY_MS);
        if (bug) inc(bugsOut, zi);
      }
      if (ci >= 0) {
        inc(cohClosed, ci);
        COHORT_AGES.forEach((age, at) => {
          if (zi - ci <= age - 1) inc(cohWithin[at]!, ci);
        });
      }
    }
  }

  // The age of what is still open at the end of every step: the end less the
  // median creation date of the open set.
  const byCreated = items.slice().sort((a, b) => a.created - b.created);
  const perAge: (number | null)[] = [];
  const perAgeN: number[] = [];
  for (let i = 0; i < k; i++) {
    const end = frames[i]!.end;
    const openCreated: number[] = [];
    for (const it of byCreated) {
      if (it.created > end) break;
      if (it.closed == null || it.closed > end) openCreated.push(it.created);
    }
    perAgeN.push(openCreated.length);
    const mid = medianOf(openCreated);
    perAge.push(mid == null ? null : (end - mid) / DAY_MS);
  }

  const points: FlowPoint[] = [];
  let waiting = dWait[0]!;
  let wip = dWip[0]!;
  let done = dDone[0]!;
  for (let i = 0; i < k; i++) {
    waiting += dWait[i + 1]!;
    wip += dWip[i + 1]!;
    done += dDone[i + 1]!;
    const pickup = perPickup[i]!.sort(sortNum);
    const work = perWork[i]!.sort(sortNum);
    const lead = perLead[i]!.sort(sortNum);
    const c = perCreated[i]!;
    const z = perClosed[i]!;
    points.push({
      start: frames[i]!.start,
      end: frames[i]!.end,
      waiting, wip, done,
      created: c, closed: z,
      pickup: medianOf(pickup), pickupN: pickup.length,
      work: medianOf(work), workN: work.length,
      lead: medianOf(lead), leadP85: quantileOf(lead, 0.85), leadN: lead.length,
      age: perAge[i]!, ageN: perAgeN[i]!,
      bugsIn: bugsIn[i]!, bugsOut: bugsOut[i]!,
      bugShareIn: c ? (bugsIn[i]! / c) * 100 : null,
      bugShareOut: z ? (bugsOut[i]! / z) * 100 : null,
    });
  }

  const last = points[points.length - 1]!;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  const created = sum(perCreated);
  const closed = sum(perClosed);
  leads.sort(sortNum);

  const cohorts: Cohort[] = frames.map((f, i) => ({
    start: f.start,
    raised: cohRaised[i]!,
    closed: cohClosed[i]!,
    within: COHORT_AGES.map((age, at) => ({ age, closed: cohWithin[at]![i]!, grown: i + age - 1 < k - 1 })),
  }));

  // How fast the backlog drains per step, and so when it would be empty — an
  // estimate reading the period just gone as the period to come.
  const openNow = last.waiting + last.wip;
  const rate = (closed - created) / k;
  const steps = rate > 0 ? openNow / rate : null;

  return {
    step, points, cohorts, undated, dropped, empty: false,
    totals: {
      created, closed, net: created - closed,
      openNow, wipNow: last.wip, doneNow: last.done,
      scope: last.waiting + last.wip + last.done,
      medianLead: medianOf(leads),
      bugsCreated: sum(bugsIn), bugsClosed: sum(bugsOut),
      drain: { rate, steps, at: steps == null ? null : now + steps * stepDays(step) * DAY_MS },
    },
  };
}

/** Whether the flow's last step is still running at `now` (the charts mark it). */
export function flowRunning(flow: Pick<Flow, "points" | "step">): boolean {
  return lastStepIsRunning(flow.points, flow.step);
}

/**
 * "When the backlog clears", as the row states it:
 * - clear: nothing is open;
 * - never: the backlog is not shrinking (`net` says by how much it grew);
 * - date: `steps` steps (rounded, at least one) at `rate` per step (rounded to
 *   two decimals, so dividing `open` by it lands on `steps`), reaching zero at `at`.
 */
export type Eta =
  | { kind: "clear" }
  | { kind: "never"; net: number }
  | { kind: "date"; steps: number; rate: number; open: number; at: number; step: Step };

export function etaOf(flow: Pick<Flow, "totals" | "step">): Eta {
  const { drain, openNow, net } = flow.totals;
  if (!openNow) return { kind: "clear" };
  if (drain.steps == null || drain.at == null) return { kind: "never", net };
  return {
    kind: "date",
    steps: Math.max(1, Math.round(drain.steps)),
    rate: Math.round(drain.rate * 100) / 100,
    open: openNow,
    at: drain.at,
    step: flow.step,
  };
}

/**
 * One cell of the cohort table:
 * - empty: the step raised nothing, so there is no share of anything;
 * - young: that span has not finished elapsing — a dash, never a nought;
 * - known: `closed` of `raised`, as a rounded percentage.
 */
export type CohortCell =
  | { state: "empty"; raised: 0 }
  | { state: "young"; raised: number }
  | { state: "known"; raised: number; closed: number; share: number };

export interface CohortRow {
  start: number;
  raised: number;
  /** One cell per COHORT_AGES entry, then "by now". */
  cells: CohortCell[];
}

/** The most recent COHORT_ROWS cohorts, as the table draws them. */
export function cohortTable(flow: Pick<Flow, "cohorts">, rows: number = COHORT_ROWS): CohortRow[] {
  return flow.cohorts.slice(-rows).map((c) => {
    const spans = c.within.map((w) => ({ closed: w.closed, known: w.grown }));
    spans.push({ closed: c.closed, known: true });
    const cells: CohortCell[] = spans.map((s) => {
      if (!c.raised) return { state: "empty", raised: 0 };
      if (!s.known) return { state: "young", raised: c.raised };
      return { state: "known", raised: c.raised, closed: s.closed, share: Math.round((s.closed / c.raised) * 100) };
    });
    return { start: c.start, raised: c.raised, cells };
  });
}
