/**
 * The drawing layer of the charts, minus the drawing: every chart is built as
 * a declarative scene — a list of marks in pixel units — that the client
 * renders twice over: as a live DOM <svg> on web (hover readout, dimming,
 * keyboard) and, on native, as static SVG markup handed to the host's
 * <Icon icon={{svg}}/> (see sceneToSvgMarkup).
 *
 * Ported from the reference tab's chart helpers (cloudcli-plugin-beads,
 * dist/index.js: drawLines, drawPace, drawStack, drawPairedBars,
 * drawSeriesBars, drawSparkline, appendXAxis, tickEvery, axisLabel). The
 * geometry — paddings, heights, bar widths, the two gridlines, the axis
 * counted back from the last step — is the reference's; what differed there
 * as CSS classes (`.cbd-flow-bar` dims while another is hovered,
 * `.cbd-pace-hit` washes under the pointer) is carried on the mark as `dim`
 * and `hit`.
 *
 * Pure: no DOM, no React, no clock. Colors are token names resolved by the
 * caller (client/charts/palette.ts); text that depends on the language — the
 * tips, the "still running" note, the axis numbers' format — arrives as
 * arguments, and dates are formatted with the locale passed in.
 */

import type { Step } from "./types.ts";

// ── the scene ─────────────────────────────────────────────────────────

/**
 * A color: a palette token ("good", "accent", "muted", "grid", "lab3",
 * "type-epic", "accentSoft", …) resolved by the renderer, or a literal CSS
 * color starting with "#" / "rgb", which passes through untouched.
 */
export type Paint = string;

/** What every mark may carry besides its geometry. */
export interface MarkBase {
  /** The readout under the pointer (web). Several lines are separated by "\n". */
  tip?: string;
  /** Steps back (opacity 0.45) while another mark of the scene is hot — the bars. */
  dim?: boolean;
  /** A transparent hit target that washes faintly while hot — the line charts' step strips. */
  hit?: boolean;
  /** Marks of one group light up together; by default a mark is its own group. */
  group?: string;
  /** Passed to onPressMark; a mark with an id is a keyboard/press target (web). */
  id?: string;
  /** The mark's accessible name (web); falls back to the tip. */
  label?: string;
  opacity?: number;
}

export interface RectMark extends MarkBase {
  kind: "rect";
  x: number;
  y: number;
  w: number;
  h: number;
  rx?: number;
  fill: Paint;
}

export interface PathMark extends MarkBase {
  kind: "path";
  d: string;
  fill?: Paint;
  stroke?: Paint;
  strokeWidth?: number;
  /** stroke-dasharray, e.g. "4 3". */
  dash?: string;
}

export interface LineMark extends MarkBase {
  kind: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: Paint;
  strokeWidth?: number;
  dash?: string;
}

export interface CircleMark extends MarkBase {
  kind: "circle";
  cx: number;
  cy: number;
  r: number;
  fill: Paint;
}

export interface TextMark extends MarkBase {
  kind: "text";
  x: number;
  y: number;
  text: string;
  anchor?: "start" | "middle" | "end";
  fill?: Paint;
  /** Pixels; the axis is 10. */
  size?: number;
  weight?: number;
}

export type Mark = RectMark | PathMark | LineMark | CircleMark | TextMark;

export interface Scene {
  /** Pixel units: the scene is drawn 1:1 into a box this wide and this tall. */
  width: number;
  height: number;
  /** The chart's accessible name. */
  aria: string;
  /** Back to front. */
  marks: Mark[];
}

// ── shared constants and small helpers ────────────────────────────────

/** The plot margins every chart with an axis uses (the reference's padL/padR/padB). */
export const PAD_L = 34;
export const PAD_R = 8;
export const PAD_B = 22;
/** Font size of the axis numbers and dates. */
export const AXIS_SIZE = 10;
/** The narrowest a plot is drawn — below this the labels collide (plotWidth's floor). */
export const MIN_PLOT_W = 320;

const r1 = (v: number) => Math.round(v * 10) / 10;

/**
 * How many steps to skip between date labels: roughly one label per 90 px of
 * plot, never fewer than two and never more than eight.
 */
export function tickEvery(count: number, width: number): number {
  const want = Math.min(8, Math.max(2, Math.floor(width / 90)));
  return Math.max(1, Math.ceil(count / want));
}

/**
 * The steps that get a date under them, counted back from the last one so
 * the end of the series — the part being asked about — is always labelled.
 * Returned oldest first.
 */
