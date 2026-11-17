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
 * - `ui.view` (client/store.tsx) picks the body; board and charts render in
 *   place of the tree + card pair.
 * - The card width is a fixed share for now; the splitter (pbd-759.7)
 *   replaces cardWidth().
 */

import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { flattenTree, parentIds, visibility } from "../shared/tree.ts";
import { BeadsProvider, useBeads } from "./beads.tsx";
import { CardPane, type CardSlots } from "./card.tsx";
import { EmptyState } from "./empty.tsx";
import { Header, type HeaderSlots } from "./header.tsx";
import { StoreProvider, useStore } from "./store.tsx";
import { Tree } from "./tree.tsx";

/** Beyond this the panel is one column and the card is an overlay. */
export const NARROW_PX = 900;
/** Card pane limits (reference CARD_MIN_W / TREE_MIN_W). */
const CARD_MIN_W = 320;
const TREE_MIN_W = 340;

function cardWidth(total: number): number {
  return Math.max(CARD_MIN_W, Math.min(Math.round(total * 0.44), total - TREE_MIN_W));
}

export function BeadsPanel(props: PluginWorkspacePanelProps) {
  return (
    <StoreProvider tab={props.tab}>
      <BeadsProvider hostId={props.host.id} workspaceId={props.workspaceId} theme={props.theme}>
        <Body compactHost={props.layout.compact} />
      </BeadsProvider>
    </StoreProvider>
  );
}

const HEADER_SLOTS: HeaderSlots = {};
const CARD_SLOTS: CardSlots = {};

function Body({ compactHost }: { compactHost: boolean }) {
  const { pal, data, index } = useBeads();
  const { ui, dispatch } = useStore();
  const [width, setWidth] = useState(0);
  const narrow = compactHost || (width > 0 && width < NARROW_PX);

  const expanded = useMemo(() => new Set(ui.expanded), [ui.expanded]);
  const flat = useMemo(() => {
    if (!index) return null;
    const passes = visibility(index, { showClosed: ui.showClosed, filters: ui.filters, query: ui.query });
    return flattenTree(index, passes, expanded, ui.sort, Boolean(ui.query.trim()));
  }, [index, ui.showClosed, ui.filters, ui.query, expanded, ui.sort]);

  const tree = data.state.tree;
  let empty: React.ReactNode = null;
  if (!tree) empty = <EmptyState kind={data.state.empty ? "failure" : "loading"} />;
  else if (!tree.issues.length) empty = <EmptyState kind="none" />;
  else if (flat && !flat.nodes.length) empty = <EmptyState kind="filtered" />;

  const hasCard = Boolean(ui.selectedId) && Boolean(tree);
  const pane = { borderWidth: 1, borderColor: pal.border, borderRadius: 10, backgroundColor: pal.card, overflow: "hidden" as const };
  const pad = narrow ? 10 : 18;

  return (
    <View testID="beads-panel" style={{ flex: 1, backgroundColor: pal.bg }} onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
      <Header
        shown={flat ? flat.visible : null}
        slots={HEADER_SLOTS}
        compact={narrow}
        onExpandAll={() => index && dispatch({ type: "setExpanded", ids: parentIds(index) })}
        onCollapseAll={() => dispatch({ type: "setExpanded", ids: [] })}
      />
      <View style={{ flex: 1, flexDirection: "row", gap: 14, padding: pad, paddingTop: 12, minHeight: 0 }}>
        {!tree ? (
          <View style={[pane, { flex: 1 }]}>{empty}</View>
        ) : (
          <>
            <View style={[pane, { flex: 1, minWidth: 0 }]}>
              <Tree nodes={flat?.nodes ?? []} empty={empty} />
            </View>
            {narrow ? null : (
              <View style={[pane, { width: width ? cardWidth(width - 2 * pad - 14) : CARD_MIN_W }]}>
                <CardPane id={ui.selectedId} compact={false} slots={CARD_SLOTS} />
              </View>
            )}
          </>
        )}
      </View>
      {narrow && hasCard ? (
        <View testID="beads-card-overlay" style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: pal.card, zIndex: 100 }}>
          <CardPane id={ui.selectedId} compact slots={CARD_SLOTS} />
        </View>
      ) : null}
    </View>
  );
}
