/**
 * Authors — who raises the work, and at what rate (reference
 * renderChartAuthors), and one author up close (renderAuthorSummary): how
 * much they put in, what became of it, when they raised it, and what kind
 * of work it is.
 */

import { useMemo, type ReactElement } from "react";
import { View } from "react-native";
import {
  aggregateAuthors, nextSort, rowsOfAuthor, seriesBarsScene, shareOf, sortAuthors,
  type Author, type AuthorSortKey, type AuthorsReading,
} from "../../../shared/charts/index.ts";
import { rowsCarry } from "../../../shared/charts/filter.ts";
import type { TreeRow } from "../../../shared/types.ts";
import { useBeads } from "../../beads.tsx";
import { Chart, ChartCard, KpiTiles, stepCaption, tipFor, type ChartColors } from "../../charts/index.ts";
import { useStore } from "../../store.tsx";
import { ChartsEmpty, DrillHead, Foot, PaceCard, useChartColors } from "./common.tsx";
import { CutCards } from "./cuts.tsx";
import { ContributorTable, type TableColumn } from "./table.tsx";

const AUTHOR_CUTS = ["status", "type", "priority"] as const;

export function ChartsAuthors({ rows }: { rows: readonly TreeRow[] }): ReactElement {
  const { t } = useBeads();
  const { ui, dispatch } = useStore();
  const colors = useChartColors();
  const data = useMemo(
    () => (rows.length ? aggregateAuthors(rows, ui.chartsPeriod, Date.now(), ui.chartsStep) : null),
    [rows, ui.chartsPeriod, ui.chartsStep],
  );
  if (!rows.length || !data) return <ChartsEmpty text={t.emptyNothing} />;
  if (data.empty) return <ChartsEmpty text={t.flowNoDates} testID="beads-charts-nodates" />;
  if (ui.authorId != null) return <AuthorPage rows={rows} data={data} name={ui.authorId} colors={colors} />;
  // Nobody recorded, or a backend that never sends the field? Only the first is the project's.
  if (data.authors.every((a) => a.anonymous)) {
    return <ChartsEmpty testID="beads-auth-nobody" text={rowsCarry(rows, "created_by") ? t.authNobody : t.staleBackend} />;
  }

  const columns: TableColumn<AuthorSortKey>[] = [
    { key: "name", label: t.authAuthor },
    { key: "raised", label: t.authRaised },
    { key: "closed", label: t.authOfThoseClosed },
    { key: "open", label: t.authOfThoseOpen },
    { key: "total", label: t.pplTotal, narrowHide: true },
  ];
  return (
    <View style={{ gap: 14 }}>
      <ContributorTable<Author, AuthorSortKey>
        testID="beads-auth-table"
        rows={sortAuthors(data.authors, ui.authorsSort)}
        columns={columns}
        sort={ui.authorsSort}
        onSort={(key) => dispatch({ type: "authorsSort", sort: nextSort(ui.authorsSort, key) })}
        onOpen={(name) => dispatch({ type: "author", name })}
        emptyName={t.authAnonymous}
        isEmptyRow={(a) => a.anonymous}
        meterKey="raised"
        meterOf={(a) => a.raised}
        cellOf={(a, key) => String(a[key as Exclude<AuthorSortKey, "name">])}
        trendAria={(a) => t.authAria(a.raised)}
        rowAria={(a, name) => t.authRow(name, a.raised, a.open)}
        colors={colors}
      />
      {/* Why a name here may match nobody on the assignee list. */}
      <Foot>{t.authNote}</Foot>
      {data.undated ? <Foot>{t.flowUndated(data.undated)}</Foot> : null}
    </View>
  );
}

function AuthorPage({ rows, data, name, colors }: { rows: readonly TreeRow[]; data: AuthorsReading; name: string; colors: ChartColors }): ReactElement {
  const { t } = useBeads();
  const { dispatch } = useStore();
  const author = data.authors.find((a) => a.name === name);
  const theirs = useMemo(() => rowsOfAuthor(rows, name), [rows, name]);
  const head = (
    <DrillHead
      back={t.authBack}
      name={name || t.authAnonymous}
      muted={!name}
      testID="beads-author-back"
      onBack={() => dispatch({ type: "author", name: null })}
    />
  );
  if (!author) {
    return (
      <View style={{ gap: 14 }}>
        {head}
        <ChartsEmpty text={t.pplGone} />
      </View>
    );
  }
  const starts = data.bounds;
  const step = data.step;
  const share = (n: number) => (author.total ? shareOf(n, author.total) : undefined);
  return (
    <View testID="beads-author" style={{ gap: 14 }}>
      {head}
      <KpiTiles
        colors={colors}
        tiles={[
          { label: t.authRaised, value: String(author.raised) },
          { label: t.pplTotal, value: String(author.total) },
          { label: t.authOfThoseClosed, value: String(author.closed), share: share(author.closed) },
          { label: t.authOfThoseOpen, value: String(author.open), share: share(author.open) },
        ]}
      />
      <ChartCard
        title={t.authTheirRaised}
        aside={stepCaption(t, step)}
        colors={colors}
        legend={[{ label: t.authRaised, color: "muted", value: author.raised }]}
      >
        <Chart
          colors={colors}
          scene={(width) => seriesBarsScene({
            starts, step, width, locale: t.locale, aria: t.authAria(author.raised),
            series: { values: author.series, color: "muted", tip: (i) => tipFor(t, author.series, i, starts[i]!, step), key: "raised" },
          })}
        />
      </ChartCard>
      <PaceCard
        frames={data.frames}
        step={step}
        title={t.authPace}
        colors={colors}
        lines={[{ name: t.tempoRaisingLine, values: author.series, color: "muted" }]}
      />
      <CutCards rows={theirs} only={AUTHOR_CUTS} colors={colors} />
    </View>
  );
}
