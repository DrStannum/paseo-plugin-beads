/**
 * The issue tree (reference rebuildFlat / buildRow / fillRow / buildHead):
 * a sortable column header and a virtualised list of fixed-height rows.
 * Columns wider than the pane scroll sideways, header and rows together.
 */

import { FlatList } from "@getpaseo/plugin/client/ui";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View, type FlatList as RNFlatList, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { COLUMNS, nextSort, type ColumnDef, type FlatNode, type Sort } from "../shared/tree.ts";
import { useBeads } from "./beads.tsx";
import { FLASH_MS } from "./data.ts";
import { columnLabel, fmtDate, fmtDateShort, priorityTitle, statusLabel, stringOf, typeLabel } from "./format.ts";
import type { Strings } from "./i18n/strings.ts";
import { useStore } from "./store.tsx";
import { FONT, MONO, MONO_DOM, ROW_H, type Palette } from "./theme.ts";
import { Chevron, LabelChip, Mark, PriIcon, StatusDot, TypeGlyph, titled } from "./ui.tsx";

const GAP = 6;
const TWISTY = 18;
const TITLE_MIN = 160;
const ID_MAX = 150;

/** What the columns need at their natural size; below it the tree scrolls sideways. */
export function trackWidth(columns: readonly string[], idW: number = ID_MAX): number {
  let w = TWISTY + 16;
  for (const col of COLUMNS) {
    if (columns.indexOf(col.key) < 0) continue;
    w += (col.key === "title" ? TITLE_MIN : col.key === "id" ? idW : col.width ?? 0) + GAP;
  }
  return w;
}

/**
 * What the id column may need: the project's longest key (mono), capped at
 * ID_MAX. Each row's id takes its own width, as in the reference; this only
 * caps it and sizes the sideways-scroll threshold.
 */
export function idWidth(ids: Iterable<string>): number {
  let n = 4;
  for (const id of ids) if (id.length > n) n = id.length;
  return Math.min(ID_MAX, Math.ceil(n * FONT.id * 0.6) + 4);
}

function visibleColumns(columns: readonly string[]): ColumnDef[] {
  return COLUMNS.filter((c) => c.always || columns.indexOf(c.key) >= 0);
}

interface RowProps {
  node: FlatNode;
  idW: number;
  cols: ColumnDef[];
  selected: boolean;
  flash: boolean;
  pal: Palette;
  t: Strings;
  slotOf: (label: string) => number;
  onSelect: (id: string) => void;
  onToggle: (id: string) => void;
}

