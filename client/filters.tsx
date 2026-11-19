/**
 * Search and filters (reference: the toolbar's search box, Filters and
 * Columns buttons, filterPanel, columnPanel, labelPicker, renderActiveChips):
 *
 * - SearchBox: the quick search. The local match (id, title, labels) is
 *   instant; the server's full-text hits join it (client/data.ts useSearch).
 * - FilterPanel: status, type, priority, readiness, created within, labels
 *   (a searchable multi-select), assignee; reset all.
 * - ColumnPanel: which tree columns show; title always does.
 * - ActiveChips: the active filters, each removable, under the toolbar.
 *
 * All of it reads and writes the store's `filters` / `query` / `columns`.
 */

import { TextInput, ScrollView } from "@getpaseo/plugin/client/ui";
import { useMemo, useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View, type ViewStyle } from "react-native";
import {
  activeChips, activeFilterCount, COLUMNS, COLUMNS_DEFAULT, CREATED_WINDOWS, removeChip, toggleValue, type ActiveChip, type FilterOptions,
} from "../shared/tree.ts";
import { useBeads } from "./beads.tsx";
import { columnLabel, statusLabel, typeLabel } from "./format.ts";
import { useStore } from "./store.tsx";
import { FONT, MONO, MONO_DOM, mix, type Palette } from "./theme.ts";
import { Backdrop, Btn, Dropdown, LabelChip, Mark, StatusDot, TypeGlyph } from "./ui.tsx";

/** Which floating panel under the toolbar is open. */
export type ToolPanel = "filters" | "columns" | null;

/** The web input's focus ring is the host's; keep the box the reference's. */
export const NO_OUTLINE = Platform.OS === "web" ? ({ outlineStyle: "none" } as object) : null;

export function inputStyle(pal: Palette) {
  return {
    height: 30, borderWidth: 1, borderColor: pal.border, borderRadius: 8, paddingHorizontal: 9,
    color: pal.ink, backgroundColor: pal.card, fontSize: FONT.control,
  };
}

export function SearchBox() {
  const { pal, t } = useBeads();
  const { ui, dispatch } = useStore();
  return (
    <TextInput
      testID="beads-search"
      value={ui.query}
      onChangeText={(query) => dispatch({ type: "query", query })}
      placeholder={t.search}
      placeholderTextColor={pal.muted}
      accessibilityLabel={t.search}
      autoCapitalize="none"
      autoCorrect={false}
      // Grows into the toolbar's free room (the reference's flex: 1 1 220px).
      style={[inputStyle(pal), { flexGrow: 1000, flexShrink: 1, flexBasis: 220, minWidth: 140 }, NO_OUTLINE]}
    />
  );
}

/** Filters (with the active count) and Columns, toggling their panels. */
export function ToolbarButtons({ open, onOpen }: { open: ToolPanel; onOpen: (p: ToolPanel) => void }) {
  const { pal, t } = useBeads();
  const { ui } = useStore();
  const n = activeFilterCount(ui.filters);
  return (
    <>
      <Btn pal={pal} testID="beads-filters" label={t.filters} pressed={open === "filters"} onPress={() => onOpen(open === "filters" ? null : "filters")}>
        {n ? (
          <View style={{ backgroundColor: pal.link, borderRadius: 999, paddingHorizontal: 5, minWidth: 16, alignItems: "center" }}>
            <Text style={{ color: "#fff", fontSize: FONT.mark }}>{n}</Text>
          </View>
        ) : null}
      </Btn>
      {ui.view === "tree" ? (
        <Btn pal={pal} testID="beads-columns" label={t.columns} pressed={open === "columns"} onPress={() => onOpen(open === "columns" ? null : "columns")} />
      ) : null}
    </>
  );
}

