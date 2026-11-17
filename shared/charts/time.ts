/**
 * The time axis and the small statistics every reading shares.
 *
 * Ported from the reference tab (cloudcli-plugin-beads, dist/index.js:
 * chartStep, tsOf, bucketStart, bucketNext, quantileOf, medianOf, stepDays,
 * smoothingWindow, rollingMean, lastStepIsRunning, and the arithmetic of
 * tipFor). Buckets are cut in the reader's own timezone, as there — a series
 * cut on UTC midnight puts the evening's work on tomorrow for anyone east of
 * London. Weeks start on Monday.
 */

import type { Period, Step } from "./types.ts";

/**
 * How wide one step is for a period. Picked so a series lands between roughly
 * 12 and 40 points; `spanDays` only matters for the whole history.
 */
export function chartStep(period: Period, spanDays: number): Step {
  const days = period == null ? spanDays : period;
  if (days <= 45) return "day";
  if (days <= 400) return "week";
  return "month";
}

/** A timestamp field as milliseconds, or null when missing or unreadable. */
export function tsOf(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : null;
}

/** Start of the bucket a moment falls in, local time; weeks start on Monday. */
export function bucketStart(ts: number, step: Step): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  if (step === "week") d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  if (step === "month") d.setDate(1);
  return d.getTime();
}

/** The next bucket boundary after one. Calendar arithmetic, so DST and short months behave. */
export function bucketNext(ts: number, step: Step): number {
  const d = new Date(ts);
  if (step === "day") d.setDate(d.getDate() + 1);
  else if (step === "week") d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + 1);
  return d.getTime();
}

/** How many days one step spans on average — months vary, so this is their mean. */
export function stepDays(step: Step): number {
  return step === "day" ? 1 : step === "week" ? 7 : 30.44;
}

/**
 * The value at a quantile of a sample already sorted ascending, linearly
 * interpolated (q = 0.5 is the ordinary median). An empty sample has none:
 * null, never zero — "nothing closed" and "closed instantly" are opposite facts.
 */
export function quantileOf(sorted: readonly number[], q: number): number | null {
  if (!sorted.length) return null;
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  const a = sorted[lo]!;
  const b = sorted[hi]!;
  return lo === hi ? a : a + (b - a) * (at - lo);
}

/** The middle of a sorted sample, or null if there is none. */
export function medianOf(sorted: readonly number[]): number | null {
  return quantileOf(sorted, 0.5);
}

/** How many steps the pace averages over: a week of days, a month of weeks, a quarter of months. */
export function smoothingWindow(step: Step): number {
  return step === "day" ? 7 : step === "week" ? 4 : 3;
}

/** A trailing mean over `window` points, shorter at the start of the series. */
export function rollingMean(values: readonly number[], window: number): number[] {
  return values.map((_, i) => {
    const from = Math.max(0, i - window + 1);
    let sum = 0;
    for (let j = from; j <= i; j++) sum += values[j]!;
    return sum / (i - from + 1);
  });
}

/** A step of a series: where it starts and where it stops (inclusive). */
export interface Frame {
  start: number;
  end: number;
}

/**
 * Whether the last step is still running at the moment counted from — the
 * charts mark it, and the cohorts hold its spans back.
 */
export function lastStepIsRunning(frames: readonly Frame[], step: Step): boolean {
  const last = frames[frames.length - 1];
  if (!last) return false;
  return bucketNext(last.start, step) > last.end + 1;
}

/**
 * What a column says about itself under the pointer: the change against the
 * step before. The first step has nothing before it, so it reports its own
 * count instead (`first: true`) — "+5" there would claim a rise nobody measured.
 */
export function stepDelta(values: readonly number[], i: number): { first: boolean; value: number } {
  const v = values[i] ?? 0;
  if (i <= 0) return { first: true, value: v };
  return { first: false, value: v - (values[i - 1] ?? 0) };
}
