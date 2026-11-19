/**
 * The panel's client state: the selection and the way back to the cards it
 * came from, the expanded branches,
 * filters and quick search, sort and columns, the view, and the card's own
 * list settings — one reducer, one context.
 *
 * What the reference kept in localStorage is persisted per tab here
 * (useTabState, validated by a zod schema field by field, so one bad value
 * falls back to its default instead of resetting the rest). A Paseo tab
 * belongs to one workspace, so the reference's per-project keys (expanded,
 * collapsedSections, filters + query) keep their meaning; its global habits
 * (columns, sort, view, …) become per tab. The poll interval and the user's
 * name are host settings (client/settings.tsx), not tab state.
 *
 * Later features plug in by dispatching actions (`filters`, `query`, `view`,
 * `columns`, …) and reading `ui`; nothing outside this file builds the state.
 */

import type { PluginTab } from "@getpaseo/plugin/client";
import { useTabState } from "@getpaseo/plugin/client";
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { z } from "zod";
import { COLUMNS, COLUMNS_DEFAULT, NO_FILTERS, REL_COLUMNS, REL_COLUMNS_DEFAULT, REL_SORT_DEFAULT, SORTERS, type Filters, type Sort } from "../shared/tree.ts";
import { CHARTS_LIVE_INIT, CHARTS_TAB_DEFAULT, ChartsTabFields, chartsPersisted, chartsReducer, isChartsAction, type ChartsAction, type ChartsLive } from "./charts-state.ts";

export type View = "tree" | "board" | "charts";

/** Cap on remembered expanded branches (reference: 5000). */
const EXPANDED_CAP = 5000;
/** Cap on the cards "Back" can return to. */
export const BACK_CAP = 50;

const SortSchema = z
  .object({ key: z.string().refine((k) => k in SORTERS), dir: z.union([z.literal(1), z.literal(-1)]) })
  .nullable();

const FiltersSchema = z.object({
  statuses: z.array(z.string()).catch([]),
  types: z.array(z.string()).catch([]),
  priorities: z.array(z.number().int()).catch([]),
  labels: z.array(z.string()).catch([]),
  readiness: z.array(z.enum(["ready", "blocked"])).catch([]),
  createdDays: z.number().nullable().catch(null),
  assignee: z.string().nullable().catch(null),
});

const known = (defs: readonly { key: string }[], fallback: readonly string[]) =>
  z
    .array(z.string())
    .transform((list) => {
      const keys = list.filter((k) => defs.some((c) => c.key === k));
      return keys.indexOf("title") >= 0 ? keys : keys.concat("title");
    })
    .catch(fallback.slice());

/** What a tab remembers. Every field has its own fallback. */
export const TabStateSchema = z.object({
  selectedId: z.string().nullable().catch(null),
  expanded: z.array(z.string()).catch([]),
  showClosed: z.boolean().catch(false),
  sort: SortSchema.catch(null),
  columns: known(COLUMNS, COLUMNS_DEFAULT),
  view: z.enum(["tree", "board", "charts"]).catch("tree"),
  filters: FiltersSchema.catch({ ...NO_FILTERS }),
  query: z.string().catch(""),
  collapsedSections: z.array(z.string()).catch([]),
  relSort: z
    .object({ key: z.string().refine((k) => k in SORTERS), dir: z.union([z.literal(1), z.literal(-1)]) })
    .catch({ ...REL_SORT_DEFAULT }),
  relColumns: known(REL_COLUMNS, REL_COLUMNS_DEFAULT),
  commentSort: z.union([z.literal(1), z.literal(-1)]).catch(1),
  /** The charts view: reading, period, step (client/charts-state.ts). */
  ...ChartsTabFields,
  /** The card pane's dragged width in px; null = the default split (clamped on every layout). */
  cardWidth: z.number().positive().nullable().catch(null),
});
export type TabState = z.infer<typeof TabStateSchema>;

export const TAB_DEFAULT: TabState = {
  selectedId: null,
  expanded: [],
  showClosed: false,
  sort: null,
  columns: COLUMNS_DEFAULT.slice(),
  view: "tree",
  filters: { ...NO_FILTERS },
  query: "",
  collapsedSections: [],
  relSort: { ...REL_SORT_DEFAULT },
  relColumns: REL_COLUMNS_DEFAULT.slice(),
  commentSort: 1,
  ...CHARTS_TAB_DEFAULT,
  cardWidth: null,
};

/** The whole client state: what the tab remembers plus what lives only while mounted. */
export interface UiState extends TabState, ChartsLive {
  /**
   * The cards a link was followed from, newest last: "Back" returns to them.
   * Picking an issue in the tree or on the board starts over; not remembered.
   * Windows, splits and a second card are Paseo's tabs, not the panel's.
   */
  backStack: string[];
  /** Branches open in a card's children list. */
  relExpanded: string[];
  /** Bumped when an issue should be scrolled into view in the tree. */
  reveal: { id: string; seq: number } | null;
  /** Unsent comments per issue: they survive switching cards, not closing the tab. */
  drafts: Record<string, string>;
}

