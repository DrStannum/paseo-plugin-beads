/**
 * The chart drawing layer (shared/charts/scene.ts) and its palette
 * (client/charts/palette.ts): the scenes for representative data — empty, a
 * single step, gaps, huge values — the date axis' tick choice, and the markup
 * the native renderer hands to the host: escaped, free of anything the host
 * refuses, and inside its 64 KiB.
 */
process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { test } from "node:test";
import { findSvgIconProblem, PLUGIN_SVG_ICON_MAX_BYTES } from "@getpaseo/plugin";
// @ts-ignore -- plain JS fixture without declarations
import { FIXTURE, TEAM_NOW } from "./fixture/data.mjs";
import {
  aggregateFlow, areaPath, axisLabel, axisNumber, barPercent, cohortWash, escapeSvgText, lineScene, linePath,
  MIN_PLOT_W, pairedBarsScene, PAD_L, PAD_R, sceneToSvgMarkup, scaleMax, seriesBarsScene, sparklineScene, stackScene,
  SVG_MAX_BYTES, tickEvery, tickIndices, utf8Bytes, yScale, type ChartRow, type Mark, type Scene,
} from "../shared/charts/index.ts";
import { bucketToken, chartColors, colorResolver, labelSlots, luminance, mix, parseColor } from "../client/charts/palette.ts";

const LIGHT = {
  surface0: "#ffffff", surface1: "#fafafa", surface2: "#f4f4f5", border: "#e4e4e7", foreground: "#1a1a1e",
  foregroundMuted: "#71717a", accent: "#20744A", accentForeground: "#ffffff",
  statusSuccess: "#3e704a", statusWarning: "#7b5d39", statusDanger: "#9d433b",
};
const DARK = { ...LIGHT, surface0: "#181B1A", surface1: "#1E2120", surface2: "#272A29", foreground: "#fafafa" };
const color = colorResolver(chartColors(LIGHT));

const WEEK = 7 * 86400000;
const starts = (n: number) => Array.from({ length: n }, (_, i) => Date.UTC(2026, 5, 1) + i * WEEK);
const of = <K extends Mark["kind"]>(s: Scene, kind: K) => s.marks.filter((m): m is Extract<Mark, { kind: K }> => m.kind === kind);
const base = (n: number, width = 600) => ({ starts: starts(n), step: "week" as const, width, locale: "en-US", aria: "chart" });

// ── axis ──

test("tickEvery: about one label per 90 px, between 2 and 8 labels", () => {
  assert.equal(tickEvery(13, 860), 2); // 8 wanted → every 2nd
  assert.equal(tickEvery(13, 320), 5); // 3 wanted
  assert.equal(tickEvery(1, 860), 1);
  assert.equal(tickEvery(180, 2000), 23); // capped at 8
  assert.equal(tickEvery(10, 100), 5); // never fewer than 2
});

test("tickIndices counts back from the last step, oldest first", () => {
  assert.deepEqual(tickIndices(13, 860), [0, 2, 4, 6, 8, 10, 12]);
  assert.deepEqual(tickIndices(10, 320), [1, 5, 9]);
  assert.deepEqual(tickIndices(1, 600), [0]);
  assert.deepEqual(tickIndices(0, 600), []);
});

test("axisLabel: day/week by date, month by month and 2-digit year", () => {
  const at = Date.UTC(2026, 7, 3);
  assert.equal(axisLabel(at, "week", "en-US"), "Aug 3");
  assert.equal(axisLabel(at, "month", "en-US"), "Aug 26");
  assert.match(axisLabel(at, "day", "ru-RU"), /3 авг/);
});

test("axisNumber stays short for huge values", () => {
  assert.equal(axisNumber(0), "0");
  assert.equal(axisNumber(9.84), "9.8");
  assert.equal(axisNumber(12345), "12k");
  assert.equal(axisNumber(3_400_000), "3.4M");
  assert.equal(axisNumber(2.5e9), "2.5G");
});

test("scales: max of the known values, at least 1; values clamp into the box", () => {
  assert.equal(scaleMax([]), 1);
  assert.equal(scaleMax([null, 0.2, undefined]), 1);
  assert.equal(scaleMax([3, null, 7, Infinity]), 7);
  const y = yScale(10, 10, 110);
  assert.equal(y(0), 110);
  assert.equal(y(10), 10);
  assert.equal(y(20), 10);
  assert.equal(y(-5), 110);
  assert.equal(linePath([{ x: 1, y: 2 }, { x: 3.04, y: 4 }]), "M1,2 L3,4");
  assert.equal(areaPath([{ x: 0, y: 0 }, { x: 1, y: 0 }], [{ x: 0, y: 5 }, { x: 1, y: 5 }]), "M0,0 L1,0 L1,5 L0,5 Z");
});