export function tickIndices(count: number, width: number): number[] {
  const every = tickEvery(count, width);
  const out: number[] = [];
  for (let i = count - 1; i >= 0; i -= every) out.push(i);
  return out.reverse();
}

/** A date on the axis: "Jun 8", or "Jun 25" style month + 2-digit year for a month step. */
export function axisLabel(ts: number, step: Step, locale: string): string {
  const d = new Date(ts);
  if (step === "month") return d.toLocaleDateString(locale, { year: "2-digit", month: "short" });
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

/**
 * A number on the value axis: one decimal at most, and compact past ten
 * thousand so a huge count still fits the 34 px left margin ("12k", "3.4M").
 */
export function axisNumber(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return `${r1(v / 1e9)}G`;
  if (a >= 1e6) return `${r1(v / 1e6)}M`;
  if (a >= 1e4) return `${Math.round(v / 1e3)}k`;
  return String(r1(v));
}

/** The largest finite value of some series, at least 1 — the top of a scale. */
export function scaleMax(values: readonly (number | null | undefined)[]): number {
  let max = 1;
  for (const v of values) if (v != null && Number.isFinite(v) && v > max) max = v;
  return max;
}

/** A y scale: value → pixel, `max` at `top`, 0 at `bottom`. Values are clamped into the box. */
export function yScale(max: number, top: number, bottom: number): (v: number) => number {
  const m = max > 0 ? max : 1;
  return (v) => {
    const k = Math.max(0, Math.min(1, v / m));
    return top + (1 - k) * (bottom - top);
  };
}

/** An SVG path through points, "M x,y L x,y …". */
export function linePath(pts: readonly { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${r1(p.x)},${r1(p.y)}`).join(" ");
}

/** A closed area: along `top` left to right, back along `bottom` right to left. */
export function areaPath(top: readonly { x: number; y: number }[], bottom: readonly { x: number; y: number }[]): string {
  const back = bottom.slice().reverse();
  return `${linePath(top.concat(back))} Z`;
}

/** The two gridlines (floor and top) and their numbers, as every plotted chart has them. */
function gridMarks(max: number, width: number, y: (v: number) => number, fmt: (v: number) => string): Mark[] {
  const out: Mark[] = [];
  for (const v of [0, max]) {
    out.push({ kind: "line", x1: PAD_L, y1: y(v), x2: width - PAD_R, y2: y(v), stroke: "grid", strokeWidth: 1 });
    out.push({ kind: "text", x: PAD_L - 6, y: y(v) + 4, text: fmt(v), anchor: "end", fill: "muted", size: AXIS_SIZE });
  }
  return out;
}

/**
 * The shared time axis: a date under every `tickEvery`-th step, counted back
 * from the last.
 */
export function xAxisMarks(
  starts: readonly number[], x: (i: number) => number, yAt: number, step: Step, width: number, locale: string,
): TextMark[] {
  return tickIndices(starts.length, width).map((i) => {
    const text = axisLabel(starts[i]!, step, locale);
    const at = x(i);
    // A label centred on the plot's last (or first) vertex would hang off the
    // box, and the box clips: it is pinned to the edge instead.
    const half = textWidth(text, AXIS_SIZE) / 2;
    if (at + half > width) return { kind: "text", x: width - 1, y: yAt, text, anchor: "end", fill: "muted", size: AXIS_SIZE };
    if (at - half < 0) return { kind: "text", x: 1, y: yAt, text, anchor: "start", fill: "muted", size: AXIS_SIZE };
    return { kind: "text", x: at, y: yAt, text, anchor: "middle", fill: "muted", size: AXIS_SIZE };
  });
}

/** A rough width of a text in a sans-serif face: a bit over half the size per character. */
export function textWidth(text: string, size: number): number {
  return text.length * size * 0.56;
}

/** Common options of a chart on the time axis. */
export interface TimeAxisOpts {
  /** Bucket starts, oldest first — one per step. */
  starts: readonly number[];
  step: Step;
  width: number;
  locale: string;
  aria: string;
}

// ── lines ─────────────────────────────────────────────────────────────

export interface LineSeries {
  values: readonly (number | null)[];
  color: Paint;
  /** On the first series: shade the gap between it and the second where both are known. */
  band?: boolean;
}

export interface LineOpts extends TimeAxisOpts {
  series: readonly LineSeries[];
  /** Pixel height; 170 for a line card, 180 for the pace (the reference's CSS heights). */
  height?: number;
  /** A fixed top of the scale (100 for shares); otherwise the largest known value. */
  max?: number;
  /** The value-axis number format; default axisNumber. */
  fmt?: (v: number) => string;
  /** The readout of step i (its strip's tip). */
  tip: (i: number) => string;
  /** The last step is still running: its segment is dashed and the plot says so. */
  running?: boolean;
  /** The note drawn top-right when running ("still running"). */
  runningLabel?: string;
}

/**
 * Lines on the shared time axis, with a full-height hit strip per step.
 *
 * A step with no sample is a gap, never a point on the floor; a value with
 * gaps on both sides is a dot. With `band` on the first series, the distance
 * between the first two lines is shaded in the second's color. A running
 * last step has its segment dashed — the value is still moving.
 */
export function lineScene(o: LineOpts): Scene {
  const W = o.width;
  const H = o.height ?? 170;
  const padT = 14;
  const n = o.starts.length;
  const known: number[] = [];
  for (const s of o.series) for (const v of s.values) if (v != null && Number.isFinite(v)) known.push(v);
  const max = o.max != null ? o.max : scaleMax(known);
  const fmt = o.fmt ?? axisNumber;
  const plotW = W - PAD_L - PAD_R;
  const slot = plotW / Math.max(n, 1);
  const x = (i: number) => PAD_L + slot * (i + 0.5);
  const y = yScale(max, padT, H - PAD_B);
  const marks: Mark[] = gridMarks(max, W, y, fmt);
  const val = (s: LineSeries, i: number): number | null => {
    const v = s.values[i];
    return v == null || !Number.isFinite(v) ? null : v;
  };

  const a = o.series[0];
  const b = o.series[1];
  if (a && b && a.band) {
    let run: { i: number; lo: number; hi: number }[] = [];
    const flush = () => {
      if (run.length > 1) {
        marks.push({
          kind: "path", fill: b.color, opacity: 0.16,
          d: areaPath(run.map((p) => ({ x: x(p.i), y: y(p.hi) })), run.map((p) => ({ x: x(p.i), y: y(p.lo) }))),
        });
      }
      run = [];
    };
    for (let i = 0; i < n; i++) {
      const va = val(a, i);
      const vb = val(b, i);
      if (va == null || vb == null) flush();
      else run.push({ i, lo: Math.min(va, vb), hi: Math.max(va, vb) });
    }
    flush();
  }

  const dashLast = Boolean(o.running) && n > 1;
  for (const s of o.series) {
    let run: { x: number; y: number; i: number }[] = [];
    const flush = () => {
      if (run.length > 1) {
        const last = run[run.length - 1]!;
        // The running step's segment goes dashed: the line keeps its shape, the
        // dash says the last value is still moving.
        const solid = dashLast && last.i === n - 1 ? run.slice(0, -1) : run;
        if (solid.length > 1) marks.push({ kind: "path", d: linePath(solid), stroke: s.color, strokeWidth: 2, fill: "none" });
        if (solid !== run) {
          marks.push({ kind: "path", d: linePath(run.slice(-2)), stroke: s.color, strokeWidth: 2, fill: "none", dash: "4 3" });
        }
      } else if (run.length === 1) {
        marks.push({ kind: "circle", cx: run[0]!.x, cy: run[0]!.y, r: 2.5, fill: s.color });
      }
      run = [];
    };
    for (let i = 0; i < n; i++) {
      const v = val(s, i);
      if (v == null) flush();
      else run.push({ x: x(i), y: y(v), i });
    }
    flush();
  }

  for (let i = 0; i < n; i++) {
    marks.push({ kind: "rect", x: PAD_L + slot * i, y: padT, w: slot, h: H - padT - PAD_B, fill: "transparent", hit: true, tip: o.tip(i) });
  }
  marks.push(...xAxisMarks(o.starts, x, H - PAD_B + 14, o.step, W, o.locale));
  if (o.running && o.runningLabel) {
    marks.push({ kind: "text", x: W - PAD_R, y: padT - 4, text: o.runningLabel, anchor: "end", fill: "muted", size: AXIS_SIZE });
  }
  return { width: W, height: H, aria: o.aria, marks };
}

// ── the cumulative flow ───────────────────────────────────────────────

export interface StackLayer {
  values: readonly number[];
  color: Paint;
}

export interface StackOpts extends TimeAxisOpts {
  /** Bottom first: done, then in progress, then waiting. */
  layers: readonly StackLayer[];
  height?: number;
  /** The plot's surface color, which strokes the bands apart. Default "raised". */
  surface?: Paint;
  /** Optional readout of step i — a hit strip per step when given. */
  tip?: (i: number) => string;
}

/**
 * Stacked areas, bottom layer first, each band stroked in the surface color
 * so the boundary between two fills stays readable where they run flat. A
 * series of one step is drawn across the whole plot rather than as a line of
 * no width.
 */
export function stackScene(o: StackOpts): Scene {
  const W = o.width;
  const H = o.height ?? 200;
  const padT = 10;
  const n = o.starts.length;
  const totals: number[] = [];
  for (let i = 0; i < n; i++) {
    let t = 0;
    for (const l of o.layers) t += l.values[i] ?? 0;
    totals.push(t);
  }
  const max = scaleMax(totals);
  const plotW = W - PAD_L - PAD_R;
  const x = (i: number) => (n === 1 ? PAD_L + plotW / 2 : PAD_L + (i / Math.max(n - 1, 1)) * plotW);
  const y = yScale(max, padT, H - PAD_B);
  const marks: Mark[] = gridMarks(max, W, y, axisNumber);
  const surface = o.surface ?? "raised";
  if (n > 0) {
    // The x of each vertex; one step spans the plot so it reads as a band.
    const xs = n === 1 ? [PAD_L, W - PAD_R] : o.starts.map((_, i) => x(i));
    const at = (i: number) => (n === 1 ? 0 : i);
    let below = xs.map(() => 0);
    for (const layer of o.layers) {
      const above = xs.map((_, j) => below[j]! + (layer.values[at(j)] ?? 0));
      marks.push({
        kind: "path", fill: layer.color, stroke: surface, strokeWidth: 2,
        d: areaPath(xs.map((px, j) => ({ x: px, y: y(above[j]!) })), xs.map((px, j) => ({ x: px, y: y(below[j]!) }))),
      });
      below = above;
    }
  }
  if (o.tip) {
    const slot = plotW / Math.max(n, 1);
    for (let i = 0; i < n; i++) {
      const left = n === 1 ? PAD_L : Math.max(PAD_L, x(i) - slot / 2);
      const right = n === 1 ? W - PAD_R : Math.min(W - PAD_R, x(i) + slot / 2);
      marks.push({ kind: "rect", x: left, y: padT, w: right - left, h: H - padT - PAD_B, fill: "transparent", hit: true, tip: o.tip(i) });
    }
  }
  marks.push(...xAxisMarks(o.starts, x, H - PAD_B + 14, o.step, W, o.locale));
  return { width: W, height: H, aria: o.aria, marks };
}

// ── bars ──────────────────────────────────────────────────────────────

export interface BarSeries {
  values: readonly number[];
  color: Paint;
  /** The readout of column i; the reference's tipFor (change against the step before). */
  tip: (i: number) => string;
  /** Names the series in the mark's group/id: "opened", "closed", … */
  key?: string;
}

/** A rounded column standing on the floor, at least 1 px tall. */
function column(x: number, w: number, v: number, y: (v: number) => number, color: Paint): RectMark {
  const top = y(v);
  const base = y(0);
  return { kind: "rect", x, y: top, w, h: Math.max(1, base - top), rx: Math.min(2, w / 2), fill: color, dim: true };
}

export interface PairedBarsOpts extends TimeAxisOpts {
  /** Left column of each pair (opened), right column (closed). */
  left: BarSeries;
  right: BarSeries;
  height?: number;
}

/**
 * Two series of columns side by side, one pair per step, on one axis: opened
 * against closed. A 1 px gap keeps the pair reading as two; a zero draws no
 * column at all.
 */
export function pairedBarsScene(o: PairedBarsOpts): Scene {
  const W = o.width;
  const H = o.height ?? 150;
  const padT = 10;
  const n = o.starts.length;
  const max = scaleMax([...o.left.values, ...o.right.values]);
  const slot = (W - PAD_L - PAD_R) / Math.max(n, 1);
  const barW = Math.max(1.5, Math.min(14, slot * 0.36));
  const y = yScale(max, padT, H - PAD_B);
  const marks: Mark[] = gridMarks(max, W, y, axisNumber);
  for (let i = 0; i < n; i++) {
    const mid = PAD_L + slot * (i + 0.5);
    const pair: [BarSeries, number][] = [[o.left, mid - barW - 0.5], [o.right, mid + 0.5]];
    for (const [s, at] of pair) {
      const v = s.values[i] ?? 0;
      if (!v) continue;
      const m = column(at, barW, v, y, s.color);
      m.tip = s.tip(i);
      m.group = `${s.key ?? (s === o.left ? "left" : "right")}:${i}`;
      marks.push(m);
    }
  }
  marks.push(...xAxisMarks(o.starts, (i) => PAD_L + slot * (i + 0.5), H - PAD_B + 14, o.step, W, o.locale));
  return { width: W, height: H, aria: o.aria, marks };
}

export interface SeriesBarsOpts extends TimeAxisOpts {
  series: BarSeries;
  height?: number;
}

/** One series of columns down the middle of each step — a person's closings. */
export function seriesBarsScene(o: SeriesBarsOpts): Scene {
  const W = o.width;
  const H = o.height ?? 120;
  const padT = 10;
  const n = o.starts.length;
  const max = scaleMax(o.series.values);
  const slot = (W - PAD_L - PAD_R) / Math.max(n, 1);
  const barW = Math.max(1.5, Math.min(14, slot * 0.6));
  const y = yScale(max, padT, H - PAD_B);
  const marks: Mark[] = gridMarks(max, W, y, axisNumber);
  for (let i = 0; i < n; i++) {
    const v = o.series.values[i] ?? 0;
    if (!v) continue;
    const m = column(PAD_L + slot * (i + 0.5) - barW / 2, barW, v, y, o.series.color);
    m.tip = o.series.tip(i);
    marks.push(m);
  }
  marks.push(...xAxisMarks(o.starts, (i) => PAD_L + slot * (i + 0.5), H - PAD_B + 14, o.step, W, o.locale));
  return { width: W, height: H, aria: o.aria, marks };
}

export interface SparklineOpts {
  series: readonly number[];
  /** The shared scale of the table (tableScale(...).spark), so rows compare. */
  max: number;
  aria: string;
  /** Default 4 px per step (3 px bar + 1 px gap) — the reference's geometry. */
  width?: number;
  height?: number;
  color?: Paint;
}

/**
 * A tiny column per step, no axis — whether the work came steadily or in one
 * burst. Columns are at least 2 px tall so a single close still shows.
 */
export function sparklineScene(o: SparklineOpts): Scene {
  const n = Math.max(o.series.length, 1);
  const W = o.width ?? n * 4;
  const H = o.height ?? 20;
  const slot = W / n;
  const barW = Math.max(0.5, slot * 0.75);
  const max = o.max > 0 ? o.max : 1;
  const marks: Mark[] = [];
  o.series.forEach((v, i) => {
    if (!v) return;
    const h = Math.max(2, Math.min(1, v / max) * (H - 2));
    marks.push({ kind: "rect", x: i * slot, y: H - h, w: barW, h, rx: Math.min(1, barW / 2), fill: o.color ?? "good" });
  });
  return { width: W, height: H, aria: o.aria, marks };
}

// ── models for the charts drawn as rows, not plots ────────────────────

/**
 * Width of a breakdown bar in percent of its track: scaled to the cut's
 * tallest bucket (cutMax), never under 4 % so a near-zero bucket next to a
 * tall one still shows a bar.
 */
export function barPercent(count: number, max: number): number {
  const m = max > 0 ? max : 1;
  return Math.max(4, Math.min(100, Math.round((count / m) * 100)));
}

/**
 * How strongly a cohort cell is washed in the "good" color, in percent mixed
 * over the card: half the share, so even 100 % never fights the number on it.
 */
export function cohortWash(share: number): number {
  return Math.round(Math.max(0, Math.min(100, share)) * 0.5);
}

// ── markup ────────────────────────────────────────────────────────────

/** The host's limit on inline SVG icons (PLUGIN_SVG_ICON_MAX_BYTES). */
export const SVG_MAX_BYTES = 64 * 1024;

/**
 * Text as SVG character data. Beyond the XML five, "=" and ":" are written as
 * character references too: the host refuses any markup matching ` on…=` or
 * `javascript:` anywhere, text included, so a date or a label that happened
 * to contain them must not read as either.
 */
export function escapeSvgText(s: string): string {
  return String(s).replace(/[&<>"'=:]/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** Resolves a Paint to a CSS color. */
export type ColorOf = (paint: Paint) => string;

export interface MarkupOpts {
  /**
   * Pad the viewBox to a square (the side is the larger dimension, the scene
   * centred in it) — what the host's <Icon size>, which is always square,
   * needs to draw the scene undistorted. Default false.
   */
  square?: boolean;
  /** Font family for the text marks; default a plain sans-serif. */
  font?: string;
}

const attr = (v: string | number) => (typeof v === "number" ? String(r1(v)) : escapeSvgText(v));

/** One mark as markup; hit strips (pure pointer targets) are left out. */
function markMarkup(m: Mark, color: ColorOf): string {
  if (m.hit) return "";
  const op = m.opacity != null && m.opacity !== 1 ? ` opacity="${attr(m.opacity)}"` : "";
  switch (m.kind) {
    case "rect":
      return `<rect x="${attr(m.x)}" y="${attr(m.y)}" width="${attr(Math.max(0, m.w))}" height="${attr(Math.max(0, m.h))}"${
        m.rx ? ` rx="${attr(m.rx)}"` : ""} fill="${attr(color(m.fill))}"${op}/>`;
    case "path":
      return `<path d="${attr(m.d)}" fill="${attr(m.fill ? color(m.fill) : "none")}"${
        m.stroke ? ` stroke="${attr(color(m.stroke))}" stroke-width="${attr(m.strokeWidth ?? 1)}" stroke-linejoin="round" stroke-linecap="round"` : ""}${
        m.dash ? ` stroke-dasharray="${attr(m.dash)}"` : ""}${op}/>`;
    case "line":
      return `<line x1="${attr(m.x1)}" y1="${attr(m.y1)}" x2="${attr(m.x2)}" y2="${attr(m.y2)}" stroke="${attr(color(m.stroke))}" stroke-width="${attr(m.strokeWidth ?? 1)}"${
        m.dash ? ` stroke-dasharray="${attr(m.dash)}"` : ""}${op}/>`;
    case "circle":
      return `<circle cx="${attr(m.cx)}" cy="${attr(m.cy)}" r="${attr(m.r)}" fill="${attr(color(m.fill))}"${op}/>`;
    case "text":
      return `<text x="${attr(m.x)}" y="${attr(m.y)}" font-size="${attr(m.size ?? AXIS_SIZE)}"${
        m.weight ? ` font-weight="${attr(m.weight)}"` : ""} text-anchor="${m.anchor ?? "start"}" fill="${attr(color(m.fill ?? "muted"))}"${op}>${escapeSvgText(m.text)}</text>`;
  }
}

/** The byte length of a string as UTF-8 (no TextEncoder needed on Hermes). */
export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

export interface SvgMarkup {
  svg: string;
  /** The box the markup is laid out for: the scene's own, or the square side. */
  width: number;
  height: number;
  /** Where the scene sits inside a square box (0, 0 when not squared). */
  offsetX: number;
  offsetY: number;
  bytes: number;
  /** False when even the trimmed markup is past SVG_MAX_BYTES — the host would refuse it. */
  fits: boolean;
}

/**
 * A scene as a self-contained SVG document the host accepts as an inline
 * icon: no <style>, no <script>, no event attributes, no external hrefs,
 * every text escaped, colors resolved to literals. Hit strips and tips are
 * dropped (nothing is interactive there). Past the 64 KiB limit the text is
 * dropped too — the shape survives; if that still does not fit, `fits` is false.
 */
export function sceneToSvgMarkup(scene: Scene, color: ColorOf, opts: MarkupOpts = {}): SvgMarkup {
  const W = scene.width;
  const H = scene.height;
  const side = Math.max(W, H);
  const sq = Boolean(opts.square);
  const bw = sq ? side : W;
  const bh = sq ? side : H;
  const ox = sq ? (side - W) / 2 : 0;
  const oy = sq ? (side - H) / 2 : 0;
  const font = opts.font ?? "sans-serif";
  const build = (withText: boolean) => {
    const body = scene.marks
      .filter((m) => withText || m.kind !== "text")
      .map((m) => markMarkup(m, color))
      .join("");
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${attr(-ox)} ${attr(-oy)} ${attr(bw)} ${attr(bh)}" width="${attr(bw)}" height="${attr(bh)}" font-family="${attr(font)}">${body}</svg>`;
  };
  let svg = build(true);
  let bytes = utf8Bytes(svg);
  if (bytes > SVG_MAX_BYTES) {
    svg = build(false);
    bytes = utf8Bytes(svg);
  }
  return { svg, width: bw, height: bh, offsetX: ox, offsetY: oy, bytes, fits: bytes <= SVG_MAX_BYTES };
}
