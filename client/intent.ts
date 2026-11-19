/**
 * "Open Beads on this issue / in this view" from outside the tab.
 *
 * Paseo hands a workspace panel no parameters: `openPanel("beads",
 * {workspaceId})` (and the Command Center's `ctx.openPanel("beads")`) only
 * focuses the workspace's Beads tab, or creates one if there is none, and
 * `params` is always `{}`. What the host does give is the `revision` prop: it
 * grows on the tab each `openPanel` landed in, and only on that tab. So the
 * caller first leaves an intent here, per workspace, then calls `openPanel`;
 * the tab takes the intent when its `revision` grew since its last render, or
 * when it has just mounted (a new tab, or one evicted from Paseo's mounted
 * set) and the intent is still fresh. A second Beads tab of the same
 * workspace (the "+" menu makes one) or a hidden mounted copy sees no
 * revision change, so it leaves the intent alone; whoever takes it first
 * removes it, so exactly one tab acts on it.
 *
 * The plugin's client bundle runs once per host (installation), so one bus
 * per host comes for free; the module-level bus below is that one. A newer
 * intent for a workspace replaces an older one; one nobody took within
 * INTENT_TTL_MS is dropped. Pure apart from the clock it is handed: the
 * tests drive it under node.
 */

import type { View } from "./ui-state.ts";

/** How long an intent waits for a tab to take it. */
export const INTENT_TTL_MS = 3000;

/** What the tab should do when it opens; nothing set = just open. */
export interface OpenIntent {
  /** Open this issue's card: its branch expanded, its row scrolled into view. */
  issueId?: string;
  /** Switch the tab to this view first. */
  view?: View;
}

/** How a tab came to look for an intent. */
export interface TakeCause {
  /** The tab's `revision` prop grew since its last render: an openPanel landed in it. */
  revisionGrew: boolean;
  /** The tab's first render. */
  freshMount: boolean;
}

export interface IntentBus {
  /** Leave an intent for the workspace's Beads tab (replaces an older one). Returns its sequence number. */
  put(workspaceId: string, intent: OpenIntent): number;
  /** The intent for the workspace, if this tab is the one to act on it; taking removes it. */
  take(workspaceId: string, cause: TakeCause): OpenIntent | null;
  /** Drop the workspace's intent, if it is still `seq` (an open that failed). */
  drop(workspaceId: string, seq: number): void;
  /** An intent is waiting for the workspace (expired ones do not count). */
  pending(workspaceId: string): boolean;
}

interface Pending {
  seq: number;
  at: number;
  intent: OpenIntent;
}

export function createIntentBus(now: () => number = Date.now, ttl = INTENT_TTL_MS): IntentBus {
  const waiting = new Map<string, Pending>();
  let seq = 0;
  /** The workspace's intent if it has not expired (an expired one is removed). */
  const live = (workspaceId: string): Pending | null => {
    const p = waiting.get(workspaceId);
    if (!p) return null;
    if (now() - p.at > ttl) {
      waiting.delete(workspaceId);
      return null;
    }
    return p;
  };
  return {
    put(workspaceId, intent) {
      const clean: OpenIntent = {};
      if (intent.issueId) clean.issueId = intent.issueId;
      if (intent.view) clean.view = intent.view;
      waiting.set(workspaceId, { seq: ++seq, at: now(), intent: clean });
      return seq;
    },
    take(workspaceId, cause) {
      if (!cause.revisionGrew && !cause.freshMount) return null;
      const p = live(workspaceId);
      if (!p) return null;
      waiting.delete(workspaceId);
      return p.intent;
    },
    drop(workspaceId, n) {
      if (waiting.get(workspaceId)?.seq === n) waiting.delete(workspaceId);
    },
    pending(workspaceId) {
      return live(workspaceId) != null;
    },
  };
}

/** This host's bus: every Beads tab, the Command Center and the explorer of this host share it. */
export const intents: IntentBus = createIntentBus();

/** Opens (focuses, or creates) the workspace's Beads tab: `client.openPanel("beads", {workspaceId})`. */
export type PanelOpener = (workspaceId: string) => void;

let opener: PanelOpener | null = null;

/** index.client.tsx hands the bus the host's openPanel; returns the undo for its cleanup. */
export function setPanelOpener(open: PanelOpener): () => void {
  opener = open;
  return () => {
    if (opener === open) opener = null;
  };
}

/**
 * Open the workspace's Beads tab and have it act on `intent`. `open` replaces
 * the host's openPanel (the Command Center passes its own `ctx.openPanel`).
 * If opening throws, the intent is dropped and the error goes to the caller
 * (the Command Center shows it as a toast).
 */
export function requestOpen(workspaceId: string, intent: OpenIntent = {}, open?: () => void, bus: IntentBus = intents): void {
  const go = open ?? (opener ? () => opener!(workspaceId) : null);
  if (!go) throw new Error("beads: the panel opener is not set");
  const n = bus.put(workspaceId, intent);
  try {
    go();
  } catch (err) {
    bus.drop(workspaceId, n);
    throw err;
  }
}

/**
 * Open the workspace's compact Beads panel in the explorer (`openExplorer`),
 * or the tab when there is no explorer: in the compact (phone-sized) layout
 * the host throws "Explorer is unavailable" at once. `openTab` is the tab's
 * opener for requestOpen (the Command Center passes its own).
 */
export function openExplorerOrTab(workspaceId: string, openExplorer: () => void, openTab?: () => void, bus: IntentBus = intents): void {
  try {
    openExplorer();
  } catch {
    requestOpen(workspaceId, {}, openTab, bus);
  }
}
