/**
 * The pure logic behind the charts view: a breakdown bar turning a filter on
 * and off (shared/charts/filter.ts), the stale-backend check, the charts'
 * part of the store (tabs, period, step, drill-downs, persisted fields with
 * their fallbacks), and the shared color tokens (client/tokens.ts) that the
 * panel's and the charts' palettes both read.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { bucketFilter } from "../shared/charts/cuts.ts";
import { bucketFilterOn, rowsCarry, toggleBucketFilter } from "../shared/charts/filter.ts";
import { NO_FILTERS, type Filters } from "../shared/tree.ts";
import { z } from "zod";
import { CHARTS_LIVE_INIT, CHARTS_TAB_DEFAULT, CHART_PERIOD_DEFAULT, ChartsTabFields, chartsReducer, isChartsAction, type ChartsState } from "../client/charts-state.ts";
import { REF, alpha, isDarkSurface, mix, over, parseColor } from "../client/tokens.ts";
import { chartColors } from "../client/charts/palette.ts";

const f0: Filters = { ...NO_FILTERS };

test("a bar's filter: set filters add and remove one value", () => {
  const bug = bucketFilter("type", "bug")!;
  assert.equal(bucketFilterOn(f0, bug), false);
  const on = toggleBucketFilter(f0, bug);
  assert.deepEqual(on.types, ["bug"]);
  assert.equal(bucketFilterOn(on, bug), true);
  assert.deepEqual(f0.types, [], "the input is untouched");
  const two = toggleBucketFilter(on, bucketFilter("type", "epic")!);
  assert.deepEqual(two.types, ["bug", "epic"]);
  assert.deepEqual(toggleBucketFilter(two, bug).types, ["epic"]);
});

test("a bar's filter: priority is a number, readiness only ready/blocked, assignee a single value", () => {
  const p1 = bucketFilter("priority", "1")!;
  const on = toggleBucketFilter(f0, p1);
  assert.deepEqual(on.priorities, [1]);
  assert.equal(bucketFilterOn(on, p1), true);
  const ready = bucketFilter("readiness", "ready")!;
  assert.deepEqual(toggleBucketFilter(f0, ready).readiness, ["ready"]);
  assert.equal(bucketFilter("readiness", "plain"), null, "the middle bucket is a group, not a filter");
  const ann = bucketFilter("assignee", "ann")!;
  const a = toggleBucketFilter(f0, ann);
  assert.equal(a.assignee, "ann");
  assert.equal(toggleBucketFilter(a, bucketFilter("assignee", "bob")!).assignee, "bob", "a second person replaces the first");
  assert.equal(toggleBucketFilter(a, ann).assignee, null, "the same person again clears it");
  const tag = bucketFilter("labels", "area:ui")!;
  assert.deepEqual(toggleBucketFilter(f0, tag).labels, ["area:ui"]);
  assert.equal(bucketFilter("labels", "__empty__"), null);
});

test("rowsCarry tells a field never sent from a field that is empty", () => {
  assert.equal(rowsCarry([{ id: "a", closed_at: null }], "closed_at"), true);
  assert.equal(rowsCarry([{ id: "a" }, { id: "b" }], "closed_at"), false);
  assert.equal(rowsCarry([], "closed_at"), false);
});

function ui(over: Partial<ChartsState> = {}): ChartsState {
  return { ...CHARTS_TAB_DEFAULT, ...CHARTS_LIVE_INIT, ...over };
}
const reducer = chartsReducer;
const TAB_DEFAULT = CHARTS_TAB_DEFAULT;
const TabStateSchema = z.object({ ...ChartsTabFields, view: z.enum(["tree", "board", "charts"]).catch("tree") });

test("store: charts defaults — breakdowns, 90 days, auto step", () => {
  assert.equal(TAB_DEFAULT.chartsTab, "cuts");
  assert.equal(TAB_DEFAULT.chartsPeriod, 90);
  assert.equal(CHART_PERIOD_DEFAULT, 90);
  assert.equal(TAB_DEFAULT.chartsStep, "auto");
  assert.equal(isChartsAction({ type: "chartsTab" }), true);
  assert.equal(isChartsAction({ type: "view" }), false, "the store's own actions pass by");
});

test("store: leaving a reading leaves its drill-down", () => {
  const s = ui({ chartsTab: "people", personId: "dana", authorId: "x" });
  const flow = reducer(s, { type: "chartsTab", tab: "flow" });
  assert.equal(flow.chartsTab, "flow");
  assert.equal(flow.personId, null);
  assert.equal(flow.authorId, null);
  const back = reducer(ui({ chartsTab: "authors", authorId: "dana", personId: "p" }), { type: "chartsTab", tab: "authors" });
  assert.equal(back.authorId, "dana", "the same tab again keeps it");
  const people = reducer(ui({ chartsTab: "authors", personId: "p", authorId: "a" }), { type: "chartsTab", tab: "people" });
  assert.equal(people.personId, "p");
  assert.equal(people.authorId, null);
});

test("store: period and step accept only what the bar offers", () => {
  const s = ui();
  assert.equal(reducer(s, { type: "chartsPeriod", period: 30 }).chartsPeriod, 30);
  assert.equal(reducer(s, { type: "chartsPeriod", period: null }).chartsPeriod, null);
  assert.equal(reducer(s, { type: "chartsPeriod", period: 45 }).chartsPeriod, 90);
  assert.equal(reducer(s, { type: "chartsStep", step: "month" }).chartsStep, "month");
  assert.equal(reducer(s, { type: "chartsStep", step: "year" as never }).chartsStep, "auto");
  assert.equal(reducer(s, { type: "person", name: "" }).personId, "", "the unassigned row is a person too");
  assert.deepEqual(reducer(s, { type: "peopleSort", sort: { key: "wip", dir: -1 } }).peopleSort, { key: "wip", dir: -1 });
});

test("store schema: a bad charts value falls back alone", () => {
  const parsed = TabStateSchema.parse({ ...TAB_DEFAULT, chartsTab: "pie", chartsPeriod: 45, chartsStep: "hour", view: "charts" });
  assert.equal(parsed.chartsTab, "cuts");
  assert.equal(parsed.chartsPeriod, 90);
  assert.equal(parsed.chartsStep, "auto");
  assert.equal(parsed.view, "charts", "the rest survives");
  assert.equal(TabStateSchema.parse({ ...TAB_DEFAULT, chartsPeriod: null }).chartsPeriod, null, "all time persists");
  assert.equal(TabStateSchema.parse({}).chartsPeriod, 90, "an old tab without the field gets the default");
});

test("tokens: mix, alpha, over and the light/dark rule", () => {
  assert.equal(mix("#ffffff", 50, "#000000"), "#808080");
  assert.equal(mix("var(--x)", 50, "#000"), "var(--x)");
  assert.equal(alpha("#ff0000", 50), "rgba(255, 0, 0, 0.5)");
  assert.equal(over("rgba(0, 0, 0, 0.5)", "#ffffff"), "#808080");
  assert.deepEqual(parseColor("#abcd"), { r: 170, g: 187, b: 204, a: 221 / 255 });
  assert.equal(isDarkSurface("#181B1A"), true);
  assert.equal(isDarkSurface("#ffffff"), false);
});

test("tokens: the charts' palette takes the shared reference hues", () => {
  const dark = chartColors({
    surface0: "#181B1A", surface1: "#1E2120", surface2: "#272A29", border: "#252B2A", foreground: "#fafafa",
    foregroundMuted: "#A1A5A4", accent: "#20744A", accentForeground: "#ffffff",
    statusSuccess: "#6cb17b", statusWarning: "#c09664", statusDanger: "#d8847b",
  } as never);
  assert.equal(dark.dark, true);
  assert.equal(dark.accent, REF.dark.accent);
  assert.deepEqual(dark.labels, REF.dark.labels);
  assert.deepEqual(dark.types, REF.dark.type);
});
