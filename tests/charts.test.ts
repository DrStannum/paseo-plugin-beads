/**
 * The chart aggregations (shared/charts/), against numbers counted straight
 * off the synthetic fixture — counted a different way than the aggregations
 * count them, so a mistake in the bucketing cannot agree with itself. These
 * are the "counted from the fixture" checks of the CloudCLI tab's preview
 * (cloudcli-plugin-beads, tests/preview.mjs: BOARD_EXPECT, CHARTS_SHOWN,
 * DASH_*), restated as unit tests, plus the edges the pictures cannot show.
 *
 * Buckets are cut in local time, as in the reference; the suite pins the
 * process to UTC so the expectations hold on any machine, and one test moves
 * to a DST zone on purpose.
 */
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { test } from "node:test";
// @ts-ignore -- plain JS fixture without declarations
import { FIXTURE, TEAM_NOW } from "./fixture/data.mjs";
import type { TreeRow } from "../shared/types.ts";
import {
  aggregateAuthors, aggregateCuts, aggregateFlow, aggregatePeople, bucketFilter, bucketNext, bucketStart,
  chartStep, cohortTable, COHORT_AGES, CHART_MAX_POINTS, cutMax, DAY_MS, etaOf, flowGrid, flowItems, flowRunning,
  fmtDateShort, lastStepIsRunning, markRank, medianOf, naturalCmp, nextSort, personWip, quantileOf, readinessOf,
  rollingMean, shareOf, smoothingWindow, sortAuthors, sortPeople, stepDelta, STATUS_ORDER, tempoLabel, tsOf,
  type ChartRow, type Cut,
} from "../shared/charts/index.ts";

// A tree row is a chart row: the type the server sends must stay assignable.
const _rowFits: (r: TreeRow) => ChartRow = (r) => r;
void _rowFits;

const TREE: ChartRow[] = FIXTURE.tree.issues;
const ALL: ChartRow[] = [...FIXTURE.tree.issues, ...FIXTURE.team];
const NOW = Date.parse(TEAM_NOW);

// ── counted from the fixture, without buckets ──
const SHOWN = TREE.filter((i) => i.status !== "closed");
const DATED = ALL.filter((i) => i.created_at);
const CLOSED = ALL.filter((i) => i.status === "closed");
const UNDATED = ALL.length - DATED.length;
const OPEN_DATED = DATED.filter((i) => i.status !== "closed");
const HELD = OPEN_DATED.filter((i) => i.started_at || i.status === "in_progress" || i.status === "blocked");
const BUGS_IN = DATED.filter((i) => i.issue_type === "bug").length;
const BUGS_OUT = CLOSED.filter((i) => i.issue_type === "bug").length;
const median = (xs: number[]) => {
  const s = xs.slice().sort((a, b) => a - b);
  if (!s.length) return null;
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const leadOf = (i: ChartRow) => {
  const c = Date.parse(i.created_at!);
  const z = Date.parse(i.closed_at || i.updated_at || i.created_at!);
  return Math.max(0, z - c) / DAY_MS;
};
const countBy = <T>(xs: T[], f: (x: T) => string) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(f(x), (m.get(f(x)) || 0) + 1);
  return m;
};
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const cut = (cuts: Cut[], key: string) => cuts.find((c) => c.key === key)!;

function row(id: string, extra: Partial<ChartRow> = {}): ChartRow {
  return { id, status: "open", issue_type: "task", priority: 2, labels: [], ...extra };
}
const iso = (ms: number) => new Date(ms).toISOString();

// ── breakdowns ──

test("cuts: every bucket set sums to the shown issues, except tags", () => {
  const cuts = aggregateCuts(SHOWN);
  assert.deepEqual(cuts.map((c) => c.key), ["assignee", "status", "priority", "readiness", "type", "labels"]);
  for (const c of cuts) {
    assert.equal(c.total, SHOWN.length);
    const n = sum(c.buckets.map((b) => b.count));
    if (c.key === "labels") {
      assert.equal(c.overCounts, true);
      assert.equal(n, sum(SHOWN.map((i) => (i.labels || []).length || 1)));
    } else {
      assert.equal(c.overCounts, false);
      assert.equal(n, SHOWN.length, c.key);
    }
  }
});

