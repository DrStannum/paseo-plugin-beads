/**
 * The contributor table — assignees on one reading, authors on the other
 * (reference contributorTable): a name, a headline count drawn as a meter so
 * rows compare down the column, plain counts, and a sparkline of the shape
 * over time. One scale for every row's meter and sparkline. Headers sort
 * (the trend column does not: a shape has no order); a row opens that
 * person's page.
 *
 * Names come off the issues and are only ever Text children.
 */

import { useState, type ReactElement } from "react";
import { Platform, Pressable, Text, View, type TextStyle } from "react-native";
import { barPercent, tableScale, type TableSort } from "../../../shared/charts/index.ts";
import { useBeads } from "../../beads.tsx";
import { Sparkline, type ChartColors } from "../../charts/index.ts";
import { FONT } from "../../theme.ts";
import { titled } from "../../ui.tsx";

export interface TableColumn<K extends string> {
  key: K;
  label: string;
  /** Dropped below COMPACT_W, where the table would not fit. */
  narrowHide?: boolean;
}

export interface ContributorRow {
  name: string;
  series: number[];
}

export interface ContributorTableProps<R extends ContributorRow, K extends string> {
  rows: readonly R[];
  columns: readonly TableColumn<K>[];
  sort: TableSort<K>;
  onSort: (key: K) => void;
  onOpen: (name: string) => void;
  emptyName: string;
  isEmptyRow: (row: R) => boolean;
  meterKey: K;
  meterOf: (row: R) => number;
  cellOf: (row: R, key: K) => string;
  trendAria: (row: R) => string;
  rowAria: (row: R, name: string) => string;
  colors: ChartColors;
  testID?: string;
}

/** Below this the less important columns go. */
const COMPACT_W = 620;
const NUM_W = 96;
const METER_W = 112;
const TREND_W = 132;

const NUM: TextStyle = { fontVariant: ["tabular-nums"] };

export function ContributorTable<R extends ContributorRow, K extends string>(p: ContributorTableProps<R, K>): ReactElement {
  const { pal, t } = useBeads();
  const [width, setWidth] = useState(0);
  const compact = width > 0 && width < COMPACT_W;
  const cols = p.columns.filter((c) => !(compact && c.narrowHide));
  const scale = tableScale(p.rows, p.meterOf);
  const caps: TextStyle = { fontSize: 10.5, color: p.colors.muted, textTransform: "uppercase", letterSpacing: 0.5 };
  const cellW = (key: K) => (key === p.meterKey ? METER_W : NUM_W);

  return (
    <View testID={p.testID} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))} style={{ minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingBottom: 8, borderBottomWidth: 1, borderColor: p.colors.border }}>
        {cols.map((c) => {
          const on = p.sort.key === c.key;
          const isName = c.key === "name";
          return (
            <Pressable
              key={c.key}
              ref={titled(t.pplSortBy(c.label)) as never}
              accessibilityRole="button"
              accessibilityLabel={t.pplSortBy(c.label)}
              accessibilityState={{ selected: on }}
              testID={`beads-ppl-sort-${c.key}`}
              onPress={() => p.onSort(c.key)}
              style={[
                { flexDirection: "row", alignItems: "center", gap: 4, justifyContent: isName ? "flex-start" : "flex-end" },
                isName ? { flex: 1, minWidth: 0 } : { width: cellW(c.key) },
                c.key === p.meterKey ? { justifyContent: "flex-start", paddingLeft: 8 } : null,
              ]}
            >
              <Text numberOfLines={1} style={[caps, on ? { color: p.colors.ink2 } : null]}>{c.label}</Text>
              {on ? <Text style={[caps, { color: p.colors.ink2 }]}>{p.sort.dir === 1 ? "▲" : "▼"}</Text> : null}
            </Pressable>
          );
        })}
        <Text style={[caps, { width: TREND_W, paddingLeft: 12 }]}>{t.pplTrend}</Text>
      </View>
      {p.rows.map((row) => {
        const empty = p.isEmptyRow(row);
        const name = empty ? p.emptyName : row.name;
        const v = p.meterOf(row);
        return (
          <Pressable
            key={row.name || "\u0000"}
            ref={titled(t.pplOpen(name)) as never}
            testID={`beads-ppl-row-${row.name || "_"}`}
            accessibilityRole="button"
            accessibilityLabel={p.rowAria(row, name)}
            onPress={() => p.onOpen(row.name)}
            style={(st) => [
              {
                flexDirection: "row", alignItems: "center", minHeight: 40, paddingHorizontal: 10,
                borderBottomWidth: 1, borderColor: p.colors.border,
                backgroundColor: (st as { hovered?: boolean }).hovered ? p.colors.hover : "transparent",
              },
              Platform.OS === "web" ? ({ cursor: "pointer" } as object) : null,
            ]}
          >
            {cols.map((c) => {
              if (c.key === "name") {
                return (
                  <Text key={c.key} numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: FONT.rowTitle + 0.5, color: empty ? pal.muted : p.colors.ink, fontStyle: empty ? "italic" : "normal" }}>
                    {name}
                  </Text>
                );
              }
              if (c.key === p.meterKey) {
                return (
                  <View key={c.key} style={{ width: METER_W, flexDirection: "row", alignItems: "center", gap: 8, paddingLeft: 8 }}>
                    <Text style={[{ width: 30, textAlign: "right", fontSize: FONT.rowTitle, color: p.colors.ink }, NUM]}>{String(v)}</Text>
                    <View style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: p.colors.grid, overflow: "hidden" }}>
                      <View style={{ width: `${v ? barPercent(v, scale.meter) : 0}%`, height: "100%", borderRadius: 3, backgroundColor: p.colors.good }} />
                    </View>
                  </View>
                );
              }
              return (
                <Text key={c.key} style={[{ width: NUM_W, textAlign: "right", fontSize: FONT.rowTitle, color: p.colors.ink2 }, NUM]}>
                  {p.cellOf(row, c.key)}
                </Text>
              );
            })}
            <View style={{ width: TREND_W, paddingLeft: 12 }}>
              <Sparkline series={row.series} max={scale.spark} aria={p.trendAria(row)} colors={p.colors} width={TREND_W - 12} />
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
