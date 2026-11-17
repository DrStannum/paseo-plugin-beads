/**
 * Over time — how the work moved over the period (reference renderChartFlow).
 *
 * In the reference's order: the headline tiles, when the backlog clears, the
 * pace, opened against closed, the cumulative flow, waiting / working,
 * predictability, the age of the open backlog, work in progress, bugs in and
 * out, and the cohorts; then the footnotes (steps dropped, issues undated).
 * Every line chart marks a still-running last step.
 */

import { useMemo, type ReactElement } from "react";
import { View } from "react-native";
import {
  aggregateFlow, cohortTable, etaOf, flowRunning, lineScene, pairedBarsScene, stackScene,
  type Flow, type LineSeries,
} from "../../../shared/charts/index.ts";
import { rowsCarry } from "../../../shared/charts/filter.ts";
import type { TreeRow } from "../../../shared/types.ts";
import { useBeads } from "../../beads.tsx";
import {
  Chart, ChartCard, CohortGrid, EtaRow, KpiTiles, daysText, flowKpiTiles, stepAnd, stepCaption, stepTip, tipFor,
  type ChartColors, type LegendItem, type TipPart,
} from "../../charts/index.ts";
import type { Strings } from "../../i18n/strings.ts";
import { useStore } from "../../store.tsx";
import { ChartsEmpty, ClosedWarning, Foot, PaceCard, WarnStrip, useChartColors } from "./common.tsx";

export function ChartsFlow({ rows }: { rows: readonly TreeRow[] }): ReactElement {
  const { t } = useBeads();
  const { ui } = useStore();
  const colors = useChartColors();
  const flow = useMemo(
    () => (rows.length ? aggregateFlow(rows, ui.chartsPeriod, Date.now(), ui.chartsStep) : null),
    [rows, ui.chartsPeriod, ui.chartsStep],
  );
  if (!rows.length || !flow) return <ChartsEmpty text={t.emptyNothing} />;
  // Missing dates do not empty the chart — they quietly shift it, so say so.
  const staleDates = !rowsCarry(rows, "closed_at") || !rowsCarry(rows, "started_at");
  return (
    <View style={{ gap: 14 }}>
      <ClosedWarning />
      {staleDates ? <WarnStrip testID="beads-charts-stale-dates" text={t.staleDates} /> : null}
      {flow.empty ? <ChartsEmpty text={t.flowNoDates} testID="beads-charts-nodates" /> : <FlowBody flow={flow} colors={colors} t={t} />}
    </View>
  );
}

/** A line chart in a card: the step and the unit top-right, a key, an optional note. */
function LineCard({ flow, title, unit, legend, series, aria, tip, note, max, fmt, colors, t }: {
  flow: Flow; title: string; unit: string; legend: LegendItem[]; series: LineSeries[]; aria: string;
  tip: (i: number) => string; note?: string; max?: number; fmt?: (v: number) => string; colors: ChartColors; t: Strings;
}): ReactElement {
  const starts = flow.points.map((p) => p.start);
  const running = flowRunning(flow);
  return (
    <ChartCard title={title} aside={stepAnd(t, flow.step, unit)} colors={colors} legend={legend} note={note}>
      <Chart
        colors={colors}
        scene={(width) => lineScene({
          starts, step: flow.step, width, locale: t.locale, aria, series, tip, max, fmt, running, runningLabel: t.tempoRunning,
        })}
      />
    </ChartCard>
  );
}