// ── lines ──

test("lineScene: gaps break the line, a lone value is a dot, one strip per step", () => {
  const s = lineScene({ ...base(7), series: [{ values: [1, 2, null, 4, null, 5, 6], color: "accent" }], tip: (i) => `t${i}` });
  const paths = of(s, "path");
  assert.equal(paths.length, 2, "runs [0..1] and [5..6]");
  assert.equal(of(s, "circle").length, 1, "the lone 4 between two gaps");
  const hits = s.marks.filter((m) => m.hit);
  assert.equal(hits.length, 7);
  assert.deepEqual(hits.map((h) => h.tip), ["t0", "t1", "t2", "t3", "t4", "t5", "t6"]);
  // The gridline numbers: 0 and the largest known value.
  const nums = of(s, "text").filter((t) => t.anchor === "end").map((t) => t.text);
  assert.deepEqual(nums, ["0", "6"]);
});

test("lineScene: a fixed max (shares) and a running last step dashed and noted", () => {
  const s = lineScene({
    ...base(4), max: 100, fmt: (v) => `${v} %`, running: true, runningLabel: "still running",
    series: [{ values: [10, 20, 30, 40], color: "muted" }], tip: () => "",
  });
  const nums = of(s, "text").filter((t) => t.anchor === "end" && t.text.endsWith("%")).map((t) => t.text);
  assert.deepEqual(nums, ["0 %", "100 %"]);
  const paths = of(s, "path");
  assert.equal(paths.length, 2);
  assert.equal(paths[0]!.dash, undefined);
  assert.equal(paths[1]!.dash, "4 3");
  assert.ok(of(s, "text").some((t) => t.text === "still running"));
});

test("lineScene: a band between the first two series only where both are known", () => {
  const s = lineScene({
    ...base(5), tip: () => "",
    series: [{ values: [1, 2, null, 2, 3], color: "accent", band: true }, { values: [2, 4, 5, 3, 6], color: "accentSoft" }],
  });
  const bands = of(s, "path").filter((p) => p.fill && p.fill !== "none");
  assert.equal(bands.length, 2, "[0..1] and [3..4]");
  assert.ok(bands.every((b) => b.opacity === 0.16 && b.fill === "accentSoft"));
});

test("lineScene: empty and single-step series draw without NaN", () => {
  for (const n of [0, 1]) {
    const s = lineScene({ ...base(n), series: [{ values: n ? [3] : [], color: "accent" }], tip: () => "x" });
    assert.ok(!JSON.stringify(s).includes("NaN"), `n=${n}`);
    assert.equal(of(s, "circle").length, n);
  }
});

// ── the cumulative flow and bars ──

test("stackScene: one band per layer, stacked; a single step spans the plot", () => {
  const s = stackScene({
    ...base(3), layers: [{ values: [1, 2, 3], color: "good" }, { values: [1, 1, 1], color: "accent" }, { values: [2, 2, 2], color: "muted" }],
  });
  assert.equal(of(s, "path").length, 3);
  assert.ok(of(s, "text").some((t) => t.text === "6"), "the top of the scale is the tallest total");
  const one = stackScene({ ...base(1), layers: [{ values: [4], color: "good" }] });
  const d = of(one, "path")[0]!.d;
  assert.ok(d.startsWith(`M${PAD_L},`) && d.includes(`L${600 - PAD_R},`), d);
});

test("pairedBarsScene: zeros draw nothing, bars dim, each its own group with its tip", () => {
  const s = pairedBarsScene({
    ...base(3),
    left: { values: [2, 0, 5], color: "muted", tip: (i) => `L${i}`, key: "opened" },
    right: { values: [1, 3, 0], color: "good", tip: (i) => `R${i}`, key: "closed" },
  });
  const bars = of(s, "rect").filter((r) => !r.hit);
  assert.equal(bars.length, 4);
  assert.ok(bars.every((b) => b.dim && b.h >= 1));
  assert.deepEqual(bars.map((b) => b.tip), ["L0", "R0", "R1", "L2"]);
  assert.equal(new Set(bars.map((b) => b.group)).size, 4);
  // The pair stands apart by a pixel and never wider than 14.
  assert.ok(bars.every((b) => b.w <= 14));
});

