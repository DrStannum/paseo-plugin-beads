/**
 * The charts view (reference renderCharts): its own bar — the four readings
 * as tabs, the period and the step — over one scrolling body. The period and
 * step mean nothing to the breakdowns (a snapshot of right now), so they are
 * not there on that tab. Every reading counts the rows the tree shows: the
 * same filters, search and "show closed".
 */

import type { ReactElement } from "react";
import { ScrollView, Text, View } from "react-native";
import { CHART_PERIODS, CHART_STEPS, CHART_TABS, type ChartTab, type Period, type PinnedStep } from "../../../shared/charts/index.ts";
import type { TreeRow } from "../../../shared/types.ts";
import { useBeads } from "../../beads.tsx";
import type { Strings } from "../../i18n/strings.ts";
import { Seg } from "../../seg.tsx";
import { useStore } from "../../store.tsx";
import { ChartsAuthors } from "./authors.tsx";
import { ChartsCuts } from "./cuts.tsx";
import { ChartsFlow } from "./flow.tsx";
import { ChartsPeople } from "./people.tsx";

function tabText(t: Strings, tab: ChartTab): [string, string] {
  switch (tab) {
    case "cuts": return [t.chartTabCuts, t.chartTabCutsTip];
    case "flow": return [t.chartTabFlow, t.chartTabFlowTip];
    case "people": return [t.chartTabPeople, t.chartTabPeopleTip];
    case "authors": return [t.chartTabAuthors, t.chartTabAuthorsTip];
  }
}

function stepText(t: Strings, step: PinnedStep): [string, string] {
  const label = step === "auto" ? t.stepAuto : step === "day" ? t.stepDay : step === "week" ? t.stepWeek : t.stepMonth;
  return [label, step === "auto" ? t.stepAutoTip : t.stepTip(label)];
}

/** The bar: tabs on the left; period and step on the right (wrapping under on a narrow pane). */
export function ChartsBar({ compact }: { compact: boolean }): ReactElement {
  const { pal, t } = useBeads();
  const { ui, dispatch } = useStore();
  const caps = { color: pal.muted, fontSize: 10.5, textTransform: "uppercase" as const, letterSpacing: 0.6 };
  return (
    <View
      style={{
        flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, rowGap: 8,
        paddingHorizontal: compact ? 10 : 14, paddingVertical: 10, borderBottomWidth: 1, borderColor: pal.border,
      }}
    >
      <Seg<ChartTab>
        pal={pal}
        role="tablist"
        testID="beads-charts-tabs"
        aria={t.chartTabsLabel}
        value={ui.chartsTab}
        onChange={(tab) => dispatch({ type: "chartsTab", tab })}
        options={CHART_TABS.map((tab) => {
          const [label, tip] = tabText(t, tab);
          return { value: tab, label, tip, testID: `beads-charts-tab-${tab}` };
        })}
      />
      <View style={{ flex: 1 }} />
      {ui.chartsTab === "cuts" ? null : (
        <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 10, rowGap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={caps}>{t.chartPeriod}</Text>
            <Seg<Period>
              pal={pal}
              testID="beads-charts-period"
              aria={t.chartPeriod}
              value={ui.chartsPeriod}
              onChange={(period) => dispatch({ type: "chartsPeriod", period })}
              options={CHART_PERIODS.map((p) => ({
                value: p,
                label: p == null ? t.chartPeriodAll : t.chartPeriodDays(p),
                tip: t.chartPeriodTip(p as number),
                testID: `beads-charts-period-${p ?? "all"}`,
              }))}
            />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={caps}>{t.chartStep}</Text>
            <Seg<PinnedStep>
              pal={pal}
              testID="beads-charts-step"
              aria={t.chartStep}
              value={ui.chartsStep}
              onChange={(step) => dispatch({ type: "chartsStep", step })}
              options={CHART_STEPS.map((step) => {
                const [label, tip] = stepText(t, step);
                return { value: step, label, tip, testID: `beads-charts-step-${step}` };
              })}
            />
          </View>
        </View>
      )}
    </View>
  );
}

/** The whole view: the bar and the chosen reading of `rows` (already filtered like the tree). */
export function ChartsView({ rows, compact }: { rows: readonly TreeRow[]; compact: boolean }): ReactElement {
  const { pal } = useBeads();
  const { ui } = useStore();
  const tab = ui.chartsTab;
  return (
    <View testID="beads-charts" style={{ flex: 1, minHeight: 0, backgroundColor: pal.card }}>
      <ChartsBar compact={compact} />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: compact ? 10 : 14, gap: 14 }}>
        <View testID={`beads-charts-body-${tab}`}>
          {tab === "cuts" ? <ChartsCuts rows={rows} />
            : tab === "flow" ? <ChartsFlow rows={rows} />
              : tab === "people" ? <ChartsPeople rows={rows} />
                : <ChartsAuthors rows={rows} />}
        </View>
      </ScrollView>
    </View>
  );
}