function FlowBody({ flow, colors, t }: { flow: Flow; colors: ChartColors; t: Strings }): ReactElement {
  const { totals, step } = flow;
  const pts = flow.points;
  const starts = pts.map((p) => p.start);
  const last = pts[pts.length - 1]!;
  const created = pts.map((p) => p.created);
  const closed = pts.map((p) => p.closed);
  const days = (v: number) => daysText(t, v);
  const pct = (v: number) => t.flowPct(Math.round(v));
  const at = (i: number, parts: TipPart[]) => stepTip(t, starts[i]!, step, parts);
  const bugsIn = t.flowOf(totals.bugsCreated, totals.created);
  const bugsOut = t.flowOf(totals.bugsClosed, totals.closed);
  const common = { flow, colors, t };
  return (
    <View testID="beads-charts-flow" style={{ gap: 14 }}>
      <KpiTiles tiles={flowKpiTiles(t, totals)} colors={colors} />
      <EtaRow eta={etaOf(flow)} colors={colors} />
      <PaceCard
        frames={pts}
        step={step}
        colors={colors}
        lines={[
          { name: t.tempoRaisingLine, values: created, color: "muted" },
          { name: t.tempoClosingLine, values: closed, color: "good" },
        ]}
      />
      <ChartCard
        title={t.flowThroughput}
        aside={stepCaption(t, step)}
        colors={colors}
        legend={[{ label: t.flowOpened, color: "muted", value: totals.created }, { label: t.flowClosed, color: "good", value: totals.closed }]}
      >
        <Chart
          colors={colors}
          scene={(width) => pairedBarsScene({
            starts, step, width, locale: t.locale, aria: t.flowThroughputAria(totals.created, totals.closed),
            left: { values: created, color: "muted", tip: (i) => tipFor(t, created, i, starts[i]!, step), key: "opened" },
            right: { values: closed, color: "good", tip: (i) => tipFor(t, closed, i, starts[i]!, step), key: "closed" },
          })}
        />
      </ChartCard>
      <ChartCard
        title={t.flowCfd}
        aside={stepCaption(t, step)}
        colors={colors}
        legend={[
          { label: t.flowDone, color: "good", value: last.done },
          { label: t.flowWip, color: "accent", value: last.wip },
          { label: t.flowWaiting, color: "muted", value: last.waiting },
        ]}
      >
        <Chart
          colors={colors}
          scene={(width) => stackScene({
            starts, step, width, locale: t.locale, surface: "card",
            aria: t.flowScopeAria(totals.scope, last.done, last.wip, last.waiting),
            layers: [
              { values: pts.map((p) => p.done), color: "good" },
              { values: pts.map((p) => p.wip), color: "accent" },
              { values: pts.map((p) => p.waiting), color: "muted" },
            ],
          })}
        />
      </ChartCard>
      <LineCard
        {...common}
        title={t.flowTimesTitle}
        unit={t.flowUnitDays}
        legend={[{ label: t.flowTimesWait, color: "muted" }, { label: t.flowTimesWork, color: "accent" }]}
        series={[{ values: pts.map((p) => p.pickup), color: "muted" }, { values: pts.map((p) => p.work), color: "accent" }]}
        aria={t.flowTimesAria(pts.length)}
        tip={(i) => at(i, [{ name: t.flowTimesWait, value: pts[i]!.pickup, fmt: days }, { name: t.flowTimesWork, value: pts[i]!.work, fmt: days }])}
        note={t.flowTimesNoStart}
      />
      <LineCard
        {...common}
        title={t.flowPredTitle}
        unit={t.flowUnitDays}
        legend={[{ label: t.flowPredMedian, color: "accent" }, { label: t.flowPredP85, color: "accentSoft" }]}
        series={[{ values: pts.map((p) => p.lead), color: "accent", band: true }, { values: pts.map((p) => p.leadP85), color: "accentSoft" }]}
        aria={t.flowPredAria(pts.length)}
        tip={(i) => at(i, [{ name: t.flowPredMedian, value: pts[i]!.lead, fmt: days }, { name: t.flowPredP85, value: pts[i]!.leadP85, fmt: days }])}
        note={t.flowPredGap}
      />
      <LineCard
        {...common}
        title={t.flowAgeTitle}
        unit={t.flowUnitDays}
        legend={[{ label: t.flowAgeLine, color: "accent", value: last.age == null ? "—" : days(last.age) }]}
        series={[{ values: pts.map((p) => p.age), color: "accent" }]}
        aria={t.flowAgeAria(pts.length)}
        tip={(i) => at(i, [{ name: t.flowAgeLine, value: pts[i]!.age, fmt: days }])}
        note={t.flowAgeNote}
      />
      <LineCard
        {...common}
        title={t.flowWipTitle}
        unit={t.flowUnitIssues}
        legend={[{ label: t.flowWipLine, color: "accent", value: totals.wipNow }]}
        series={[{ values: pts.map((p) => p.wip), color: "accent" }]}
        aria={t.flowWipAria(pts.length)}
        fmt={(v) => String(Math.round(v))}
        tip={(i) => at(i, [{ name: t.flowWipLine, value: pts[i]!.wip, fmt: String }])}
        note={t.flowWipNote}
      />
      <LineCard
        {...common}
        title={t.flowBugsTitle}
        unit={t.flowUnitShare}
        legend={[{ label: t.flowBugsIn, color: "muted", value: bugsIn }, { label: t.flowBugsOut, color: "good", value: bugsOut }]}
        series={[{ values: pts.map((p) => p.bugShareIn), color: "muted" }, { values: pts.map((p) => p.bugShareOut), color: "good" }]}
        max={100}
        fmt={pct}
        aria={t.flowBugsAria(totals.bugsCreated, totals.bugsClosed)}
        tip={(i) => at(i, [{ name: t.flowBugsIn, value: pts[i]!.bugShareIn, fmt: pct }, { name: t.flowBugsOut, value: pts[i]!.bugShareOut, fmt: pct }])}
        note={t.flowBugsNote}
      />
      <ChartCard title={t.flowCohTitle} aside={stepCaption(t, step)} colors={colors} note={t.flowCohNote}>
        <View style={{ marginTop: 10 }}>
          <CohortGrid rows={cohortTable(flow)} step={step} colors={colors} />
        </View>
      </ChartCard>
      {flow.dropped ? <Foot>{t.flowDropped(pts.length, step)}</Foot> : null}
      {flow.undated ? <Foot>{t.flowUndated(flow.undated)}</Foot> : null}
    </View>
  );
}
