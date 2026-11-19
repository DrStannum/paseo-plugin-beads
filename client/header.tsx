/**
 * The panel's head: title row (name, project, mode badge, "Refreshing…",
 * interval, refresh), the counts line, the "may be out of date" strip, and the tree toolbar
 * (reference: the header/toolbar block, renderStat, renderStaleBar).
 *
 * Slots for what other tasks add — Sync / settings (pbd-125.*), search,
 * filters, columns and the view switch (pbd-759.4, pbd-759.8), New issue —
 * are props, so the layout already has their place.
 */

import { useWorkspace } from "@getpaseo/plugin/client";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { STATUS_ORDER } from "../shared/charts/types.ts";
import { useBeads } from "./beads.tsx";
import { REFRESH_MARK_DELAY_MS } from "./data.ts";
import { failureHead } from "./empty.tsx";
import { POLL_CHOICES } from "../shared/settings.ts";
import { baseName, statusLabel } from "./format.ts";
import { usePollMs } from "./settings.tsx";
import { useStore } from "./store.tsx";
import { FONT, MONO, MONO_DOM, mix } from "./theme.ts";
import { Btn, Dropdown, titled } from "./ui.tsx";

export interface HeaderSlots {
  /** After the mode badge: the background export / sync badge. */
  badge?: ReactNode;
  /** Left of the interval picker: the Sync button and export badge (pbd-125.*). */
  actions?: ReactNode;
  /** Right of Refresh: the settings button (pbd-125.*). */
  settings?: ReactNode;
  /** Start of the toolbar: search box, Filters, Columns, the view switch (pbd-759.4 / .8). */
  toolbarStart?: ReactNode;
  /** After the toolbar start: the tree / board / charts switch (client/view-switch.tsx). */
  viewSwitch?: ReactNode;
  /** End of the toolbar: New issue (pbd-125.*). */
  toolbarEnd?: ReactNode;
  /** Under the toolbar: filter panel, column panel, active chips (pbd-759.4). */
  below?: ReactNode;
}

/**
 * `toolbar: false` — a narrow tab is showing a card in place of the list: the
 * title, counts and the stale strip stay, the list's toolbar (search, filters,
 * view switch, New issue) and what opens under it come back with the list.
 */
export function Header({ shown, slots, onExpandAll, onCollapseAll, compact, toolbar = true }: { shown: number | null; slots: HeaderSlots; onExpandAll: () => void; onCollapseAll: () => void; compact: boolean; toolbar?: boolean }) {
  const { pal, t, data, workspaceId } = useBeads();
  const { ui, dispatch } = useStore();
  const [pollMs, setPollMs] = usePollMs();
  const tree = data.state.tree;
  const directory = useWorkspace(workspaceId, (w) => w.directory);
  const project = baseName(tree?.root ?? data.state.empty?.project ?? directory);
  const mode = tree?.mode;
  const hasRows = Boolean(tree && tree.issues.length);
  return (
    <View style={{ paddingHorizontal: compact ? 10 : 18, paddingTop: compact ? 10 : 14, gap: 6, zIndex: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap", zIndex: 20 }}>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 10, flexShrink: 1, minWidth: 0 }}>
          <Text style={{ color: pal.ink, fontSize: FONT.title, fontWeight: "700" }}>{t.title}</Text>
          {project ? (
            <Text ref={titled(tree?.root ?? directory) as never} numberOfLines={1} style={{ color: pal.muted, fontSize: FONT.project, flexShrink: 1 }}>
              {project}
            </Text>
          ) : null}
          {mode ? (
            <View
              ref={titled(mode === "jsonl" ? t.modeJsonlTip : t.modeBdTip) as never}
              accessibilityLabel={mode === "jsonl" ? t.modeJsonlTip : t.modeBdTip}
              style={{
                borderWidth: 1, borderColor: mode === "jsonl" ? mix(pal.warning, 50, pal.border) : pal.border,
                borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, alignSelf: "center",
              }}
            >
              <Text {...MONO_DOM} style={{ fontFamily: MONO, fontSize: FONT.mode, color: mode === "jsonl" ? pal.warning : pal.ink2 }}>
                {mode === "jsonl" ? t.modeJsonl : t.modeBd}
              </Text>
            </View>
          ) : null}
          {slots.badge}
          <RefreshingMark />
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {slots.actions}
          <Dropdown
            pal={pal}
            testID="beads-interval"
            title={t.interval}
            value={pollMs}
            options={POLL_CHOICES.map((ms) => ({ value: ms, label: t.intervalOption(ms) }))}
            onChange={setPollMs}
          />
          <Btn pal={pal} icon="RefreshCw" title={t.refresh} testID="beads-refresh" onPress={() => void data.load("manual")} disabled={data.loading && !data.state.empty} />
          {slots.settings}
        </View>
      </View>
      <StatLine shown={shown} />
      <StaleBar />
      {hasRows && toolbar ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap", zIndex: 5 }}>
          {slots.toolbarStart}
          <View style={{ flex: 1 }} />
          {slots.viewSwitch}
          <Btn
            pal={pal}
            testID="beads-closed"
            label={ui.showClosed ? t.hideClosed : t.showClosed}
            pressed={ui.showClosed}
            onPress={() => dispatch({ type: "showClosed", on: !ui.showClosed })}
          />
          {ui.view === "tree" ? (
            <>
              <Btn pal={pal} icon="ChevronsUpDown" title={t.expandAll} testID="beads-expand-all" onPress={onExpandAll} />
              <Btn pal={pal} icon="ChevronsDownUp" title={t.collapseAll} testID="beads-collapse-all" onPress={onCollapseAll} />
            </>
          ) : null}
          {slots.toolbarEnd}
        </View>
      ) : null}
      {toolbar ? slots.below : null}
    </View>
  );
}

/**
 * "Refreshing…": the rows on screen are the copy already held while newer
 * ones load (data.refreshing). It shows only once a refresh has lasted
 * REFRESH_MARK_DELAY_MS, so a quick answer does not flash it, and goes the
 * moment the data is in. It sits at the end of the title's group, so
 * nothing before it moves.
 */
export function RefreshingMark() {
  const { pal, t, data } = useBeads();
  const on = data.refreshing;
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) {
      setShown(false);
      return;
    }
    const timer = setTimeout(() => setShown(true), REFRESH_MARK_DELAY_MS);
    return () => clearTimeout(timer);
  }, [on]);
  if (!on || !shown) return null;
  return (
    <View
      testID="beads-refreshing"
      ref={titled(t.refreshingTip) as never}
      accessibilityLabel={t.refreshing}
      style={{ flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "center" }}
    >
      <ActivityIndicator size={10 as never} color={pal.muted} />
      <Text style={{ fontSize: FONT.mark + 0.5, color: pal.muted }}>{t.refreshing}</Text>
    </View>
  );
}

