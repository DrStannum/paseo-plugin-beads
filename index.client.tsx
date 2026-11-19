import type { PluginButtonBehavior, PluginClientContext, PluginText, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { AppState, Dimensions } from "react-native";
import icon from "./client/icon.svg";
import { createHeaderButtons } from "./client/header-button.ts";
import { messages } from "./client/i18n/messages.ts";
import { openExplorerOrTab, requestOpen, setPanelOpener } from "./client/intent.ts";
import { workspacesRpc } from "./shared/rpc.ts";
import { BeadsExplorer } from "./client/explorer.tsx";
import { BeadsPanel } from "./client/panel.tsx";
import { SettingsScreen } from "./client/settings.tsx";
import { beadsSettings } from "./shared/settings.ts";

export default function contribute(client: PluginClientContext) {
  const openSettings = () => client.openSettings(beadsSettings.id);
  // One component for the life of the contribution: the panel's links to the
  // settings page ride on it.
  const Panel = (props: PluginWorkspacePanelProps) => <BeadsPanel {...props} openSettings={openSettings} />;
  const Explorer = (props: PluginWorkspacePanelProps) => <BeadsExplorer {...props} openSettings={openSettings} />;
  const cleanups = [
    // Anything in the plugin that opens the tab (client/intent.ts) goes through the host's openPanel.
    setPanelOpener((workspaceId) => client.openPanel("beads", { workspaceId })),
    client.addWorkspacePanel({
      id: "beads",
      title: messages.message("panelTitle"),
      icon: { svg: icon },
      // A tab in the workspace only: the explorer gets its own compact panel,
      // and openPanel("beads") then never lands on a copy in the explorer.
      locations: ["workspace"],
      Component: Panel,
    }),
    // The explorer's own compact view: the reader's issues in progress and
    // ready, counts, a search; a pick opens it in the tab above.
    client.addWorkspacePanel({
      id: "beads-explorer",
      title: messages.message("panelTitle"),
      icon: { svg: icon },
      locations: ["explorer"],
      Component: Explorer,
    }),
    client.addSettingsScreen({
      id: beadsSettings.id,
      title: messages.message("settingsTitle"),
      icon: { svg: icon },
      Component: SettingsScreen,
    }),
    client.addCommandCenterItem({
      id: "open-beads",
      title: messages.message("openPanel"),
      icon: { svg: icon },
      keywords: ["beads", "bd", "issues", "tasks"],
      context: "workspace",
      // Through the intent bus too, so an older intent left unclaimed cannot ride on this open.
      onSelect: (ctx) => requestOpen(ctx.workspace.id, {}, () => ctx.openPanel("beads")),
    }),
    client.addCommandCenterItem({
      id: "open-beads-board",
      title: messages.message("openBoard"),
      icon: { svg: icon },
      keywords: ["beads", "bd", "board", "kanban", "доска", "канбан"],
      context: "workspace",
      onSelect: (ctx) => requestOpen(ctx.workspace.id, { view: "board" }, () => ctx.openPanel("beads")),
    }),
    client.addCommandCenterItem({
      id: "open-beads-explorer",
      title: messages.message("openExplorer"),
      icon: { svg: icon },
      keywords: ["beads", "bd", "explorer", "sidebar", "mine", "боковая", "мои"],
      context: "workspace",
      // The compact (phone) layout has no explorer and the host throws: the tab instead.
      onSelect: (ctx) =>
        openExplorerOrTab(ctx.workspace.id, () => ctx.openPanel("beads-explorer", { location: "explorer" }), () => ctx.openPanel("beads")),
    }),
    headerButtons(client),
  ];
  return () => cleanups.forEach((c) => c());
}

/** Paseo's compact layout (no explorer): a window under 600 px wide (its `xs`/`sm` breakpoints). */
const COMPACT_BELOW_PX = 600;
const isCompact = (width: number) => width < COMPACT_BELOW_PX;

/**
 * A Beads button in the header of each workspace that has a beads project
 * (client/header-button.ts), a menu: the tab, the board, the explorer. On a
 * phone-sized window it is the quick way in — the Command Center does not
 * open there — and the explorer item is hidden (there is no explorer).
 */
function headerButtons(client: PluginClientContext): () => void {
  const menu = (workspaceId: string, compact: boolean): PluginButtonBehavior<PluginText> => ({
    kind: "menu",
    items: [
      {
        kind: "item",
        id: "open",
        title: messages.message("openPanel"),
        icon: { svg: icon },
        behavior: { kind: "action", onPress: () => requestOpen(workspaceId, {}) },
      },
      {
        kind: "item",
        id: "board",
        title: messages.message("openBoard"),
        icon: "SquareKanban",
        behavior: { kind: "action", onPress: () => requestOpen(workspaceId, { view: "board" }) },
      },
      {
        kind: "item",
        id: "explorer",
        title: messages.message("openExplorer"),
        icon: "PanelRight",
        visible: !compact,
        behavior: {
          kind: "action",
          onPress: () => openExplorerOrTab(workspaceId, () => client.openPanel("beads-explorer", { workspaceId, location: "explorer" })),
        },
      },
    ],
  });
  let compact = isCompact(Dimensions.get("window").width);
  const set = createHeaderButtons({
    add: (workspaceId) =>
      client.addHeaderButton({
        id: "beads",
        workspaceId,
        button: { title: messages.message("panelTitle"), icon: { svg: icon }, behavior: menu(workspaceId, compact) },
      }),
    list: async () => {
      const res = await client.rpc(workspacesRpc, {});
      return res.ok ? res.workspaceIds : null;
    },
    // A nudge only: the periodic read catches what this misses.
    watch: (changed) => client.paseo.workspaces.subscribe(changed),
    report: (message) => console.warn(`[beads] ${message}`),
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    background: () => AppState.currentState === "background",
    onForeground: (fn) => {
      const sub = AppState.addEventListener("change", (s) => {
        if (s === "active") fn();
      });
      return () => sub.remove();
    },
  });
  // Crossing the compact width shows or hides the explorer item (a new menu per workspace).
  const resized = Dimensions.addEventListener("change", ({ window }) => {
    const now = isCompact(window.width);
    if (now === compact) return;
    compact = now;
    set.updateAll((workspaceId) => ({ behavior: menu(workspaceId, compact) }));
  });
  return () => {
    resized.remove();
    set.stop();
  };
}