test("seriesBarsScene and huge values: the tallest bar reaches the top, labels stay short", () => {
  const s = seriesBarsScene({ ...base(3), series: { values: [1, 5_000_000, 2], color: "good", tip: () => "" } });
  const bars = of(s, "rect");
  const top = Math.min(...bars.map((b) => b.y));
  assert.equal(top, 10);
  assert.ok(of(s, "text").some((t) => t.text === "5M"));
  // A tiny bar beside a huge one is still a pixel tall.
  assert.ok(bars.every((b) => b.h >= 1));
});

test("sparklineScene: a 2 px floor, scaled to the shared max, zero is no bar", () => {
  const s = sparklineScene({ series: [0, 1, 10, 20], max: 10, aria: "a" });
  assert.equal(s.width, 16);
  const bars = of(s, "rect");
  assert.equal(bars.length, 3);
  assert.equal(bars[0]!.h, 2);
  assert.equal(bars[1]!.h, 18);
  assert.equal(bars[2]!.h, 18, "clamped to the scale");
  assert.equal(sparklineScene({ series: [], max: 0, aria: "" }).marks.length, 0);
});

test("barPercent and cohortWash", () => {
  assert.equal(barPercent(0, 10), 4);
  assert.equal(barPercent(10, 10), 100);
  assert.equal(barPercent(3, 0), 100);
  assert.equal(cohortWash(100), 50);
  assert.equal(cohortWash(33), 17);
});

test("x axis labels never hang off the box", () => {
  const s = stackScene({ ...base(13, MIN_PLOT_W), layers: [{ values: Array(13).fill(1), color: "good" }] });
  const last = of(s, "text").filter((t) => t.y > 150).pop()!;
  assert.equal(last.anchor, "end");
  assert.ok(last.x <= MIN_PLOT_W);
});

// ── markup ──

test("escapeSvgText: XML specials plus = and : as character references", () => {
  assert.equal(escapeSvgText(`<a href="x">&'`), "&#60;a href&#61;&#34;x&#34;&#62;&#38;&#39;");
  assert.equal(escapeSvgText("javascript:alert(1) onload=x"), "javascript&#58;alert(1) onload&#61;x");
});

test("sceneToSvgMarkup: hostile text stays text and the host accepts the document", () => {
  const scene: Scene = {
    width: 200, height: 100, aria: "x",
    marks: [
      { kind: "text", x: 1, y: 10, text: `</text><script>alert(1)</script><style>*{}</style>` },
      { kind: "text", x: 1, y: 20, text: `javascript:void(0) onclick=evil() <foreignObject>` },
      { kind: "rect", x: 0, y: 0, w: 10, h: 10, fill: `red" onload="x` },
      { kind: "rect", x: 0, y: 0, w: 200, h: 100, fill: "transparent", hit: true, tip: "<b>" },
    ],
  };
  const m = sceneToSvgMarkup(scene, (p) => p);
  assert.equal(findSvgIconProblem(m.svg), null, m.svg);
  assert.ok(!/<script|<style|<foreignObject|\son\w*=|javascript:/i.test(m.svg));
  assert.equal((m.svg.match(/<rect/g) || []).length, 1, "hit strips are left out");
  assert.ok(m.fits);
});

