/**
 * Assignees — who is carrying what (reference renderChartPeople), and one
 * person up close (renderPersonSummary): their figures, their own run of
 * closings, their pace, how their work divides up, and what they are
 * holding right now, oldest first — each held issue opens in the tree.
 */

import { useMemo, type ReactElement } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import {
  aggregatePeople, nextSort, personWip, rowsOfPerson, seriesBarsScene, sortPeople,
  type PeopleReading, type PeopleSortKey, type Person, type WipItem,
} from "../../../shared/charts/index.ts";
import type { TreeRow } from "../../../shared/types.ts";
import { useBeads } from "../../beads.tsx";
import { Chart, ChartCard, KpiTiles, stepCaption, tipFor, type ChartColors } from "../../charts/index.ts";
import { useStore } from "../../store.tsx";
import { FONT, MONO, MONO_DOM } from "../../theme.ts";
import { StatusDot, titled } from "../../ui.tsx";
import { ChartsEmpty, ClosedWarning, DrillHead, Foot, PaceCard, useChartColors } from "./common.tsx";
import { CutCards } from "./cuts.tsx";
import { ContributorTable, type TableColumn } from "./table.tsx";

const PERSON_CUTS = ["status", "type", "priority"] as const;

export function ChartsPeople({ rows }: { rows: readonly TreeRow[] }): ReactElement {
  const { t } = useBeads();
  const { ui, dispatch } = useStore();
  const colors = useChartColors();
  const data = useMemo(
    () => (rows.length ? aggregatePeople(rows, ui.chartsPeriod, Date.now(), ui.chartsStep) : null),
    [rows, ui.chartsPeriod, ui.chartsStep],
  );
  if (!rows.length || !data) return <ChartsEmpty text={t.emptyNothing} />;
  if (data.empty) return <ChartsEmpty text={t.flowNoDates} testID="beads-charts-nodates" />;
  if (ui.personId != null) return <PersonPage rows={rows} data={data} name={ui.personId} colors={colors} />;
  // Not one issue has an assignee: say so rather than a table of "unassigned".
  if (data.people.every((p) => p.unassigned)) return <ChartsEmpty text={t.pplNobody} />;

  const columns: TableColumn<PeopleSortKey>[] = [
    { key: "name", label: t.fPerson },
    { key: "closed", label: t.pplClosed },
    { key: "wip", label: t.pplWip },
    { key: "waiting", label: t.pplWaiting, narrowHide: true },
    { key: "total", label: t.pplTotal, narrowHide: true },
    { key: "medianLead", label: t.pplLead },
  ];
  return (
    <View style={{ gap: 14 }}>
      <ClosedWarning />
      <ContributorTable<Person, PeopleSortKey>
        testID="beads-ppl-table"
        rows={sortPeople(data.people, ui.peopleSort)}
        columns={columns}
        sort={ui.peopleSort}
        onSort={(key) => dispatch({ type: "peopleSort", sort: nextSort(ui.peopleSort, key) })}
        onOpen={(name) => dispatch({ type: "person", name })}
        emptyName={t.chartUnassigned}
        isEmptyRow={(p) => p.unassigned}
        meterKey="closed"
        meterOf={(p) => p.closed}
        cellOf={(p, key) => (key === "medianLead"
          ? (p.medianLead == null ? "—" : t.flowDays(Math.round(p.medianLead)))
          : String(p[key as Exclude<PeopleSortKey, "name" | "medianLead">]))}
        trendAria={(p) => t.pplTrendAria(p.closed)}
        rowAria={(p, name) => t.pplRow(name, p.closed, p.wip + p.waiting)}
        colors={colors}
      />
      {data.undated ? <Foot>{t.flowUndated(data.undated)}</Foot> : null}
    </View>
  );
}

