/**
 * The words around the charts, from the panel's string table: what a step is
 * called, the readouts under the pointer, the names of buckets and cuts, the
 * KPI tiles. Ported from the reference tab (cloudcli-plugin-beads,
 * dist/index.js: stepCaption, stepAnd, daysText, stepTip, tipFor,
 * statusLabel/typeLabel/priorityLabel, the labels aggregateCharts gave its
 * buckets, renderChartFlow's tiles).
 *
 * Plain functions of a Strings table — no React — so views and tests share them.
 */

import {
  BUCKET_EMPTY, stepDelta, tipWhen, type Bucket, type CutKey, type FlowTotals, type Step,
} from "../../shared/charts/index.ts";
import type { Strings } from "../i18n/strings.ts";

type Lookup = Record<string, unknown>;
const pick = (s: Strings, key: string): string | null => {
  const v = (s as unknown as Lookup)[key];
  return typeof v === "string" ? v : null;
};

/** "by day" / "by week" / "by month". */
export function stepCaption(s: Strings, step: Step): string {
  return step === "day" ? s.chartStepDay : step === "week" ? s.chartStepWeek : s.chartStepMonth;
}

/** The caption of a chart with an axis: the step and the axis' unit. */
export function stepAnd(s: Strings, step: Step, unit: string): string {
  return `${stepCaption(s, step)} · ${unit}`;
}

/** A span of days as the panel says it. */
export function daysText(s: Strings, v: number): string {
  return s.flowDays(Math.round(v));
}

/**
 * A column's readout: the change against the step before; the first step
 * reports its own count (a "+5" there would claim a rise nobody measured).
 */
export function tipFor(s: Strings, values: readonly number[], i: number, start: number, step: Step): string {
  const when = tipWhen(start, step, s.locale);
  const d = stepDelta(values, i);
  return d.first ? s.tipFirst(when, d.value) : s.tipOf(when, d.value);
}

export interface TipPart {
  name: string;
  value: number | null;
  fmt: (v: number) => string;
}

/**
 * A line chart's readout of one step: one "no data" when nothing was
 * measured, otherwise each line's value — or its own "no data".
 */
export function stepTip(s: Strings, start: number, step: Step, parts: readonly TipPart[]): string {
  const when = tipWhen(start, step, s.locale);
  if (parts.every((p) => p.value == null)) return s.tempoTip(when, s.tipNothing);
  return s.tempoTip(when, parts
    .map((p) => s.tempoTipPart(p.name, p.value == null ? s.tipNothing : p.fmt(p.value)))
    .join(" · "));
}

export function statusLabel(s: Strings, status: string): string {
  return pick(s, `st_${status}`) ?? status;
}
export function typeLabel(s: Strings, type: string): string {
  return pick(s, `ty_${String(type).split("-").join("_")}`) ?? type;
}
export function priorityLabel(s: Strings, p: number | string): string {
  return pick(s, `pri_${p}`) ?? `P${p}`;
}

/** The heading of a breakdown. */
export function cutTitle(s: Strings, key: CutKey): string {
  switch (key) {
    case "assignee": return s.fPerson;
    case "status": return s.fStatus;
    case "priority": return s.fPriority;
    case "readiness": return s.fReadiness;
    case "type": return s.fType;
    case "labels": return s.fLabel;
  }
}

/** What a bucket is called on its row (the reference's bucket.label). */
export function bucketLabel(s: Strings, cutKey: CutKey, b: Bucket): string {
  if (b.kind === "other") return s.chartOther;
  if (b.kind === "unset") return s.eUnset;
  if (b.kind === "empty" || b.key === BUCKET_EMPTY) return cutKey === "labels" ? s.chartNoLabels : s.chartUnassigned;
  switch (cutKey) {
    case "status": return statusLabel(s, b.key);
    case "type": return typeLabel(s, b.key);
    case "priority": return priorityLabel(s, b.key);
    case "readiness": return b.key === "ready" ? s.onlyReady : b.key === "blocked" ? s.onlyBlocked : s.chartOther;
    default: return b.key;
  }
}

/** One headline number: a label above, the figure, an optional note below. */
export interface KpiTile {
  label: string;
  value: string;
  /** good = green, bad = red, flat/absent = ink — a hint, the note says which way. */
  tone?: "good" | "bad" | "flat";
  note?: string;
}

/** The Over-time reading's six headline tiles (renderChartFlow). */
export function flowKpiTiles(s: Strings, totals: FlowTotals): KpiTile[] {
  const net = totals.net;
  return [
    { label: s.flowKpiCreated, value: String(totals.created) },
    { label: s.flowKpiClosed, value: String(totals.closed) },
    {
      label: s.flowKpiNet, value: `${net > 0 ? "+" : ""}${net}`,
      tone: net > 0 ? "bad" : net < 0 ? "good" : "flat",
      note: net > 0 ? s.flowNetGrew : net < 0 ? s.flowNetShrank : s.flowNetFlat,
    },
    { label: s.flowKpiOpen, value: String(totals.openNow) },
    { label: s.flowKpiWip, value: String(totals.wipNow) },
    {
      label: s.flowKpiLead,
      value: totals.medianLead == null ? "—" : daysText(s, totals.medianLead),
      note: totals.medianLead == null ? s.flowNoClosed : undefined,
    },
  ];
}
