/**
 * What every part of the panel reads: the host props it needs, the palette
 * and strings, the workspace's data (client/data.ts), its tree index, and the
 * actions that cross parts (open an issue from a card, select from the tree).
 */

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { ancestorsOf, buildIndex, type TreeIndex } from "../shared/tree.ts";
import { useBeadsTree, type BeadsData } from "./data.ts";
import { useStrings } from "./i18n/messages.ts";
import type { Strings } from "./i18n/strings.ts";
import { usePollMs, useStore } from "./store.tsx";
import { paletteOf, type HostTheme, type Palette } from "./theme.ts";

export interface Beads {
  hostId: string;
  workspaceId: string;
  theme: HostTheme;
  pal: Palette;
  t: Strings;
  data: BeadsData;
  /** The tree as an index (null until a tree loaded). */
  index: TreeIndex | null;
  /** Select an issue from the tree (no reveal). */
  select(id: string): void;
  /** Open an issue from anywhere (a link in a card): reveal it in the tree and select it. */
  openIssue(id: string): void;
  isIssueKey(id: string): boolean;
}

const BeadsContext = createContext<Beads | null>(null);

export function BeadsProvider({ hostId, workspaceId, theme, children }: { hostId: string; workspaceId: string; theme: HostTheme; children: ReactNode }) {
  const { dispatch } = useStore();
  const [pollMs] = usePollMs();
  const t = useStrings();
  const pal = paletteOf(theme);
  const data = useBeadsTree(hostId, workspaceId, pollMs);
  const rows = data.state.tree?.issues ?? null;
  const index = useMemo(() => (rows ? buildIndex(rows) : null), [rows]);

  const select = useCallback((id: string) => dispatch({ type: "select", id }), [dispatch]);
  const openIssue = useCallback(
    (id: string) => {
      const row = index?.byId.get(id);
      dispatch({ type: "reveal", id, ancestors: index ? ancestorsOf(index, id) : [], closed: row?.status === "closed" });
    },
    [dispatch, index],
  );
  const isIssueKey = useCallback((id: string) => Boolean(index?.byId.has(id)), [index]);

  const value = useMemo<Beads>(
    () => ({ hostId, workspaceId, theme, pal, t, data, index, select, openIssue, isIssueKey }),
    [hostId, workspaceId, theme, pal, t, data, index, select, openIssue, isIssueKey],
  );
  return <BeadsContext.Provider value={value}>{children}</BeadsContext.Provider>;
}

export function useBeads(): Beads {
  const b = useContext(BeadsContext);
  if (!b) throw new Error("useBeads outside BeadsProvider");
  return b;
}