const Row = memo(function Row({ node, idW, cols, selected, flash, pal, t, slotOf, onSelect, onToggle }: RowProps) {
  const row = node.row;
  const closed = row.status === "closed";
  const blockers = (row.blockers ?? []).length;
  const cell = (col: ColumnDef) => {
    const w = col.width;
    switch (col.key) {
      case "priority":
        return (
          <View key="p" ref={titled(row.priority != null ? priorityTitle(t, row.priority) : null) as never} style={{ width: w, alignItems: "center" }}>
            <PriIcon pal={pal} priority={row.priority} />
          </View>
        );
      case "type":
        return (
          <View key="t" ref={titled(typeLabel(t, row.issue_type)) as never}>
            <TypeGlyph pal={pal} type={row.issue_type} />
          </View>
        );
      case "id":
        return (
          <Text {...MONO_DOM} key="i" numberOfLines={1} style={{ fontFamily: MONO, fontSize: FONT.id, color: pal.muted, maxWidth: idW, flexShrink: 0, opacity: closed ? 0.55 : 1 }}>
            {row.id}
          </Text>
        );
      case "title":
        return (
          <View key="ti" style={{ flex: 1, minWidth: TITLE_MIN, flexDirection: "row", alignItems: "center", gap: GAP }}>
            <Text ref={titled(row.title) as never} numberOfLines={1} style={{ flexShrink: 1, fontSize: FONT.rowTitle, color: pal.ink, opacity: closed ? 0.55 : 1 }}>
              {row.title}
            </Text>
            {node.detached ? (
              <Text ref={titled(t.detached) as never} style={{ color: pal.warning, fontSize: FONT.status }}>
                ↳
              </Text>
            ) : null}
          </View>
        );
      case "labels": {
        const first = (row.labels ?? [])[0];
        return (
          <View key="l" style={{ width: w, flexDirection: "row", overflow: "hidden" }}>
            {first ? (
              <LabelChip
                pal={pal}
                slot={slotOf(first)}
                text={row.labels.length > 1 ? `${first} +${row.labels.length - 1}` : first}
                title={row.labels.join(", ")}
              />
            ) : null}
          </View>
        );
      }
      case "kids":
        return (
          <Text key="k" ref={titled(node.kidCount ? t.children(node.kidCount) : null) as never} style={{ width: w, textAlign: "right", fontSize: FONT.status - 0.5, color: pal.muted }}>
            {node.kidCount ? `▸${node.kidCount}` : ""}
          </Text>
        );
      case "mark":
        return (
          <View key="m" style={{ width: w, alignItems: "stretch" }}>
            {row.ready ? (
              <Mark pal={pal} kind="ready" label={t.ready} title={t.readyTip} />
            ) : blockers && !closed ? (
              <Mark pal={pal} kind="blocked" label={t.blocked} title={t.blockedTip(blockers)} />
            ) : null}
          </View>
        );
      case "status":
        return (
          <View key="s" style={{ width: w, flexDirection: "row", alignItems: "center", gap: 5 }}>
            <StatusDot pal={pal} status={row.status} />
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: FONT.status, color: pal.ink2 }}>
              {statusLabel(t, row.status)}
            </Text>
          </View>
        );
      case "assignee":
        return (
          <Text key="a" ref={titled(row.assignee) as never} numberOfLines={1} style={{ width: w, fontSize: FONT.status, color: pal.muted }}>
            {row.assignee ?? ""}
          </Text>
        );
      case "created":
      case "updated": {
        const iso = col.key === "created" ? row.created_at : row.updated_at;
        return (
          <Text key={col.key} ref={titled(fmtDate(iso, t.locale)) as never} numberOfLines={1} style={{ width: w, textAlign: "right", fontSize: FONT.status, color: pal.muted }}>
            {fmtDateShort(iso, t.locale)}
          </Text>
        );
      }
      case "comments":
        return (
          <Text key="c" ref={titled(row.comment_count ? t.comments(row.comment_count) : null) as never} numberOfLines={1} style={{ width: w, textAlign: "right", fontSize: FONT.status, color: pal.muted }}>
            {row.comment_count ? `💬${row.comment_count}` : ""}
          </Text>
        );
      default:
        return null;
    }
  };
  return (
    <Pressable
      testID={`beads-row-${node.id}`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={() => onSelect(node.id)}
      style={(st) => ({
        height: ROW_H,
        flexDirection: "row",
        alignItems: "center",
        gap: GAP,
        paddingLeft: 6 + node.depth * 16,
        paddingRight: 10,
        borderRadius: 6,
        backgroundColor: selected ? pal.sel : flash ? pal.flash : (st as { hovered?: boolean }).hovered ? pal.hover : "transparent",
        borderLeftWidth: selected && flash ? 2 : 0,
        borderLeftColor: pal.good,
      })}
    >
      <Pressable
        testID={node.hasKids ? `beads-twisty-${node.id}` : undefined}
        disabled={!node.hasKids}
        onPress={() => onToggle(node.id)}
        hitSlop={4}
        style={{ width: TWISTY, height: TWISTY, alignItems: "center", justifyContent: "center", borderRadius: 4, opacity: node.hasKids ? 1 : 0 }}
      >
        <Chevron pal={pal} open={node.open} />
      </Pressable>
      {cols.map(cell)}
    </Pressable>
  );
});

