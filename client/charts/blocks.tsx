/**
 * The blocks the charts views are assembled from, drawn with Views so they
 * work the same on every platform: the card a chart sits in, its key, the
 * headline tiles, the backlog estimate, the breakdown card with its bar rows,
 * the cohort grid and the sparkline.
 *
 * Ported from the reference tab (cloudcli-plugin-beads, dist/index.js:
 * chartCard, chartLegend, renderChartFlow's tiles, etaRow, cutCard,
 * drawCohorts, drawSparkline; CSS .cbd-chart*, .cbd-flow-*, .cbd-coh*).
 * Every visible word comes from useStrings(); every color from ChartColors.
 */

import { useState, type ReactElement, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View, type TextStyle } from "react-native";
import {
  barPercent, bucketFilter, cohortWash, cutMax, fmtEtaDate, sparklineScene, tempoLabel,
  type Bucket, type BucketFilter, type CohortRow, type Cut, type Eta, type Step,
} from "../../shared/charts/index.ts";
import { COHORT_AGES } from "../../shared/charts/types.ts";
import { useStrings } from "../i18n/messages.ts";
import { Chart } from "./Chart.tsx";
import { bucketToken, colorResolver, mix, type ChartColors } from "./palette.ts";
import { bucketLabel, cutTitle, type KpiTile } from "./text.ts";

const caps = (colors: ChartColors): TextStyle => ({
  fontSize: 10.5, color: colors.muted, textTransform: "uppercase", letterSpacing: 0.5,
});
const NUM: TextStyle = { fontVariant: ["tabular-nums"] };
const boxStyle = (colors: ChartColors) => ({
  backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: 10,
});

// ── card and key ─────────────────────────────────────────────────────

export interface LegendItem {
  label: string;
  /** A palette token (or literal color). */
  color: string;
  /** The current value, where it reads against this chart's own axis; omit otherwise (the pace). */
  value?: number | string;
}

export function Legend({ items, colors }: { items: readonly LegendItem[]; colors: ChartColors }): ReactElement {
  const color = colorResolver(colors);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 12, rowGap: 4, marginTop: 6, marginBottom: 10 }}>
      {items.map((it, i) => (
        <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: color(it.color) }} />
          <Text style={{ fontSize: 11.5, color: colors.ink2 }}>{it.label}</Text>
          {it.value != null ? <Text style={[{ fontSize: 11.5, color: colors.ink, fontWeight: "600" }, NUM]}>{String(it.value)}</Text> : null}
        </View>
      ))}
    </View>
  );
}

export interface ChartCardProps {
  title: string;
  /** Top-right caption: the step, and the axis' unit ("by week · in days"). */
  aside?: string;
  legend?: readonly LegendItem[];
  /** A sentence under the chart (.cbd-chart-note). */
  note?: string;
  colors: ChartColors;
  children?: ReactNode;
}

/** A titled box for one chart: heading and caption, key, the chart, a note. */
export function ChartCard({ title, aside, legend, note, colors, children }: ChartCardProps): ReactElement {
  return (
    <View style={[boxStyle(colors), { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, minWidth: 0 }]}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <Text style={[caps(colors), { flexShrink: 1 }]} accessibilityRole="header">{title}</Text>
        {aside ? <Text style={{ fontSize: 10.5, color: colors.muted, flexShrink: 0 }}>{aside}</Text> : null}
      </View>
      {legend && legend.length ? <Legend items={legend} colors={colors} /> : null}
      {children}
      {note ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 8 }}>{note}</Text> : null}
    </View>
  );
}

// ── headline numbers ─────────────────────────────────────────────────

/** The tiles in a wrapping grid, each at least 150 px. */
export function KpiTiles({ tiles, colors }: { tiles: readonly KpiTile[]; colors: ChartColors }): ReactElement {
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
      {tiles.map((t, i) => (
        <View key={i} style={[boxStyle(colors), { flexGrow: 1, flexBasis: 150, minWidth: 0, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 }]}>
          <Text style={caps(colors)} numberOfLines={1}>{t.label}</Text>
          <Text style={[{
            fontSize: 22, fontWeight: "650" as TextStyle["fontWeight"], letterSpacing: -0.4,
            color: t.tone === "bad" ? colors.critical : t.tone === "good" ? colors.good : colors.ink,
          }, NUM]}>{t.value}</Text>
          {t.note ? <Text style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>{t.note}</Text> : null}
        </View>
      ))}
    </View>
  );
}

/**
 * When the backlog clears, labelled as an estimate on the row itself, with
 * what it is estimated from underneath (etaRow).
 */