test("sceneToSvgMarkup: square box for the host's Icon, scene centred", () => {
  const s = lineScene({ ...base(10, 800), series: [{ values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], color: "accent" }], tip: () => "" });
  const m = sceneToSvgMarkup(s, color, { square: true });
  assert.equal(m.width, 800);
  assert.equal(m.height, 800);
  assert.equal(m.offsetX, 0);
  assert.equal(m.offsetY, (800 - 170) / 2);
  assert.ok(m.svg.startsWith(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -315 800 800"`), m.svg.slice(0, 120));
  assert.equal(findSvgIconProblem(m.svg), null);
  const flat = sceneToSvgMarkup(s, color);
  assert.ok(flat.svg.includes('viewBox="0 0 800 170"'));
});

test("sceneToSvgMarkup: real flow charts at full size stay well under 64 KiB", () => {
  const rows: ChartRow[] = [...FIXTURE.tree.issues, ...FIXTURE.team];
  const flow = aggregateFlow(rows, null, Date.parse(TEAM_NOW), "day");
  const pts = flow.points;
  const st = pts.map((p) => p.start);
  const scenes = [
    lineScene({ starts: st, step: "day", width: 1400, locale: "ru-RU", aria: "a", tip: (i) => `${i}`, running: true, runningLabel: "идёт сейчас",
      series: [{ values: pts.map((p) => p.lead), color: "accent", band: true }, { values: pts.map((p) => p.leadP85), color: "accentSoft" }] }),
    stackScene({ starts: st, step: "day", width: 1400, locale: "ru-RU", aria: "s",
      layers: [{ values: pts.map((p) => p.done), color: "good" }, { values: pts.map((p) => p.wip), color: "accent" }, { values: pts.map((p) => p.waiting), color: "muted" }] }),
    pairedBarsScene({ starts: st, step: "day", width: 1400, locale: "ru-RU", aria: "p",
      left: { values: pts.map((p) => p.created), color: "muted", tip: () => "" }, right: { values: pts.map((p) => p.closed), color: "good", tip: () => "" } }),
  ];
  for (const s of scenes) {
    const m = sceneToSvgMarkup(s, color, { square: true });
    assert.ok(m.fits && m.bytes < SVG_MAX_BYTES / 2, `${s.aria}: ${m.bytes}`);
    assert.equal(m.bytes, new TextEncoder().encode(m.svg).byteLength);
    assert.equal(findSvgIconProblem(m.svg), null);
  }
  assert.equal(SVG_MAX_BYTES, PLUGIN_SVG_ICON_MAX_BYTES);
});

test("sceneToSvgMarkup: past the limit the text goes first, then it says it does not fit", () => {
  const text = (n: number): Mark[] => Array.from({ length: n }, (_, i) => ({ kind: "text", x: i, y: 1, text: "label" + i }));
  const many: Scene = { width: 10, height: 10, aria: "", marks: [...text(3000), { kind: "rect", x: 0, y: 0, w: 1, h: 1, fill: "good" }] };
  const m = sceneToSvgMarkup(many, color);
  assert.ok(m.fits);
  assert.ok(!m.svg.includes("<text"));
  assert.ok(m.svg.includes("<rect"));
  const rects: Scene = { width: 10, height: 10, aria: "", marks: Array.from({ length: 3000 }, (_, i): Mark => ({ kind: "rect", x: i, y: 0, w: 1, h: 1, fill: "good" })) };
  assert.equal(sceneToSvgMarkup(rects, color).fits, false);
});

test("utf8Bytes counts like TextEncoder", () => {
  for (const s of ["", "abc", "идёт", "a😀b", "€"]) assert.equal(utf8Bytes(s), new TextEncoder().encode(s).byteLength, s);
});

// ── palette ──

test("palette: parse, mix, light/dark, token resolution", () => {
  assert.deepEqual(parseColor("#abc"), { r: 170, g: 187, b: 204, a: 1 });
  assert.deepEqual(parseColor("rgba(255, 0, 0, 0.5)"), { r: 255, g: 0, b: 0, a: 0.5 });
  assert.equal(parseColor("var(--x)"), null);
  assert.equal(mix("#ffffff", 50, "#000000"), "#808080");
  assert.equal(mix("var(--x)", 50, "#000"), "var(--x)");
  assert.ok(luminance("#ffffff") > 0.9 && luminance("#181B1A") < 0.05);
  assert.equal(chartColors(LIGHT).dark, false);
  assert.equal(chartColors(DARK).dark, true);
  const c = chartColors(LIGHT);
  assert.equal(color("good"), LIGHT.statusSuccess);
  assert.equal(color("critical"), LIGHT.statusDanger);
  assert.equal(color("lab1"), c.labels[0]);
  assert.equal(color("lab0"), c.muted);
  assert.equal(color("type-bug"), c.types.bug);
  assert.equal(color("#123456"), "#123456");
  assert.equal(color("none"), "none");
  assert.equal(color("nonsense"), c.muted);
  assert.notEqual(c.accent, c.good, "series accent never coincides with done");
});

test("palette: bucket tokens follow the reference maps; tags by sorted slot", () => {
  const slots = labelSlots(["z", "a", "m", "a", "b", "c", "d", "e", "f", "g"]);
  assert.equal(slots.get("a"), 1);
  assert.equal(slots.get("z"), 0, "the ninth label goes muted");
  assert.equal(bucketToken("status", "in_progress", "value"), "good");
  assert.equal(bucketToken("priority", "0", "value"), "critical");
  assert.equal(bucketToken("priority", "__unset__", "unset"), "muted");
  assert.equal(bucketToken("readiness", "blocked", "value"), "critical");
  assert.equal(bucketToken("type", "epic", "value"), "type-epic");
  assert.equal(bucketToken("type", "task", "value"), "muted");
  assert.equal(bucketToken("labels", "a", "value", slots), "lab1");
  assert.equal(bucketToken("assignee", "x", "value"), "accent");
  assert.equal(bucketToken("assignee", "__other__", "other"), "muted");
});
