/**
 * The panel's client state in React: one reducer (client/ui-state.ts) behind
 * a context, persisted into the Paseo tab (useTabState) as it changes.
 */

import type { PluginTab } from "@getpaseo/plugin/client";
import { useTabState } from "@getpaseo/plugin/client";
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import type { z } from "zod";
import { TAB_DEFAULT, TabStateSchema, initialUi, persisted, reducer, type Action, type TabState, type UiState } from "./ui-state.ts";

export type { Action, TabState, UiState, View } from "./ui-state.ts";

interface Store {
  ui: UiState;
  dispatch: (a: Action) => void;
}

const StoreContext = createContext<Store | null>(null);

/** The state of one panel tab, persisted into the tab as it changes. */
export function StoreProvider({ tab, children }: { tab: PluginTab; children: ReactNode }) {
  const [saved, save] = useTabState(tab, TabStateSchema as unknown as z.ZodType<TabState>, TAB_DEFAULT);
  const [ui, dispatch] = useReducer(reducer, saved, initialUi);
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