export function EtaRow({ eta, colors }: { eta: Eta; colors: ChartColors }): ReactElement {
  const s = useStrings();
  let value: string;
  let note: string;
  let bad = false;
  if (eta.kind === "clear") {
    value = s.flowEtaClear;
    note = s.flowEtaClearWhy;
  } else if (eta.kind === "never") {
    value = s.flowEtaNever;
    note = s.flowEtaNeverWhy(eta.net);
    bad = true;
  } else {
    value = s.flowEtaValue(eta.steps, eta.step, fmtEtaDate(eta.at, s.locale));
    note = s.flowEtaBasis(eta.open, eta.rate, eta.step);
  }
  return (
    <View style={[boxStyle(colors), { paddingHorizontal: 12, paddingVertical: 10 }]}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 4 }}>
        <Text style={caps(colors)}>{s.flowEtaTitle}</Text>
        <Text style={{ fontSize: 14, fontWeight: "650" as TextStyle["fontWeight"], color: bad ? colors.critical : colors.ink }}>{value}</Text>
        <View style={{
          borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 1,
          backgroundColor: mix(colors.warning, 16, colors.card),
        }}>
          <Text style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: 0.8, color: colors.ink2 }}>{s.flowEtaMark}</Text>
        </View>
      </View>
      <Text style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>{note}</Text>
    </View>
  );
}

// ── breakdowns ───────────────────────────────────────────────────────

export interface BreakdownCardProps {
  cut: Cut;
  colors: ChartColors;
  /** Label → color slot (palette.labelSlots over the project's labels) for the tag cut. */
  slots?: Map<string, number>;
  /** Whether a bar's filter is on now (the row shows pressed). */
  isActive?: (filter: BucketFilter, bucket: Bucket) => boolean;
  /** A filterable bar was pressed. Without it no row is pressable. */
  onToggle?: (filter: BucketFilter, bucket: Bucket) => void;
  /** Overrides of the default naming and painting of a bucket. */
  labelOf?: (bucket: Bucket) => string;
  colorOf?: (bucket: Bucket) => string;
}

/**
 * One breakdown: a row per bucket — label, track, bar scaled to the cut's
 * tallest bucket, count. A bar that stands for a single filter value is a
 * button (toggles that filter); a bar for a group (other, none, unset,
 * readiness' middle) is a plain row that says why it is not.
 */