function Head({ cols, idW, sort, pal, t, onSort }: { cols: ColumnDef[]; idW: number; sort: Sort | null; pal: Palette; t: Strings; onSort: (key: string) => void }) {
  return (
    <View style={{ height: 28, flexDirection: "row", alignItems: "center", gap: GAP, paddingLeft: 6, paddingRight: 10, borderBottomWidth: 1, borderBottomColor: pal.border }}>
      <View style={{ width: TWISTY }} />
      {cols.map((col) => {
        const active = sort?.key === col.key;
        const name = columnLabel(t, col.key);
        const tip = `${t.sortBy(name)} — ${active && sort!.dir === 1 ? t.sortDesc : t.sortAsc}`;
        return (
          <Pressable
            key={col.key}
            ref={titled(tip) as never}
            accessibilityRole="button"
            accessibilityLabel={tip}
            testID={`beads-th-${col.key}`}
            onPress={() => onSort(col.key)}
            style={[
              { flexDirection: "row", alignItems: "center", gap: 3, overflow: "hidden" },
              col.key === "title" ? { flex: 1, minWidth: TITLE_MIN } : col.key === "id" ? { flexShrink: 0, maxWidth: idW } : { width: col.width },
              col.num ? { justifyContent: "flex-end" } : null,
            ]}
          >
            <Text numberOfLines={1} style={{ fontSize: FONT.th, color: active ? pal.link : pal.muted }}>
              {col.short ? stringOf(t, col.short) : name}
            </Text>
            {active ? <Text style={{ fontSize: 8, color: pal.link }}>{sort!.dir === 1 ? "▲" : "▼"}</Text> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export interface TreeProps {
  nodes: FlatNode[];
  /** Shown instead of rows (nothing matches, loading, …). */
  empty?: React.ReactNode;
}

export function Tree({ nodes, empty }: TreeProps) {
  const { pal, t, data, index, select } = useBeads();
  const { ui, dispatch } = useStore();
  const cols = useMemo(() => visibleColumns(ui.columns), [ui.columns]);
  const rows = index?.rows;
  const idW = useMemo(() => idWidth((rows ?? []).map((r) => r.id)), [rows]);
  const minWidth = useMemo(() => trackWidth(ui.columns, idW), [ui.columns, idW]);
  const [paneW, setPaneW] = useState(0);
  const [viewH, setViewH] = useState(0);
  const scrollY = useRef(0);
  const list = useRef<RNFlatList<FlatNode>>(null);
  const slots = index?.labelSlots;
  const slotOf = useMemo(() => (label: string) => slots?.get(label) ?? 0, [slots]);
  const onToggle = useMemo(() => (id: string) => dispatch({ type: "toggleExpanded", id }), [dispatch]);

  // Rows a poll changed glow for FLASH_MS; one timer re-renders when the next one expires.
  const flashed = data.state.flashed;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const at = Date.now();
    let next = Infinity;
    for (const id of Object.keys(flashed)) {
      const end = flashed[id]! + FLASH_MS;
      if (end > at && end < next) next = end;
    }
    if (next === Infinity) return;
    const timer = setTimeout(() => setNow(Date.now()), next - at + 20);
    return () => clearTimeout(timer);
  }, [flashed, now]);

  // Scroll a revealed issue into view (a link followed in the card, a restored selection).
  const handled = useRef(0);
  useEffect(() => {
    const r = ui.reveal;
    if (!r || r.seq === handled.current || !nodes.length || !viewH) return;
    const i = nodes.findIndex((n) => n.id === r.id);
    handled.current = r.seq;
    if (i < 0) return;
    const top = i * ROW_H;
    if (top < scrollY.current || top > scrollY.current + viewH - ROW_H) {
      list.current?.scrollToOffset({ offset: Math.max(0, top - viewH / 3), animated: false });
    }
  }, [ui.reveal, nodes, viewH]);

  const width = Math.max(paneW, minWidth);
  const onLayout = (e: LayoutChangeEvent) => setPaneW(Math.round(e.nativeEvent.layout.width));
  return (
    <View style={{ flex: 1, minWidth: 0 }} onLayout={onLayout}>
      {paneW > 0 ? (
        <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ width, flexGrow: 1 }} showsHorizontalScrollIndicator={minWidth > paneW}>
          <View style={{ width, flex: 1 }}>
            <Head cols={cols} idW={idW} sort={ui.sort} pal={pal} t={t} onSort={(key) => dispatch({ type: "sort", sort: nextSort(ui.sort, key, true) })} />
            {empty ?? (
              <FlatList
                ref={list}
                testID="beads-tree"
                data={nodes}
                keyExtractor={(n) => n.id}
                getItemLayout={(_, i) => ({ length: ROW_H, offset: ROW_H * i, index: i })}
                initialNumToRender={40}
                maxToRenderPerBatch={40}
                windowSize={9}
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingVertical: 6 }}
                onLayout={(e) => setViewH(Math.round(e.nativeEvent.layout.height))}
                onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => {
                  scrollY.current = e.nativeEvent.contentOffset.y;
                }}
                scrollEventThrottle={64}
                extraData={[ui.selectedId, cols, idW, now, pal, t, slotOf]}
                renderItem={({ item }) => (
                  <Row
                    node={item}
                    idW={idW}
                    cols={cols}
                    selected={ui.selectedId === item.id}
                    flash={flashed[item.id] != null && now - flashed[item.id]! < FLASH_MS}
                    pal={pal}
                    t={t}
                    slotOf={slotOf}
                    onSelect={select}
                    onToggle={onToggle}
                  />
                )}
              />
            )}
          </View>
        </ScrollView>
      ) : null}
    </View>
  );
}