/** Counts: total, per status, ready, with blockers, "x of y shown", warnings (reference renderStat). */
export function StatLine({ shown }: { shown: number | null }) {
  const { pal, t, data, search } = useBeads();
  const tree = data.state.tree;
  if (!tree) return null;
  const c = tree.counts;
  const item = (key: string, value: number, label: string, tip?: string) => (
    <Text key={key} ref={titled(tip) as never} style={{ color: pal.muted, fontSize: FONT.stat }}>
      <Text style={{ color: pal.ink2, fontWeight: "600" }}>{value}</Text> {label}
    </Text>
  );
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 2 }}>
      {item("total", c.total, t.cTotal)}
      {STATUS_ORDER.map((s) => (c.byStatus[s] ? <Fragment key={s}>{item(s, c.byStatus[s]!, statusLabel(t, s))}</Fragment> : null))}
      {item("ready", c.ready, t.cReady, t.readyTip)}
      {c.blocked ? item("blocked", c.blocked, t.cBlocked) : null}
      {shown != null && shown !== c.total ? <Text style={{ color: pal.muted, fontSize: FONT.stat }}>{t.shown(shown, c.total)}</Text> : null}
      {search.searching ? <Text testID="beads-searching" style={{ color: pal.muted, fontSize: FONT.stat }}>{t.searching}</Text> : null}
      {tree.warnings.map((w, i) => (
        <Text key={`w${i}`} ref={titled(w) as never} numberOfLines={1} style={{ color: pal.warning, fontSize: FONT.stat }}>
          {`⚠ ${w}`}
        </Text>
      ))}
    </View>
  );
}

/** "Data may be out of date" — rows stay, a retry is offered (reference renderStaleBar). */
export function StaleBar() {
  const { pal, t, data } = useBeads();
  const issue = data.state.loadIssue;
  if (!issue || !data.state.tree) return null;
  const why = issue.kind === "backend" ? t.loadStaleBackend : t.loadStaleFailed;
  // Known codes read as a phrase in the panel's language; the raw code and
  // the server's message stay in the tooltip for whoever needs them.
  const raw = [issue.code, issue.message].filter(Boolean).join(": ");
  const detail = failureHead(t, issue.code) ?? (issue.message || issue.code || "");
  return (
    <View
      testID="beads-stalebar"
      ref={titled(raw ? `${t.loadStaleTip}\n\n${raw}` : t.loadStaleTip) as never}
      style={{
        flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, paddingVertical: 3, paddingLeft: 10, paddingRight: 4,
        borderRadius: 8, borderWidth: 1, borderColor: mix(pal.warning, 40, pal.border), backgroundColor: mix(pal.warning, 12, pal.card),
      }}
    >
      <Text style={{ color: pal.warning, fontSize: FONT.stat }}>⚠</Text>
      <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: FONT.stat, color: pal.ink2 }}>
        <Text style={{ fontWeight: "600", color: pal.ink }}>{t.loadStaleTitle}</Text>
        {" · "}
        <Text style={{ color: pal.muted }}>{detail ? `${why}: ${detail}` : why}</Text>
      </Text>
      <Btn pal={pal} small label={t.retryLoad} testID="beads-stale-retry" onPress={() => void data.load("manual")} />
    </View>
  );
}
