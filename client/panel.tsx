/**
 * The beads workspace panel: header, then the tree on the left and the card
 * on the right. Below NARROW_PX (or on a compact host layout) the card opens
 * as a full overlay over the tree instead.
 *
 * This file only composes. Where later features plug in:
 * - HeaderSlots (client/header.tsx): Sync, settings, search, filters,
 *   columns, the view switch, New issue.
 * - CardSlots (client/card.tsx): sub-issue / edit / pin buttons, the status
 *   menu, the comment box, label → filter.
 * - `ui.view` (client/store.tsx) picks the body: the board takes the tree's
 *   place (the card pane only shows once an issue is picked), the charts
 *   take the place of the tree + card pair.
 * - The card pane: a dragged width (client/splitter.tsx, web) clamped by
 *   cardPaneWidth(), else the reference's 55/45 split; a fixed share on native.
 * - Two-card mode (`ui.focusId`): the pinned card takes the tree's place on
 *   the left, the right pane keeps showing the selected card.
 */

import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { cardPaneWidth, filterOptions, flattenTree, parentIds, pruneLabels, toggleValue, visibility } from "../shared/tree.ts";
import { BeadsProvider, useBeads } from "./beads.tsx";
import { CardPane, type CardSlots } from "./card.tsx";
import { EmptyState } from "./empty.tsx";
import { ActiveChips, ColumnPanel, FilterPanel, SearchBox, ToolbarButtons, type ToolPanel } from "./filters.tsx";
import { Header, type HeaderSlots } from "./header.tsx";
import { StoreProvider, useStore } from "./store.tsx";
import { SPLITTER_W, Splitter } from "./splitter.tsx";
import { Tree } from "./tree.tsx";
import { ViewSwitch } from "./view-switch.tsx";
import { BoardView } from "./views/board.tsx";
import { ChartsView } from "./views/charts/index.tsx";
import { EditorHost } from "./editor.tsx";
import { OpenSettingsContext, useBeadsSettings } from "./settings.tsx";
import { AssignMe, CardHeaderActions, CardNotices, CommentBox, ExportBadge, NewIssueButton, SettingsButton, StatusControl, SyncButton } from "./write-controls.tsx";
import { WritesProvider } from "./writes.tsx";

/** Beyond this the panel is one column and the card is an overlay. */
export const NARROW_PX = 900;

/** `openSettings` opens the plugin's page in Paseo's Settings (index.client.tsx passes it). */
export function BeadsPanel(props: PluginWorkspacePanelProps & { openSettings?: () => void }) {
  return (
    <OpenSettingsContext.Provider value={props.openSettings ?? null}>
      <StoreProvider tab={props.tab}>
        <BeadsProvider hostId={props.host.id} workspaceId={props.workspaceId} theme={props.theme}>
          <WritesProvider tab={props.tab}>
            <Body compactHost={props.layout.compact} />
            <EditorHost />
          </WritesProvider>
        </BeadsProvider>
      </StoreProvider>
    </OpenSettingsContext.Provider>
  );
}

const HEADER_SLOTS: HeaderSlots = {
  badge: <ExportBadge />,
  actions: <SyncButton />,
  settings: <SettingsButton />,
  toolbarEnd: <NewIssueButton />,
};
const NONE = () => false;
const CARD_SLOTS: CardSlots = {
  headerActions: (card) => <CardHeaderActions card={card} />,
  statusControl: (card) => <StatusControl card={card} />,
  notices: (card) => <CardNotices card={card} />,
  commentBox: (card) => <CommentBox card={card} />,
};