/** A toggle pill (reference .cbd-chip). */
export function Chip({ pal, on, onPress, children, testID, title }: { pal: Palette; on: boolean; onPress: () => void; children: ReactNode; testID?: string; title?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={(st) => ({
        flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3,
        borderColor: on ? mix(pal.link, 40, pal.border) : pal.border,
        backgroundColor: on ? pal.sel : (st as { hovered?: boolean }).hovered ? pal.hover : pal.card,
      })}
    >
      {children}
    </Pressable>
  );
}

function ChipText({ pal, on, children }: { pal: Palette; on: boolean; children: ReactNode }) {
  return <Text style={{ fontSize: FONT.control - 0.5, color: on ? pal.ink : pal.ink2 }}>{children}</Text>;
}

function Group({ pal, label, children, z }: { pal: Palette; label: string; children: ReactNode; z?: number }) {
  return (
    <View style={{ gap: 6, minWidth: 0, zIndex: z ?? 1 }}>
      <Text style={{ fontSize: FONT.th, color: pal.muted, textTransform: "uppercase", letterSpacing: 0.5, minHeight: 15 }}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" }}>{children}</View>
    </View>
  );
}

function panelStyle(pal: Palette): ViewStyle {
  return {
    flexDirection: "row", flexWrap: "wrap", columnGap: 22, rowGap: 14, marginTop: 8, paddingVertical: 12, paddingHorizontal: 14,
    backgroundColor: pal.card, borderWidth: 1, borderColor: pal.border, borderRadius: 12,
  };
}

export function FilterPanel({ options }: { options: FilterOptions }) {
  const { pal, t } = useBeads();
  const { ui, dispatch } = useStore();
  const f = ui.filters;
  const set = (next: Partial<typeof f>) => dispatch({ type: "filters", filters: { ...f, ...next } });
  return (
    <View testID="beads-filter-panel" style={[panelStyle(pal), { zIndex: 30 }]}>
      <Group pal={pal} label={t.fStatus}>
        {options.statuses.map(({ key, n }) => {
          const on = f.statuses.indexOf(key) >= 0;
          return (
            <Chip key={key} pal={pal} on={on} testID={`beads-f-status-${key}`} onPress={() => set({ statuses: toggleValue(f.statuses, key) })}>
              <StatusDot pal={pal} status={key} />
              <ChipText pal={pal} on={on}>{`${statusLabel(t, key)} ${n}`}</ChipText>
            </Chip>
          );
        })}
      </Group>
      <Group pal={pal} label={t.fType}>
        {options.types.map(({ key, n }) => {
          const on = f.types.indexOf(key) >= 0;
          return (
            <Chip key={key} pal={pal} on={on} testID={`beads-f-type-${key}`} onPress={() => set({ types: toggleValue(f.types, key) })}>
              <TypeGlyph pal={pal} type={key} size={16} />
              <ChipText pal={pal} on={on}>{`${typeLabel(t, key)} ${n}`}</ChipText>
            </Chip>
          );
        })}
      </Group>
      {options.priorities.length ? (
        <Group pal={pal} label={t.fPriority}>
          {options.priorities.map(({ key, n }) => {
            const on = f.priorities.indexOf(key) >= 0;
            return (
              <Chip key={key} pal={pal} on={on} testID={`beads-f-pri-${key}`} onPress={() => set({ priorities: toggleValue(f.priorities, key) })}>
                <Text {...MONO_DOM} style={{ fontFamily: MONO, fontSize: FONT.mark, color: key <= 1 ? pal.pri(key) : pal.muted, fontWeight: key <= 1 ? "700" : "400" }}>{`P${key}`}</Text>
                <ChipText pal={pal} on={on}>{String(n)}</ChipText>
              </Chip>
            );
          })}
        </Group>
      ) : null}
      <Group pal={pal} label={t.fReadiness}>
        {options.readiness.map(({ key, n }) => {
          const on = f.readiness.indexOf(key) >= 0;
          return (
            <Chip key={key} pal={pal} on={on} testID={`beads-f-ready-${key}`} onPress={() => set({ readiness: toggleValue(f.readiness, key) })}>
              <Mark pal={pal} kind={key} label={key === "ready" ? t.onlyReady : t.onlyBlocked} />
              <ChipText pal={pal} on={on}>{String(n)}</ChipText>
            </Chip>
          );
        })}
      </Group>
      <Group pal={pal} label={t.fCreated}>
        {CREATED_WINDOWS.map((days) => {
          const on = f.createdDays === days;
          return (
            <Chip key={String(days)} pal={pal} on={on} testID={`beads-f-created-${days ?? "any"}`} onPress={() => set({ createdDays: days })}>
              <ChipText pal={pal} on={on}>{days == null ? t.createdAny : t.createdDays(days)}</ChipText>
            </Chip>
          );
        })}
      </Group>
      {options.labels.length ? (
        <Group pal={pal} label={t.fLabel} z={3}>
          <LabelPicker options={options} />
        </Group>
      ) : null}
      {options.people.length ? (
        <Group pal={pal} label={t.fPerson} z={2}>
          <Dropdown
            pal={pal}
            testID="beads-f-person"
            title={t.fPerson}
            value={f.assignee ?? ""}
            align="left"
            options={[{ value: "", label: t.any }].concat(options.people.map((p) => ({ value: p, label: p })))}
            onChange={(v) => set({ assignee: v || null })}
          />
        </Group>
      ) : null}
      <Group pal={pal} label="">
        <Btn pal={pal} testID="beads-f-reset" label={t.resetAll} onPress={() => dispatch({ type: "resetFilters" })} />
      </Group>
    </View>
  );
}

