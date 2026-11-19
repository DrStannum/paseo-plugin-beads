/**
 * The beads workspace panel: one screen of a Paseo tab. Wide, it is the
 * header, then the tree (or the board) on the left and the card on the right
 * with a handle between them. Narrow — the tab's own width under NARROW_PX,
 * or Paseo's compact (phone) layout — it is plain list → card → back: the
 * list alone, a picked issue's card in its place across the whole tab, the
 * card's first button back to the list. Nothing is drawn over anything.
 *
 * This file only composes. Where later features plug in:
 * - HeaderSlots (client/header.tsx): Sync, settings, search, filters,
 *   columns, the view switch, New issue.
 * - CardSlots (client/card.tsx): sub-issue / edit buttons, the status
 *   menu, the comment box, label → filter.
 * - `ui.view` (client/store.tsx) picks the body: the board takes the tree's
 *   place (the card pane only shows once an issue is picked), the charts
 *   take the place of the tree + card pair.
 * - The card pane: a dragged width (client/splitter.tsx, web) clamped by
 *   cardPaneWidth(), else the reference's 55/45 split; a fixed share on native.
 *   The splitter stays: it resizes two parts of one screen, like a split in
 *   any list/detail view, and imitates no window — Paseo's own splits are
 *   between tabs. It only exists in the wide layout.
 *
 * The panel draws one screen of a Paseo tab and imitates no windows: a second
 * card side by side is a second tab or a split, which Paseo owns.
 */

import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { View, type LayoutChangeEvent } from "react-native";
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
import { intents } from "./intent.ts";
import { OpenSettingsContext, useBeadsSettings } from "./settings.tsx";
import { AssignMe, CardHeaderActions, CardNotices, CommentBox, ExportBadge, NewIssueButton, SettingsButton, StatusControl, SyncButton } from "./write-controls.tsx";
import { WritesProvider } from "./writes.tsx";

/**
 * Under this width the tab is one column: the list, or a card in its place.
 * The tree needs TREE_MIN_W and the card CARD_MIN_W plus the handle and the
 * padding (~720 px) just to fit; at 900 the default split still leaves the
 * tree ~460 px, enough for the title beside tags, readiness and status.
 * Measured on the tab itself (onLayout): `layout.compact` is the window's
 * breakpoint (< 600 px), not the tab's, so it only adds "surely narrow".
 */
export const NARROW_PX = 900;

/** `openSettings` opens the plugin's page in Paseo's Settings (index.client.tsx passes it). */
export function BeadsPanel(props: PluginWorkspacePanelProps & { openSettings?: () => void }) {
  return (
    <OpenSettingsContext.Provider value={props.openSettings ?? null}>
      <StoreProvider tab={props.tab}>
        <BeadsProvider hostId={props.host.id} workspaceId={props.workspaceId} theme={props.theme}>
          <WritesProvider tab={props.tab}>
            <OpenIntents workspaceId={props.workspaceId} revision={props.revision} />
            <Body compactHost={props.layout.compact} />
            <EditorHost />
          </WritesProvider>
        </BeadsProvider>
      </StoreProvider>
    </OpenSettingsContext.Provider>
  );
}

/**
 * Acts on what was asked from outside the tab (client/intent.ts): the
 * Command Center's "Open Beads board", an issue picked in the explorer. The
 * intent is taken when an openPanel landed in this tab (`revision` grew) or
 * on the tab's first render; a view is switched at once, an issue is opened
 * once the tree is there to reveal it in (its branch expanded, its row
 * scrolled into view). The charts have no card: an issue leaves them for the
 * tree.
 */
function OpenIntents({ workspaceId, revision }: { workspaceId: string; revision: number }) {
  const { index, openIssue } = useBeads();
  const { ui, dispatch } = useStore();
  const seen = useRef<number | null>(null);
  const [issue, setIssue] = useState<string | null>(null);
  useEffect(() => {
    const freshMount = seen.current === null;
    const revisionGrew = !freshMount && revision !== seen.current;
    seen.current = revision;
    const got = intents.take(workspaceId, { revisionGrew, freshMount });
    if (!got) return;
    let view = got.view ?? ui.view;
    if (got.issueId && view === "charts") view = "tree";
    if (view !== ui.view) dispatch({ type: "view", view });
    if (got.issueId) setIssue(got.issueId);
    // Only a new revision (or the mount) is a reason to look: not every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId, revision]);
  useEffect(() => {
    if (!issue || !index) return;
    openIssue(issue);
    setIssue(null);
  }, [issue, index, openIssue]);
  return null;
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

/**
 * A hidden tab lays out at 0 (display: none): the last real width stays, so
 * coming back to the tab re-renders nothing (the tree keeps its rows too).
 */
function keepWidth(e: LayoutChangeEvent, set: (w: number) => void) {
  const w = Math.round(e.nativeEvent.layout.width);
  if (w > 0) set(w);
}

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

  const panel = tool === "columns" && ui.view !== "tree" ? null : tool;
  const headerSlots: HeaderSlots = {
    ...HEADER_SLOTS,
    viewSwitch: <ViewSwitch />,
    toolbarStart: (
      <>
        <SearchBox />
        <ToolbarButtons open={panel} onOpen={setTool} />
      </>
    ),
    below: (
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
  const board = ui.view === "board";
  const charts = ui.view === "charts";
  /**
   * A narrow tab showing a card in place of the list. The list stays mounted
   * under display:none, so its scroll survives the way back; "back to the
   * list" (`toList`) keeps the issue selected.
   */
  const cardScreen = narrow && hasCard && !charts && !ui.listShown;
  const pane = { borderWidth: 1, borderColor: pal.border, borderRadius: 10, backgroundColor: pal.card, overflow: "hidden" as const };
  const pad = narrow ? 10 : 18;
  // What the tree and the card split between them; the handle takes the gap.
  const shared = width ? width - 2 * pad - SPLITTER_W : 0;
  const cardW = shared ? cardPaneWidth(dragW ?? ui.cardWidth, shared) : 320;

  return (
    <View testID="beads-panel" style={{ flex: 1, backgroundColor: pal.bg }} onLayout={(e) => keepWidth(e, setWidth)}>
      <Header
        shown={flat ? flat.visible : null}
        slots={headerSlots}
        compact={narrow}
        toolbar={!cardScreen}
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
            <View testID={board ? "beads-view-board" : undefined} style={[pane, { flex: 1, minWidth: 0 }, cardScreen ? { display: "none" } : null]}>
              {board ? (
                <BoardView passes={passes ?? NONE} compact={narrow} />
              ) : (
                <Tree nodes={flat?.nodes ?? []} empty={empty} />
              )}
            </View>
            {cardScreen ? (
              <View testID="beads-card-pane" style={[pane, { flex: 1, minWidth: 0 }]}>
                <CardPane id={ui.selectedId} compact slots={cardSlots} />
              </View>
            ) : null}
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
    </View>
  );
}
