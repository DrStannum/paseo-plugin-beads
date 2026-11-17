/**
 * The panel's client state: selection and history, the expanded branches,
 * filters and quick search, sort and columns, the view, and the card's own
 * list settings — one reducer, one context.
 *
 * What the reference kept in localStorage is persisted per tab here
 * (useTabState, validated by a zod schema field by field, so one bad value
 * falls back to its default instead of resetting the rest). A Paseo tab
 * belongs to one workspace, so the reference's per-project keys (expanded,
 * collapsedSections, filters + query) keep their meaning; its global habits
 * (columns, sort, view, …) become per tab. The poll interval and the user's
 * name move to host settings later (pbd-bds.5) — until then pollMs lives
 * here, read through usePollMs() only.
 *
 * Later features plug in by dispatching actions (`filters`, `query`, `view`,
 * `columns`, …) and reading `ui`; nothing outside this file builds the state.
 */

import type { PluginTab } from "@getpaseo/plugin/client";
import { useTabState } from "@getpaseo/plugin/client";
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { z } from "zod";
import { COLUMNS, COLUMNS_DEFAULT, NO_FILTERS, REL_COLUMNS, REL_COLUMNS_DEFAULT, REL_SORT_DEFAULT, SORTERS, type Filters, type Sort } from "../shared/tree.ts";
import { POLL_CHOICES, POLL_DEFAULT_MS } from "./data.ts";

export type View = "tree" | "board" | "charts";

/** Cap on remembered expanded branches (reference: 5000). */
const EXPANDED_CAP = 5000;

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
  pollMs: z.number().refine((n) => POLL_CHOICES.indexOf(n) >= 0).catch(POLL_DEFAULT_MS),
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
  pollMs: POLL_DEFAULT_MS,
};

/** The whole client state: what the tab remembers plus what lives only while mounted. */
export interface UiState extends TabState {
  /** Card navigation (reference back/forward). */
  history: string[];
  historyPos: number;
  /** Branches open in a card's children list. */
  relExpanded: string[];
  /** Bumped when an issue should be scrolled into view in the tree. */
  reveal: { id: string; seq: number } | null;
}

export type Action =
  | { type: "select"; id: string | null; history?: boolean }
  | { type: "back" }
  | { type: "forward" }
  | { type: "toggleExpanded"; id: string }
  | { type: "setExpanded"; ids: string[] }
  /** Open the ancestors, show closed issues if the target is one, select it and scroll to it. */
  | { type: "reveal"; id: string; ancestors: string[]; closed: boolean }
  | { type: "showClosed"; on: boolean }
  | { type: "sort"; sort: Sort | null }
  | { type: "columns"; columns: string[] }
  | { type: "view"; view: View }
  | { type: "filters"; filters: Filters }
  | { type: "query"; query: string }
  | { type: "toggleSection"; key: string }
  | { type: "relSort"; sort: Sort }
  | { type: "relColumns"; columns: string[] }
  | { type: "toggleRelExpanded"; id: string }
  | { type: "commentSort"; dir: 1 | -1 }
  | { type: "pollMs"; ms: number };

function toggle(list: string[], id: string): string[] {
  return list.indexOf(id) >= 0 ? list.filter((x) => x !== id) : list.concat(id).slice(-EXPANDED_CAP);
}

function pushHistory(s: UiState, id: string): Pick<UiState, "history" | "historyPos"> {
  const history = s.history.slice(0, s.historyPos + 1);
  if (history[history.length - 1] !== id) history.push(id);
  return { history, historyPos: history.length - 1 };
}

export function reducer(s: UiState, a: Action): UiState {
  switch (a.type) {
    case "select":
      if (!a.id) return { ...s, selectedId: null };
      return { ...s, selectedId: a.id, ...(a.history === false ? {} : pushHistory(s, a.id)) };
    case "back":
      if (s.historyPos <= 0) return s;
      return { ...s, historyPos: s.historyPos - 1, selectedId: s.history[s.historyPos - 1]! };
    case "forward":
      if (s.historyPos >= s.history.length - 1) return s;
      return { ...s, historyPos: s.historyPos + 1, selectedId: s.history[s.historyPos + 1]! };
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
        ...pushHistory(s, a.id),
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
    case "pollMs":
      return POLL_CHOICES.indexOf(a.ms) >= 0 ? { ...s, pollMs: a.ms } : s;
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
    pollMs: s.pollMs,
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
    history: t.selectedId ? [t.selectedId] : [],
    historyPos: t.selectedId ? 0 : -1,
    relExpanded: [],
    reveal: t.selectedId ? { id: t.selectedId, seq: 1 } : null,
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

/** The poll interval — the one place it is read from (host settings later, pbd-bds.5). */
export function usePollMs(): [number, (ms: number) => void] {
  const { ui, dispatch } = useStore();
  return [ui.pollMs, (ms) => dispatch({ type: "pollMs", ms })];
}