test("cuts: status lanes match the board's own count, in bd's order", () => {
  const status = cut(aggregateCuts(SHOWN), "status");
  const want = STATUS_ORDER.filter((s) => s !== "closed")
    .map((s) => [s, TREE.filter((i) => i.status === s).length] as const).filter(([, n]) => n > 0);
  assert.deepEqual(status.buckets.map((b) => [b.key, b.count]), want);
});

test("cuts: ranked cuts keep the empty bucket and fold the tail", () => {
  const cuts = aggregateCuts(SHOWN);
  const a = cut(cuts, "assignee");
  const unassigned = SHOWN.filter((i) => !i.assignee).length;
  assert.deepEqual(a.buckets[a.buckets.length - 1], { key: "__empty__", kind: "empty", count: unassigned });
  const names = countBy(SHOWN.filter((i) => i.assignee), (i) => i.assignee!);
  for (const b of a.buckets.filter((x) => x.kind === "value")) assert.equal(b.count, names.get(b.key));

  // Ten distinct tags, counts 10..1: eight named, the last two folded.
  const many: ChartRow[] = [];
  for (let t = 0; t < 10; t++) for (let n = 0; n < 10 - t; n++) many.push(row(`x-${t}-${n}`, { labels: [`tag${t}`] }));
  many.push(row("x-none"));
  const labels = cut(aggregateCuts(many), "labels");
  assert.deepEqual(labels.buckets.map((b) => b.key),
    ["tag0", "tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "__other__", "__empty__"]);
  assert.equal(labels.buckets[8]!.count, 2 + 1);
  assert.equal(cutMax(labels), 10);
});

test("cuts: readiness, priority and type", () => {
  const cuts = aggregateCuts(SHOWN);
  const r = cut(cuts, "readiness");
  assert.equal(r.buckets.find((b) => b.key === "ready")?.count, SHOWN.filter((i) => i.ready).length);
  const p = aggregateCuts([row("a", { priority: null }), row("b", { priority: 0 }), row("c", { priority: 7 })]);
  assert.deepEqual(cut(p, "priority").buckets.map((b) => [b.key, b.kind]), [["0", "value"], ["7", "value"], ["__unset__", "unset"]]);
  const ty = cut(aggregateCuts([row("a", { issue_type: "zeta" }), row("b", { issue_type: "bug" }), row("c", { issue_type: null })]), "type");
  assert.deepEqual(ty.buckets.map((b) => b.key), ["bug", "task", "zeta"]);
});

test("cuts: empty input has no buckets", () => {
  for (const c of aggregateCuts([])) {
    assert.equal(c.total, 0);
    assert.deepEqual(c.buckets, []);
  }
});

test("bucketFilter: one value is a filter, a group is not", () => {
  assert.deepEqual(bucketFilter("status", "open"), { set: "statuses", value: "open" });
  assert.deepEqual(bucketFilter("priority", "1"), { set: "priorities", value: 1 });
  assert.deepEqual(bucketFilter("assignee", "alex@example.com"), { one: "assignee", value: "alex@example.com" });
  assert.deepEqual(bucketFilter("readiness", "blocked"), { set: "readiness", value: "blocked" });
  assert.equal(bucketFilter("readiness", "plain"), null);
  for (const k of ["__other__", "__empty__", "__unset__"]) assert.equal(bucketFilter("labels", k), null);
});

// ── over time ──

test("flow, whole history: tiles and stack agree with the fixture", () => {
  const f = aggregateFlow(ALL, null, NOW);
  assert.equal(f.empty, false);
  assert.equal(f.step, "week");
  assert.equal(f.undated, UNDATED);
  assert.equal(f.dropped, 0);
  assert.equal(f.totals.created, DATED.length);
  assert.equal(f.totals.closed, CLOSED.length);
  assert.equal(f.totals.net, DATED.length - CLOSED.length);
  assert.equal(f.totals.openNow, OPEN_DATED.length);
  assert.equal(f.totals.wipNow, HELD.length);
  assert.equal(f.totals.doneNow, CLOSED.length);
  assert.equal(f.totals.scope, DATED.length);
  assert.equal(f.totals.bugsCreated, BUGS_IN);
  assert.equal(f.totals.bugsClosed, BUGS_OUT);
  assert.ok(Math.abs(f.totals.medianLead! - median(CLOSED.map(leadOf))!) < 1e-9);

  const last = f.points[f.points.length - 1]!;
  assert.equal(last.wip + last.waiting, f.totals.openNow);
  assert.equal(last.end, NOW);
  assert.equal(sum(f.points.map((p) => p.created)), f.totals.created);
  assert.equal(sum(f.points.map((p) => p.closed)), f.totals.closed);
  assert.equal(sum(f.points.map((p) => p.bugsIn)), BUGS_IN);
  assert.equal(sum(f.points.map((p) => p.bugsOut)), BUGS_OUT);
  // The stack's height at every step is everything created by its end.
  for (const p of f.points) {
    assert.equal(p.waiting + p.wip + p.done, DATED.filter((i) => Date.parse(i.created_at!) <= p.end).length);
  }
  // Steps are contiguous and cut on Mondays.
  f.points.forEach((p, i) => {
    assert.equal(new Date(p.start).getUTCDay(), 1);
    if (i) assert.equal(p.start, f.points[i - 1]!.end + 1);
  });
});

test("flow, a 90-day period: only what happened since the first step counts", () => {
  const f = aggregateFlow(ALL, 90, NOW);
  assert.equal(f.step, "week");
  // Monday 00:00 UTC of the week holding now − 90 days, computed by hand.
  const d = new Date(NOW - 90 * DAY_MS);
  const from = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  assert.equal(f.points[0]!.start, from);
  const created = DATED.filter((i) => Date.parse(i.created_at!) >= from).length;
  const closed = CLOSED.filter((i) => Date.parse(i.closed_at || i.updated_at!) >= from).length;
  assert.equal(f.totals.created, created);
  assert.equal(f.totals.closed, closed);
  assert.equal(f.totals.net, created - closed);
  // The state now does not depend on the period.
  assert.equal(f.totals.openNow, OPEN_DATED.length);
  assert.equal(f.totals.wipNow, HELD.length);
});

test("flow: the time readings hold together", () => {
  for (const period of [null, 90, 30]) {
    const f = aggregateFlow(ALL, period, NOW);
    for (const p of f.points) {
      assert.ok(p.workN <= p.leadN);
      assert.equal(p.work == null, p.workN === 0);
      assert.equal(p.pickup == null, p.pickupN === 0);
      assert.equal(p.lead == null, p.leadN === 0);
      assert.equal(p.leadN, p.closed);
      if (p.lead != null) assert.ok(p.leadP85! >= p.lead);
      assert.equal(p.age == null, p.ageN === 0);
      assert.equal(p.bugShareIn == null, p.created === 0);
      assert.equal(p.bugShareOut == null, p.closed === 0);
    }
    const last = f.points[f.points.length - 1]!;
    assert.equal(last.ageN, f.totals.openNow);
  }
  // The whole-history reading has empty steps, so the gaps are really exercised.
  const f = aggregateFlow(ALL, null, NOW);
  assert.ok(f.points.some((p) => p.workN === 0));
});

test("flow: the step follows the period, or the reader's pin", () => {
  assert.equal(aggregateFlow(ALL, 30, NOW).step, "day");
  assert.equal(aggregateFlow(ALL, 180, NOW).step, "week");
  const byDay = aggregateFlow(ALL, null, NOW, "day");
  assert.equal(byDay.step, "day");
  assert.equal(byDay.totals.created, DATED.length);
  const byMonth = aggregateFlow(ALL, null, NOW, "month");
  assert.equal(byMonth.points[0]!.start, Date.UTC(2026, 4, 1));
  assert.equal(byMonth.points.length, 4); // May..August
  assert.equal(byMonth.totals.closed, CLOSED.length);
});

test("flow: a pinned step past the ceiling drops the oldest end and says so", () => {
  const start = Date.UTC(2024, 0, 1, 10);
  const rows = [row("a", { created_at: iso(start) }), row("b", { created_at: iso(start + 400 * DAY_MS) })];
  const now = start + 500 * DAY_MS;
  const f = aggregateFlow(rows, null, now, "day");
  assert.equal(f.points.length, CHART_MAX_POINTS);
  assert.equal(f.dropped, 501 - CHART_MAX_POINTS);
  // What came before the series still counts in the state, not in the period.
  assert.equal(f.totals.created, 1);
  assert.equal(f.totals.openNow, 2);
});

test("flow: empty input, undated rows and impossible dates", () => {
  const e = aggregateFlow([], null, NOW);
  assert.equal(e.empty, true);
  assert.deepEqual(e.points, []);
  assert.equal(e.totals.medianLead, null);
  assert.deepEqual(etaOf(e), { kind: "clear" });
  assert.equal(aggregateFlow([row("u"), row("v", { created_at: "garbage" })], null, NOW).undated, 2);
  // Dated after now: no step to draw, and no crash.
  assert.equal(aggregateFlow([row("f", { created_at: iso(NOW + DAY_MS) })], null, NOW).empty, true);

  const c = NOW - 10 * DAY_MS;
  const { items } = flowItems([
    row("early", { created_at: iso(c), started_at: iso(c - DAY_MS), closed_at: iso(c - DAY_MS), status: "closed" }),
    row("reopen", { created_at: iso(c), started_at: iso(c + 5 * DAY_MS), closed_at: iso(c + 2 * DAY_MS), status: "closed" }),
    row("nodate", { created_at: iso(c), updated_at: iso(c + 3 * DAY_MS), status: "in_progress" }),
    row("shut", { created_at: iso(c), status: "closed" }),
  ]);
  assert.deepEqual(items.map((i) => [i.started, i.closed]), [
    [c, c], [null, c + 2 * DAY_MS], [c + 3 * DAY_MS, null], [null, c],
  ]);
});

test("ETA: clear, never, and a date whose division can be redone", () => {
  const t0 = NOW - 20 * DAY_MS;
  const done = (id: string) => row(id, { created_at: iso(t0), closed_at: iso(t0 + DAY_MS), status: "closed" });
  assert.deepEqual(etaOf(aggregateFlow([done("a"), done("b")], 30, NOW)), { kind: "clear" });

  const growing = [done("a"), row("b", { created_at: iso(t0) }), row("c", { created_at: iso(t0 + 2 * DAY_MS) })];
  const g = aggregateFlow(growing, 30, NOW);
  assert.deepEqual(etaOf(g), { kind: "never", net: 2 });
  assert.equal(g.totals.drain.steps, null);

  // Closing what had been raised before the period: the backlog shrinks.
  const old = NOW - 200 * DAY_MS;
  const shrinking = [
    ...[1, 2, 3, 4, 5, 6].map((n) => row(`s${n}`, { created_at: iso(old), closed_at: iso(NOW - n * DAY_MS), status: "closed" })),
    ...[1, 2, 3].map((n) => row(`o${n}`, { created_at: iso(old) })),
  ];
  const s = aggregateFlow(shrinking, 30, NOW);
  assert.equal(s.step, "day");
  const eta = etaOf(s);
  assert.equal(eta.kind, "date");
  if (eta.kind !== "date") return;
  const k = s.points.length;
  assert.equal(eta.open, 3);
  assert.ok(Math.abs(s.totals.drain.rate - 6 / k) < 1e-12);
  assert.equal(eta.steps, Math.max(1, Math.round(3 / (6 / k))));
  assert.ok(Math.abs(Math.round(eta.open / eta.rate) - eta.steps) <= 1);
  assert.equal(eta.at, NOW + (3 / (6 / k)) * DAY_MS);
});

test("cohorts: spans only count once they have elapsed, and only grow", () => {
  const f = aggregateFlow(ALL, null, NOW);
  assert.equal(f.cohorts.length, f.points.length);
  const k = f.cohorts.length;
  f.cohorts.forEach((c, i) => {
    assert.equal(c.raised, f.points[i]!.created);
    c.within.forEach((w, at) => {
      assert.equal(w.age, COHORT_AGES[at]);
      assert.equal(w.grown, i + w.age - 1 < k - 1);
      if (at) assert.ok(w.closed >= c.within[at - 1]!.closed);
    });
    assert.ok(c.closed >= c.within[c.within.length - 1]!.closed);
  });
  // Independently: the intake of each step, and how much of it is closed now.
  for (const c of f.cohorts) {
    const end = c.start + 7 * DAY_MS;
    const intake = DATED.filter((i) => { const t = Date.parse(i.created_at!); return t >= c.start && t < end; });
    assert.equal(c.raised, intake.length);
    assert.equal(c.closed, intake.filter((i) => i.status === "closed").length);
  }
  const table = cohortTable(f);
  assert.equal(table.length, Math.min(12, k));
  const lastRow = table[table.length - 1]!;
  if (lastRow.raised) {
    assert.deepEqual(lastRow.cells.slice(0, 3).map((c) => c.state), ["young", "young", "young"]);
    assert.equal(lastRow.cells[3]!.state, "known");
  }
  for (const r of table) {
    for (const cell of r.cells) {
      if (!r.raised) assert.equal(cell.state, "empty");
      if (cell.state === "known") assert.equal(cell.share, Math.round((cell.closed / r.raised) * 100));
    }
  }
  assert.ok(table.some((r) => r.raised && r.cells.some((c) => c.state === "young")));
});

test("pace: smoothing window and the running step", () => {
  assert.deepEqual([smoothingWindow("day"), smoothingWindow("week"), smoothingWindow("month")], [7, 4, 3]);
  assert.deepEqual(rollingMean([2, 4, 6, 8], 2), [2, 3, 5, 7]);
  assert.deepEqual(rollingMean([], 3), []);
  const f = aggregateFlow(ALL, 90, NOW, "week");
  // TEAM_NOW is a Monday noon: the last week has barely begun.
  assert.equal(flowRunning(f), true);
  assert.equal(lastStepIsRunning([{ start: Date.UTC(2026, 7, 31), end: Date.UTC(2026, 8, 1) - 1 }], "day"), false);
  assert.equal(lastStepIsRunning([], "day"), false);
  assert.deepEqual(stepDelta([3, 5, 2], 0), { first: true, value: 3 });
  assert.deepEqual(stepDelta([3, 5, 2], 2), { first: false, value: -3 });
});

// ── people and authors ──

test("people, whole history: closes add up to the fixture's", () => {
  const p = aggregatePeople(ALL, null, NOW);
  assert.equal(p.empty, false);
  assert.equal(sum(p.people.map((x) => x.closed)), CLOSED.length);
  assert.equal(sum(p.people.map((x) => x.total)), DATED.length);
  assert.equal(p.people[p.people.length - 1]!.unassigned, true);
  const closedBy = countBy(CLOSED, (i) => i.assignee || "");
  const heldBy = countBy(HELD, (i) => i.assignee || "");
  for (const x of p.people) {
    assert.equal(x.closed, closedBy.get(x.name) || 0, x.name);
    assert.equal(x.wip, heldBy.get(x.name) || 0, x.name);
    assert.equal(x.doneAll + x.wip + x.waiting, x.total);
    assert.equal(sum(x.series), x.closed);
    assert.equal(x.series.length, p.points);
    const mine = CLOSED.filter((i) => (i.assignee || "") === x.name).map(leadOf);
    const m = median(mine);
    if (m == null) assert.equal(x.medianLead, null);
    else assert.ok(Math.abs(x.medianLead! - m) < 1e-9);
  }
  const named = p.people.filter((x) => !x.unassigned);
  for (let i = 1; i < named.length; i++) assert.ok(named[i - 1]!.closed >= named[i]!.closed);
});

test("people: sorting keeps the unassigned last and missing medians at the end", () => {
  const { people } = aggregatePeople(ALL, null, NOW);
  const byName = sortPeople(people, { key: "name", dir: 1 });
  assert.equal(byName[byName.length - 1]!.unassigned, true);
  const lead = sortPeople(people, { key: "medianLead", dir: -1 }).filter((x) => !x.unassigned);
  const seenNull = lead.findIndex((x) => x.medianLead == null);
  if (seenNull >= 0) assert.ok(lead.slice(seenNull).every((x) => x.medianLead == null));
  assert.deepEqual(nextSort({ key: null, dir: 1 }, "closed"), { key: "closed", dir: -1 });
  assert.deepEqual(nextSort({ key: null, dir: 1 }, "name"), { key: "name", dir: 1 });
  assert.deepEqual(nextSort({ key: "closed", dir: -1 }, "closed"), { key: "closed", dir: 1 });
});

test("people: what one person is holding, oldest first", () => {
  for (const name of ["mei@example.com", "dana@example.com", ""]) {
    const wip = personWip(ALL, name, NOW);
    const want = ALL.filter((i) => (i.assignee || "") === name && i.status !== "closed"
      && (i.started_at || i.status === "in_progress" || i.status === "blocked"));
    assert.equal(wip.length, want.length, name);
    for (let i = 1; i < wip.length; i++) assert.ok(wip[i - 1]!.ageDays >= wip[i]!.ageDays);
    for (const w of wip) assert.equal(w.stale, w.ageDays >= 14);
  }
});

test("authors, whole history: every dated issue is raised exactly once", () => {
  const a = aggregateAuthors(ALL, null, NOW);
  assert.equal(sum(a.authors.map((x) => x.raised)), DATED.length);
  assert.equal(sum(a.authors.map((x) => x.total)), DATED.length);
  const raisedBy = countBy(DATED, (i) => i.created_by || "");
  for (const x of a.authors) {
    assert.equal(x.raised, raisedBy.get(x.name), x.name);
    assert.equal(x.closed + x.open, x.total);
    assert.equal(sum(x.series), x.raised);
  }
  assert.equal(a.authors[a.authors.length - 1]!.anonymous, true);
  assert.equal(a.authors[0]!.name, "dana@example.com");
  const byOpen = sortAuthors(a.authors, { key: "open", dir: -1 });
  assert.equal(byOpen[byOpen.length - 1]!.anonymous, true);

  // Over a period, raised narrows to the period and total does not.
  const q = aggregateAuthors(ALL, 30, NOW);
  assert.equal(sum(q.authors.map((x) => x.total)), DATED.length);
  assert.ok(sum(q.authors.map((x) => x.raised)) < DATED.length);
});

test("people and authors: empty and undated input", () => {
  assert.deepEqual(aggregatePeople([], null, NOW).people, []);
  assert.equal(aggregatePeople([row("u")], null, NOW).undated, 1);
  assert.equal(aggregateAuthors([], 30, NOW).empty, true);
});

test("people, authors and flow share one grid", () => {
  const f = aggregateFlow(ALL, 90, NOW, "week");
  const p = aggregatePeople(ALL, 90, NOW, "week");
  const a = aggregateAuthors(ALL, 90, NOW, "week");
  assert.deepEqual(p.frames, f.points.map((x) => ({ start: x.start, end: x.end })));
  assert.deepEqual(a.bounds, p.bounds);
});

// ── buckets, steps and small statistics ──

test("chartStep thresholds", () => {
  assert.equal(chartStep(45, 0), "day");
  assert.equal(chartStep(46, 0), "week");
  assert.equal(chartStep(400, 0), "week");
  assert.equal(chartStep(401, 0), "month");
  assert.equal(chartStep(null, 10), "day");
  assert.equal(chartStep(null, 1000), "month");
});

test("bucket edges in UTC: day, week from Monday, month", () => {
  const sun = Date.UTC(2026, 7, 30, 23, 59); // Sunday 30 Aug
  assert.equal(bucketStart(sun, "day"), Date.UTC(2026, 7, 30));
  assert.equal(bucketStart(sun, "week"), Date.UTC(2026, 7, 24));
  assert.equal(bucketStart(Date.UTC(2026, 7, 31), "week"), Date.UTC(2026, 7, 31));
  assert.equal(bucketStart(sun, "month"), Date.UTC(2026, 7, 1));
  assert.equal(bucketNext(Date.UTC(2026, 1, 1), "month"), Date.UTC(2026, 2, 1));
  assert.equal(bucketNext(Date.UTC(2026, 11, 28), "week"), Date.UTC(2027, 0, 4));
  const g = flowGrid([{ created: Date.UTC(2026, 7, 26, 9) }], null, Date.UTC(2026, 7, 28, 12), "day");
  assert.equal(g.k, 3);
  assert.equal(g.bucketOf(Date.UTC(2026, 7, 25)), -1);
  assert.equal(g.bucketOf(Date.UTC(2026, 7, 27)), 1);
  assert.equal(g.bucketOf(Date.UTC(2026, 7, 28) - 1), 1);
  assert.equal(g.frames[2]!.end, Date.UTC(2026, 7, 28, 12));
});

test("bucket edges across DST follow the calendar, not 24 hours", () => {
  const prev = process.env.TZ;
  process.env.TZ = "Europe/Berlin";
  try {
    const sat = bucketStart(Date.UTC(2026, 2, 28, 12), "day"); // Sat 28 Mar, the night before DST
    const sun = bucketNext(sat, "day");
    assert.equal(sun - sat, 24 * 3600000);
    assert.equal(bucketNext(sun, "day") - sun, 23 * 3600000);
    assert.equal(new Date(bucketNext(sun, "day")).getHours(), 0);
  } finally {
    process.env.TZ = prev;
  }
});

test("quantiles, shares, ids and readiness", () => {
  assert.equal(quantileOf([], 0.5), null);
  assert.equal(medianOf([1, 2, 3, 4]), 2.5);
  assert.equal(quantileOf([0, 10], 0.85), 8.5);
  assert.equal(medianOf([7]), 7);
  assert.equal(shareOf(1, 1000), "<1 %");
  assert.equal(shareOf(999, 1000), ">99 %");
  assert.equal(shareOf(1, 3), "33 %");
  assert.equal(shareOf(0, 0), "");
  assert.equal(naturalCmp("bd-a1.2", "bd-a1.10") < 0, true);
  assert.equal(naturalCmp("a", "a"), 0);
  assert.equal(readinessOf({ ready: true, status: "open" }), "ready");
  assert.equal(readinessOf({ blockers: ["x"], status: "open" }), "blocked");
  assert.equal(readinessOf({ blockers: ["x"], status: "closed" }), "plain");
  assert.equal(markRank({ blockers: ["x"], status: "open" }), 2);
  assert.equal(tsOf("nope"), null);
});

test("formatting takes its locale and its now", () => {
  const now = Date.UTC(2026, 7, 31);
  assert.equal(fmtDateShort("2026-03-05T10:00:00Z", "en-US", now), "Mar 5");
  assert.equal(fmtDateShort("2025-03-05T10:00:00Z", "en-US", now), "Mar 5, 25");
  assert.equal(fmtDateShort("2025-03-05T10:00:00Z", "en-US", Date.UTC(2025, 0, 1)), "Mar 5");
  assert.equal(fmtDateShort("", "en-US", now), "");
  assert.equal(tempoLabel(Date.UTC(2026, 7, 24), "week", "en-US"), "Aug 24 – 30");
  assert.equal(tempoLabel(Date.UTC(2026, 7, 31), "week", "en-US"), "Aug 31 – Sep 6");
  assert.equal(tempoLabel(Date.UTC(2026, 7, 1), "month", "en-US"), "August 2026");
});