/**
 * Labels as a button that opens a searchable checkbox list: a project can
 * carry dozens of labels, and a chip row would swamp the panel.
 */
function LabelPicker({ options }: { options: FilterOptions }) {
  const { pal, t, index } = useBeads();
  const { ui, dispatch } = useStore();
  const [open, setOpen] = useState(false);
  const [needle, setNeedle] = useState("");
  const picked = ui.filters.labels;
  const shown = useMemo(() => {
    const q = needle.trim().toLowerCase();
    return options.labels.filter((l) => !q || l.key.toLowerCase().includes(q));
  }, [options.labels, needle]);
  const setLabels = (labels: string[]) => dispatch({ type: "filters", filters: { ...ui.filters, labels } });
  return (
    <View style={{ position: "relative", zIndex: open ? 60 : 1 }}>
      <Btn pal={pal} testID="beads-f-labels" label={`${picked.length ? t.selected(picked.length) : t.pickLabels} ▾`} pressed={open || picked.length > 0} onPress={() => setOpen(!open)} style={{ maxWidth: 220 }} />
      {open ? <Backdrop onClose={() => setOpen(false)} /> : null}
      {open ? (
        <View
          testID="beads-f-labels-panel"
          style={{
            position: "absolute", top: 34, left: 0, zIndex: 60, width: 260, padding: 8, borderRadius: 10,
            borderWidth: 1, borderColor: pal.border, backgroundColor: pal.card,
            shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 15, shadowOffset: { width: 0, height: 10 }, elevation: 8,
          }}
        >
          <TextInput
            testID="beads-f-labels-search"
            value={needle}
            onChangeText={setNeedle}
            placeholder={t.searchLabels}
            placeholderTextColor={pal.muted}
            autoFocus={Platform.OS === "web"}
            autoCapitalize="none"
            autoCorrect={false}
            onKeyPress={(e) => {
              if (e.nativeEvent.key === "Escape") setOpen(false);
            }}
            style={[inputStyle(pal), { marginBottom: 6 }, NO_OUTLINE]}
          />
          <ScrollView style={{ maxHeight: 240 }} contentContainerStyle={{ gap: 2 }}>
            {shown.length ? (
              shown.map(({ key, n }) => {
                const on = picked.indexOf(key) >= 0;
                return (
                  <Pressable
                    key={key}
                    testID={`beads-f-label-${key}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    onPress={() => setLabels(toggleValue(picked, key))}
                    style={(st) => ({
                      flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 3, paddingHorizontal: 5, borderRadius: 6,
                      backgroundColor: on ? pal.sel : (st as { hovered?: boolean }).hovered ? pal.hover : "transparent",
                    })}
                  >
                    <Text style={{ color: on ? pal.link : pal.muted, fontSize: FONT.control }}>{on ? "☑" : "☐"}</Text>
                    <View style={{ flex: 1, minWidth: 0, flexDirection: "row" }}>
                      <LabelChip pal={pal} slot={index?.labelSlots.get(key) ?? 0} text={key} />
                    </View>
                    <Text style={{ color: pal.muted, fontSize: FONT.th }}>{n}</Text>
                  </Pressable>
                );
              })
            ) : (
              <Text style={{ color: pal.muted, fontSize: FONT.stat, padding: 5 }}>{t.noMatches}</Text>
            )}
          </ScrollView>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 6 }}>
            <Btn pal={pal} small label={t.clear} disabled={!picked.length} onPress={() => setLabels([])} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

export function ColumnPanel() {
  const { pal, t } = useBeads();
  const { ui, dispatch } = useStore();
  return (
    <View testID="beads-column-panel" style={panelStyle(pal)}>
      <Group pal={pal} label={t.columns}>
        {COLUMNS.filter((c) => !c.always).map((c) => {
          const on = ui.columns.indexOf(c.key) >= 0;
          return (
            <Chip key={c.key} pal={pal} on={on} testID={`beads-col-${c.key}`} onPress={() => dispatch({ type: "columns", columns: toggleValue(ui.columns, c.key) })}>
              <ChipText pal={pal} on={on}>{columnLabel(t, c.key)}</ChipText>
            </Chip>
          );
        })}
      </Group>
      <Group pal={pal} label="">
        <Btn pal={pal} testID="beads-col-reset" label={t.resetColumns} onPress={() => dispatch({ type: "columns", columns: COLUMNS_DEFAULT.slice() })} />
      </Group>
    </View>
  );
}

/** The active filters as removable chips (reference renderActiveChips). */
export function ActiveChips() {
  const { pal, t } = useBeads();
  const { ui, dispatch } = useStore();
  const chips = activeChips(ui.filters);
  if (!chips.length) return null;
  const text = (c: ActiveChip): string => {
    switch (c.kind) {
      case "status":
        return `${t.fStatus}: ${statusLabel(t, c.value)}`;
      case "type":
        return `${t.fType}: ${typeLabel(t, c.value)}`;
      case "priority":
        return `P${c.value}`;
      case "readiness":
        return `${t.fReadiness}: ${c.value === "ready" ? t.onlyReady : t.onlyBlocked}`;
      case "created":
        return `${t.fCreated}: ${t.createdDays(c.value)}`;
      case "label":
        return `${t.fLabel}: ${c.value}`;
      case "assignee":
        return `${t.fPerson}: ${c.value}`;
    }
  };
  return (
    <View testID="beads-active-chips" style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
      {chips.map((c) => (
        <View
          key={`${c.kind}:${c.value}`}
          style={{ flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: pal.border, borderRadius: 999, paddingLeft: 9, paddingRight: 7, paddingVertical: 3, backgroundColor: pal.card }}
        >
          <Text style={{ fontSize: FONT.control - 0.5, color: pal.ink2 }}>{text(c)}</Text>
          <Pressable
            testID={`beads-chip-x-${c.kind}-${c.value}`}
            accessibilityRole="button"
            accessibilityLabel={`${t.reset}: ${text(c)}`}
            hitSlop={6}
            onPress={() => dispatch({ type: "filters", filters: removeChip(ui.filters, c) })}
          >
            <Text style={{ fontSize: FONT.control - 0.5, color: pal.ink2 }}>✕</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}
