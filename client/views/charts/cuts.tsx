/**
 * Breakdowns — the issues in view split six ways right now (reference
 * renderChartCuts / cutCard). A bar that stands for exactly one filter value
 * is a button: pressing it turns that filter on (again: off) through the
 * same filters the filter panel and the chips use, so the tree and every
 * other reading narrow with it.
 */

import { useMemo, type ReactElement } from "react";
import { aggregateCuts, type BucketFilter, type Cut, type CutKey } from "../../../shared/charts/index.ts";
import { bucketFilterOn, toggleBucketFilter } from "../../../shared/charts/filter.ts";
import type { TreeRow } from "../../../shared/types.ts";
import { useBeads } from "../../beads.tsx";
import { BreakdownCard, labelSlots, type ChartColors } from "../../charts/index.ts";
import { useStore } from "../../store.tsx";
import { CardGrid, ChartsEmpty, useChartColors } from "./common.tsx";

/** Label → color slot over the whole project's labels, so a tag keeps its hue whatever the filters. */
export function useLabelSlots(): Map<string, number> {
  const { index } = useBeads();
  return useMemo(() => {
    const all: string[] = [];
    for (const r of index?.rows ?? []) for (const l of r.labels ?? []) all.push(l);
    return labelSlots(all);
  }, [index]);
}

/** The breakdown cards of `rows`, every filterable bar wired to the filters. */
export function CutCards({ rows, only, colors }: { rows: readonly TreeRow[]; only?: readonly CutKey[]; colors: ChartColors }): ReactElement {
  const { ui, dispatch } = useStore();
  const slots = useLabelSlots();
  const cuts = useMemo(() => {
    const all = aggregateCuts(rows);
    return only ? all.filter((c: Cut) => only.indexOf(c.key) >= 0) : all;
  }, [rows, only]);
  const isActive = (f: BucketFilter) => bucketFilterOn(ui.filters, f);
  const onToggle = (f: BucketFilter) => dispatch({ type: "filters", filters: toggleBucketFilter(ui.filters, f) });
  return (
    <CardGrid>
      {cuts.map((cut) => (
        <BreakdownCard key={cut.key} cut={cut} colors={colors} slots={slots} isActive={isActive} onToggle={onToggle} />
      ))}
    </CardGrid>
  );
}

export function ChartsCuts({ rows }: { rows: readonly TreeRow[] }): ReactElement {
  const { t } = useBeads();
  const colors = useChartColors();
  if (!rows.length) return <ChartsEmpty text={t.emptyNothing} />;
  return <CutCards rows={rows} colors={colors} />;
}