function PersonPage({ rows, data, name, colors }: { rows: readonly TreeRow[]; data: PeopleReading; name: string; colors: ChartColors }): ReactElement {
  const { t } = useBeads();
  const { dispatch } = useStore();
  const person = data.people.find((p) => p.name === name);
  const theirs = useMemo(() => rowsOfPerson(rows, name), [rows, name]);
  const wip = useMemo(() => personWip(rows, name, Date.now()), [rows, name]);
  const head = (
    <DrillHead
      back={t.pplBack}
      name={name || t.chartUnassigned}
      muted={!name}
      testID="beads-person-back"
      onBack={() => dispatch({ type: "person", name: null })}
    />
  );
  // A filter change can take them out from under the reader.
  if (!person) {
    return (
      <View style={{ gap: 14 }}>
        {head}
        <ChartsEmpty text={t.pplGone} />
      </View>
    );
  }
  const starts = data.bounds;
  const step = data.step;
  return (
    <View testID="beads-person" style={{ gap: 14 }}>
      {head}
      <ClosedWarning />
      <KpiTiles
        colors={colors}
        tiles={[
          { label: t.pplClosed, value: String(person.closed) },
          { label: t.pplWip, value: String(person.wip) },
          { label: t.pplWaiting, value: String(person.waiting) },
          { label: t.pplLead, value: person.medianLead == null ? "—" : t.flowDays(Math.round(person.medianLead)) },
        ]}
      />
      <ChartCard
        title={t.pplTheirClosings}
        aside={stepCaption(t, step)}
        colors={colors}
        legend={[{ label: t.flowClosed, color: "good", value: person.closed }]}
      >
        <Chart
          colors={colors}
          scene={(width) => seriesBarsScene({
            starts, step, width, locale: t.locale, aria: t.pplClosingsAria(person.closed),
            series: { values: person.series, color: "good", tip: (i) => tipFor(t, person.series, i, starts[i]!, step), key: "closed" },
          })}
        />
      </ChartCard>
      <PaceCard
        frames={data.frames}
        step={step}
        colors={colors}
        lines={[{ name: t.tempoClosingLine, values: person.series, color: "good" }]}
      />
      <CutCards rows={theirs} only={PERSON_CUTS} colors={colors} />
      <ChartCard title={t.pplTheirWip} colors={colors}>
        {wip.length ? (
          <View style={{ marginTop: 6 }}>
            {wip.map((item) => <WipRow key={item.row.id} item={item} colors={colors} />)}
          </View>
        ) : (
          <ChartsEmpty text={t.pplNoWip} />
        )}
      </ChartCard>
    </View>
  );
}

/** One held issue: its status, key, title and how long it has been held — and the way into it. */
function WipRow({ item, colors }: { item: WipItem<TreeRow>; colors: ChartColors }): ReactElement {
  const { pal, t, openIssue } = useBeads();
  const { dispatch } = useStore();
  const open = () => {
    // The tree is where a card lives: leave the charts for it (reference openIssueFromCharts).
    dispatch({ type: "view", view: "tree" });
    openIssue(item.row.id);
  };
  return (
    <Pressable
      ref={titled(t.pplOpenIssue(item.row.id)) as never}
      testID={`beads-person-wip-${item.row.id}`}
      accessibilityRole="button"
      accessibilityLabel={t.pplOpenIssue(item.row.id)}
      onPress={open}
      style={(st) => [
        {
          flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 7, paddingHorizontal: 8, marginHorizontal: -8,
          borderRadius: 6, backgroundColor: (st as { hovered?: boolean }).hovered ? colors.hover : "transparent",
        },
        Platform.OS === "web" ? ({ cursor: "pointer" } as object) : null,
      ]}
    >
      <StatusDot pal={pal} status={item.row.status} />
      <Text {...MONO_DOM} style={{ fontFamily: MONO, fontSize: FONT.id, color: colors.muted }}>{item.row.id}</Text>
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: FONT.rowTitle, color: colors.ink }}>{item.row.title}</Text>
      <Text style={{ fontSize: FONT.stat, color: item.stale ? colors.critical : colors.muted, fontWeight: item.stale ? "600" : "400" }}>
        {t.pplAge(item.ageDays)}
      </Text>
    </Pressable>
  );
}