export function BreakdownCard({ cut, colors, slots, isActive, onToggle, labelOf, colorOf }: BreakdownCardProps): ReactElement {
  const s = useStrings();
  const color = colorResolver(colors);
  const max = cutMax(cut);
  return (
    <View
      style={[boxStyle(colors), { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, minWidth: 0 }]}
      accessibilityLabel={`${cutTitle(s, cut.key)}: ${s.issues(cut.total)}`}
    >
      <Text style={[caps(colors), { marginBottom: 4 }]} accessibilityRole="header">{cutTitle(s, cut.key)}</Text>
      {cut.overCounts ? <Text style={{ fontSize: 11, color: colors.muted, marginBottom: 8 }}>{s.chartTagsOverlap}</Text> : null}
      {!cut.buckets.length ? <Text style={{ fontSize: 12, color: colors.muted, paddingVertical: 10 }}>{s.chartEmptyCut}</Text> : null}
      <View style={{ gap: 1 }}>
        {cut.buckets.map((b) => {
          const label = labelOf ? labelOf(b) : bucketLabel(s, cut.key, b);
          const fill = color(colorOf ? colorOf(b) : bucketToken(cut.key, b.key, b.kind, slots));
          const target = bucketFilter(cut.key, b.key);
          const on = Boolean(target && isActive && isActive(target, b));
          const inner = (pressed: boolean, hovered: boolean) => (
            <View style={{
              flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0, paddingVertical: 3, paddingHorizontal: 5,
              marginHorizontal: -5, borderRadius: 6,
              backgroundColor: on ? colors.sel : hovered || pressed ? colors.hover : "transparent",
            }}>
              <Text numberOfLines={1} style={{ width: 108, fontSize: 12, color: on ? colors.ink : colors.ink2 }}>{label}</Text>
              <View style={{ flex: 1, minWidth: 30, height: 10, borderRadius: 4, backgroundColor: colors.grid, overflow: "hidden" }}>
                <View style={{
                  width: `${barPercent(b.count, max)}%`, minWidth: 3, height: "100%",
                  borderTopRightRadius: 4, borderBottomRightRadius: 4, backgroundColor: fill,
                }} />
              </View>
              <Text style={[{ minWidth: 22, textAlign: "right", fontSize: 11.5, color: on ? colors.ink : colors.ink2 }, NUM]}>{b.count}</Text>
            </View>
          );
          const reading = `${label}: ${s.issues(b.count)}`;
          if (target && onToggle) {
            const hint = on ? s.chartBarUnfilter(label) : s.chartBarFilter(label);
            return (
              <Pressable
                key={b.key}
                onPress={() => onToggle(target, b)}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={`${reading}. ${hint}`}
                accessibilityHint={hint}
                style={Platform.OS === "web" ? ({ cursor: "pointer" } as object) : undefined}
              >
                {({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => inner(pressed, Boolean(hovered))}
              </Pressable>
            );
          }
          return (
            <View key={b.key} accessibilityLabel={target ? reading : `${reading}. ${s.chartBarGroup}`}>
              {inner(false, false)}
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── cohorts ──────────────────────────────────────────────────────────

/**
 * What became of each step's intake: a row per step, a column per age, the
 * share closed as text on a green wash. A span not yet elapsed and a step
 * that raised nothing are dashes. Scrolls sideways below its natural width;
 * on web a cell's readout shows on hover.
 */
export function CohortGrid({ rows, step, colors }: { rows: readonly CohortRow[]; step: Step; colors: ChartColors }): ReactElement {
  const s = useStrings();
  const [hot, setHot] = useState<string | null>(null);
  const head = [s.flowCohStep, s.flowCohRaised, ...COHORT_AGES.map((n) => s.flowCohWithin(n)), s.flowCohSoFar];
  const W_WHEN = 120;
  const W_N = 64;
  const W_CELL = 72;
  const cellText: TextStyle = { fontSize: 12, textAlign: "right" };
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel={s.flowCohAria(rows.length)}>
      <View style={{ minWidth: 420, flexGrow: 1, gap: 2 }}>
        <View style={{ flexDirection: "row", gap: 2 }}>
          {head.map((h, i) => (
            <Text key={i} numberOfLines={1} style={[caps(colors), {
              fontSize: 9.5, paddingHorizontal: 6, paddingBottom: 3,
              textAlign: i ? "right" : "left", width: i === 0 ? W_WHEN : i === 1 ? W_N : W_CELL, flexGrow: i > 1 ? 1 : 0,
            }]}>{h}</Text>
          ))}
        </View>
        {rows.map((r) => (
          <View key={r.start} style={{ flexDirection: "row", gap: 2 }}>
            <Text numberOfLines={1} style={{ width: W_WHEN, fontSize: 12, color: colors.ink2, paddingHorizontal: 6, paddingVertical: 5 }}>
              {tempoLabel(r.start, step, s.locale)}
            </Text>
            <Text style={[cellText, NUM, { width: W_N, color: colors.muted, paddingHorizontal: 6, paddingVertical: 5 }]}>{r.raised}</Text>
            {r.cells.map((c, j) => {
              const id = `${r.start}:${j}`;
              const known = c.state === "known";
              const tip = c.state === "empty" ? s.flowCohEmpty : c.state === "young" ? s.flowCohYoung : s.flowCohCell(c.closed, c.raised);
              return (
                <Pressable
                  key={j}
                  disabled={Platform.OS !== "web"}
                  onHoverIn={() => setHot(id)}
                  onHoverOut={() => setHot((h) => (h === id ? null : h))}
                  accessibilityLabel={tip}
                  style={{
                    width: W_CELL, flexGrow: 1, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 5,
                    backgroundColor: known ? mix(colors.good, cohortWash(c.share), colors.card) : "transparent",
                  }}
                >
                  <Text style={[cellText, NUM, { color: known ? colors.ink : colors.muted }]}>
                    {known ? s.flowPct(c.share) : "—"}
                  </Text>
                  {hot === id ? (
                    <View pointerEvents="none" style={{
                      position: "absolute", bottom: "100%", right: 0, marginBottom: 4, zIndex: 5,
                      backgroundColor: colors.tipBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, width: 180,
                    }}>
                      <Text style={{ color: colors.tipFg, fontSize: 11, textAlign: "center" }}>{tip}</Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

// ── sparkline ────────────────────────────────────────────────────────

/** A row's trend: a tiny column per step, no axis, on the table's shared scale. */
export function Sparkline({ series, max, aria, colors, width = 120, height = 20, color }: {
  series: readonly number[]; max: number; aria: string; colors: ChartColors;
  width?: number; height?: number; color?: string;
}): ReactElement {
  return (
    <Chart
      colors={colors}
      width={width}
      minWidth={0}
      scene={sparklineScene({ series, max, aria, width, height, color })}
    />
  );
}