function Body({ compactHost }: { compactHost: boolean }) {
  const { pal, t, data, index, search } = useBeads();
  const { ui, dispatch } = useStore();
  const [width, setWidth] = useState(0);
  const narrow = compactHost || (width > 0 && width < NARROW_PX);
  const [tool, setTool] = useState<ToolPanel>(null);
  /** The card width while the splitter is being dragged (committed on release). */
  const [dragW, setDragW] = useState<number | null>(null);

  const expanded = useMemo(() => new Set(ui.expanded), [ui.expanded]);
  /** "Is this row on screen": filters, closed, the quick search plus the server's hits. */
  const passes = useMemo(
    () => (index ? visibility(index, { showClosed: ui.showClosed, filters: ui.filters, query: ui.query, searchIds: search.ids }) : null),
    [index, ui.showClosed, ui.filters, ui.query, search.ids],
  );
  const flat = useMemo(
    () => (index && passes ? flattenTree(index, passes, expanded, ui.sort, Boolean(ui.query.trim())) : null),
    [index, passes, expanded, ui.sort, ui.query],
  );
  /** What the charts count: the rows the tree would show (reference state.rows.filter(passes)). */
  const viewRows = useMemo(() => (index && passes ? index.rows.filter(passes) : []), [index, passes]);

  const rows = data.state.tree?.issues ?? null;
  const options = useMemo(() => filterOptions(rows ?? []), [rows]);
  // A label that vanished from the project cannot stay in the filter.
  useEffect(() => {
    if (!rows) return;
    const next = pruneLabels(ui.filters, new Set(options.labels.map((l) => l.key)));
    if (next !== ui.filters) dispatch({ type: "filters", filters: next });
  }, [rows, options, ui.filters, dispatch]);

  const focusId = ui.focusId;
  const panel = focusId ? null : tool === "columns" && ui.view !== "tree" ? null : tool;
  const headerSlots: HeaderSlots = {
    ...HEADER_SLOTS,
    viewSwitch: <ViewSwitch />,
    toolbarStart: (
      <>
        <SearchBox />
        <ToolbarButtons open={panel} onOpen={setTool} />
      </>
    ),
    below: focusId ? null : (
      <>
        {panel === "filters" ? <FilterPanel options={options} /> : null}
        {panel === "columns" ? <ColumnPanel /> : null}
        <ActiveChips />
      </>
    ),
  };
  const me = useBeadsSettings().currentUser.trim();
  const cardSlots = useMemo<CardSlots>(
    () => ({
      ...CARD_SLOTS,
      // Offered only with a name set, on a writable card not already assigned to it.
      assigneeAction: (card) => (card.mode === "bd" && me && me !== (card.assignee ?? "") ? <AssignMe card={card} /> : null),
      onLabelPress: (label: string) => dispatch({ type: "filters", filters: { ...ui.filters, labels: toggleValue(ui.filters.labels, label) } }),
    }),
    [dispatch, ui.filters, me],
  );

  const tree = data.state.tree;
  let empty: React.ReactNode = null;
  if (!tree) empty = <EmptyState kind={data.state.empty ? "failure" : "loading"} />;
  else if (!tree.issues.length) empty = <EmptyState kind="none" />;
  else if (flat && !flat.nodes.length) empty = <EmptyState kind="filtered" />;

  const hasCard = Boolean(ui.selectedId) && Boolean(tree);
  const board = ui.view === "board" && !focusId;
  const charts = ui.view === "charts" && !focusId;
  const pane = { borderWidth: 1, borderColor: pal.border, borderRadius: 10, backgroundColor: pal.card, overflow: "hidden" as const };
  const pad = narrow ? 10 : 18;
  // What the tree and the card split between them; the handle takes the gap.
  const shared = width ? width - 2 * pad - SPLITTER_W : 0;
  const cardW = shared ? cardPaneWidth(dragW ?? ui.cardWidth, shared) : 320;

  return (
    <View testID="beads-panel" style={{ flex: 1, backgroundColor: pal.bg }} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      <Header
        shown={flat ? flat.visible : null}
        slots={headerSlots}
        compact={narrow}
        onExpandAll={() => index && dispatch({ type: "setExpanded", ids: parentIds(index) })}
        onCollapseAll={() => dispatch({ type: "setExpanded", ids: [] })}
      />
      <View style={{ flex: 1, flexDirection: "row", gap: narrow ? 14 : 0, padding: pad, paddingTop: 12, minHeight: 0 }}>
        {!tree ? (
          <View style={[pane, { flex: 1 }]}>{empty}</View>
        ) : charts ? (
          // The charts take the place of the tree + card pair: they never have a selected issue.
          <View testID="beads-view-charts" style={[pane, { flex: 1, minWidth: 0 }]}>
            <ChartsView rows={viewRows} compact={narrow} />
          </View>
        ) : (
          <>
            <View testID={board ? "beads-view-board" : undefined} style={[pane, { flex: 1, minWidth: 0 }]}>
              {focusId ? (
                <CardPane key={`focus:${focusId}`} id={focusId} focus compact={narrow} slots={cardSlots} />
              ) : board ? (
                <BoardView passes={passes ?? NONE} compact={narrow} />
              ) : (
                <Tree nodes={flat?.nodes ?? []} empty={empty} />
              )}
            </View>
            {/* With nothing picked the board takes the whole width (reference .cbd-board-view:not(.cbd-has-card)). */}
            {narrow || (board && !hasCard) ? null : (
              <>
                <Splitter
                  pal={pal}
                  title={t.resize}
                  width={cardW}
                  onDrag={(w) => setDragW(w)}
                  onDone={() => {
                    if (dragW != null && shared) dispatch({ type: "cardWidth", width: cardPaneWidth(dragW, shared) });
                    setDragW(null);
                  }}
                  onReset={() => {
                    setDragW(null);
                    dispatch({ type: "cardWidth", width: null });
                  }}
                />
                <View testID="beads-card-pane" style={[pane, { width: cardW }]}>
                  <CardPane id={ui.selectedId} compact={false} slots={cardSlots} />
                </View>
              </>
            )}
          </>
        )}
      </View>
      {narrow && hasCard && !charts ? (
        <View testID="beads-card-overlay" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: pal.card, zIndex: 100 }}>
          <CardPane id={ui.selectedId} compact slots={cardSlots} />
        </View>
      ) : null}
    </View>
  );
}
