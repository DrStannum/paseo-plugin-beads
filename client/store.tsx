/**
 * The panel's client state in React: one reducer (client/ui-state.ts) behind
 * a context, persisted into the Paseo tab (useTabState) a moment after it
 * stops changing (client/tab-saver.ts), and at once when the panel goes
 * away or the app is put in the background.
 */

import type { PluginTab } from "@getpaseo/plugin/client";
import { useTabState } from "@getpaseo/plugin/client";
import { createContext, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { AppState } from "react-native";
import type { z } from "zod";
import { createTabSaver, type TabSaver } from "./tab-saver.ts";
import { TAB_DEFAULT, TabStateSchema, initialUi, persisted, reducer, type Action, type TabState, type UiState } from "./ui-state.ts";

export type { Action, TabState, UiState, View } from "./ui-state.ts";

interface Store {
  ui: UiState;
  dispatch: (a: Action) => void;
}

const StoreContext = createContext<Store | null>(null);

/** The page is going away or out of sight (web only; React does not unmount on a reload). */
interface PageEvents {
  addEventListener?(type: string, fn: () => void): void;
  removeEventListener?(type: string, fn: () => void): void;
}

/** The state of one panel tab, persisted into the tab as it changes. */
export function StoreProvider({ tab, children }: { tab: PluginTab; children: ReactNode }) {
  const [saved, save] = useTabState(tab, TabStateSchema as unknown as z.ZodType<TabState>, TAB_DEFAULT);
  const [ui, dispatch] = useReducer(reducer, saved, initialUi);
  const saveRef = useRef(save);
  saveRef.current = save;
  const saver = useRef<TabSaver | null>(null);
  if (!saver.current) saver.current = createTabSaver((json) => saveRef.current(JSON.parse(json) as TabState));
  const json = JSON.stringify(persisted(ui));
  saver.current.seed(json);
  useEffect(() => {
    saver.current!.push(json);
  }, [json]);
  useEffect(() => {
    const s = saver.current!;
    const flush = () => s.flush();
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active") flush();
    });
    // On web globalThis is the window; native has no such events.
    const page = globalThis as PageEvents;
    const onPage = typeof page.addEventListener === "function" && typeof page.removeEventListener === "function";
    if (onPage) {
      page.addEventListener!("pagehide", flush);
      page.addEventListener!("beforeunload", flush);
    }
    return () => {
      sub.remove();
      if (onPage) {
        page.removeEventListener!("pagehide", flush);
        page.removeEventListener!("beforeunload", flush);
      }
      flush();
    };
  }, []);
  const value = useMemo(() => ({ ui, dispatch }), [ui]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore(): Store {
  const s = useContext(StoreContext);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}