export type Action =
  /** A pick in the tree or on the board: a fresh start, nothing to go back to. */
  | { type: "select"; id: string | null }
  /** Return to the card the last link was followed from. */
  | { type: "back" }
  | { type: "toggleExpanded"; id: string }
  | { type: "setExpanded"; ids: string[] }
  /**
   * Follow a link: open the ancestors, show closed issues if the target is
   * one, select it and scroll to it; the card it was followed from goes on the
   * back stack.
   */
  | { type: "reveal"; id: string; ancestors: string[]; closed: boolean }
  | { type: "showClosed"; on: boolean }
  | { type: "sort"; sort: Sort | null }
  | { type: "columns"; columns: string[] }
  | { type: "view"; view: View }
  | { type: "filters"; filters: Filters }
  | { type: "query"; query: string }
  /** "Reset all filters": the filters and the search box. */
  | { type: "resetFilters" }
  | { type: "cardWidth"; width: number | null }
  /** Close the card (back to the bare tree / board). */
  | { type: "close" }
  | { type: "toggleSection"; key: string }
  | { type: "relSort"; sort: Sort }
  | { type: "relColumns"; columns: string[] }
  | { type: "toggleRelExpanded"; id: string }
  | { type: "commentSort"; dir: 1 | -1 }
  /** The charts view (client/charts-state.ts). */
  | ChartsAction
  /** The comment box of `id` changed ("" drops the draft). */
  | { type: "draft"; id: string; text: string };

function toggle(list: string[], id: string): string[] {
  return list.indexOf(id) >= 0 ? list.filter((x) => x !== id) : list.concat(id).slice(-EXPANDED_CAP);
}

/** The back stack after leaving the open card for `id` (no step from a card to itself). */
function pushBack(s: UiState, id: string): string[] {
  const from = s.selectedId;
  if (!from || from === id) return s.backStack;
  return s.backStack.concat(from).slice(-BACK_CAP);
}

export function reducer(s: UiState, a: Action): UiState {
  if (isChartsAction(a)) return chartsReducer(s, a);
  switch (a.type) {
    case "select":
      return { ...s, selectedId: a.id, backStack: [] };
    case "back": {
      if (!s.backStack.length) return s;
      const backStack = s.backStack.slice(0, -1);
      return { ...s, selectedId: s.backStack[s.backStack.length - 1]!, backStack };
    }
    case "toggleExpanded":
      return { ...s, expanded: toggle(s.expanded, a.id) };
    case "setExpanded":
      return { ...s, expanded: a.ids.slice(0, EXPANDED_CAP) };
    case "reveal": {
      const add = a.ancestors.filter((x) => s.expanded.indexOf(x) < 0);
      return {
        ...s,
        expanded: add.length ? s.expanded.concat(add).slice(-EXPANDED_CAP) : s.expanded,
        showClosed: s.showClosed || a.closed,
        selectedId: a.id,
        backStack: pushBack(s, a.id),
        reveal: { id: a.id, seq: (s.reveal?.seq ?? 0) + 1 },
      };
    }
    case "showClosed":
      return { ...s, showClosed: a.on };
    case "sort":
      return { ...s, sort: a.sort };
    case "columns": {
      const columns = a.columns.indexOf("title") >= 0 ? a.columns : a.columns.concat("title");
      // A hidden column cannot stay the sort key.
      return { ...s, columns, sort: s.sort && columns.indexOf(s.sort.key) < 0 ? null : s.sort };
    }
    case "view":
      return { ...s, view: a.view };
    case "filters":
      return { ...s, filters: a.filters };
    case "query":
      return { ...s, query: a.query };
    case "resetFilters":
      return { ...s, filters: { ...NO_FILTERS }, query: "" };
    case "cardWidth":
      return { ...s, cardWidth: a.width == null ? null : Math.round(a.width) };
    case "close":
      return { ...s, selectedId: null, backStack: [] };
    case "toggleSection":
      return { ...s, collapsedSections: toggle(s.collapsedSections, a.key) };
    case "relSort":
      return { ...s, relSort: a.sort };
    case "relColumns": {
      const relColumns = a.columns.indexOf("title") >= 0 ? a.columns : a.columns.concat("title");
      return { ...s, relColumns, relSort: relColumns.indexOf(s.relSort.key) < 0 ? { ...REL_SORT_DEFAULT } : s.relSort };
    }
    case "toggleRelExpanded":
      return { ...s, relExpanded: toggle(s.relExpanded, a.id) };
    case "commentSort":
      return { ...s, commentSort: a.dir };
    case "draft": {
      const drafts = { ...s.drafts };
      if (a.text) drafts[a.id] = a.text;
      else delete drafts[a.id];
      return { ...s, drafts };
    }
  }
}

function persisted(s: UiState): TabState {
  return {
    selectedId: s.selectedId,
    expanded: s.expanded,
    showClosed: s.showClosed,
    sort: s.sort,
    columns: s.columns,
    view: s.view,
    filters: s.filters,
    query: s.query,
    collapsedSections: s.collapsedSections,
    relSort: s.relSort,
    relColumns: s.relColumns,
    commentSort: s.commentSort,
    ...chartsPersisted(s),
    cardWidth: s.cardWidth,
  };
}

interface Store {
  ui: UiState;
  dispatch: (a: Action) => void;
}

const StoreContext = createContext<Store | null>(null);

/** The state of one panel tab, persisted into the tab as it changes. */
export function StoreProvider({ tab, children }: { tab: PluginTab; children: ReactNode }) {
  const [saved, save] = useTabState(tab, TabStateSchema as unknown as z.ZodType<TabState>, TAB_DEFAULT);
  const [ui, dispatch] = useReducer(reducer, saved, (t: TabState): UiState => ({
    ...t,
    backStack: [],
    relExpanded: [],
    ...CHARTS_LIVE_INIT,
    reveal: t.selectedId ? { id: t.selectedId, seq: 1 } : null,
    drafts: {},
  }));
  const last = useRef<string>("");
  const p = persisted(ui);
  const json = JSON.stringify(p);
  useEffect(() => {
    if (!last.current) {
      last.current = json;
      return;
    }
    if (json === last.current) return;
    last.current = json;
    save(JSON.parse(json));
  }, [json, save]);
  const value = useMemo(() => ({ ui, dispatch }), [ui]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
