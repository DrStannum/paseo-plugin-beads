import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import icon from "./client/icon.svg";
import { messages } from "./client/i18n/messages.ts";
import { requestOpen, setPanelOpener } from "./client/intent.ts";
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
      onSelect: (ctx) => {
        try {
          ctx.openPanel("beads-explorer", { location: "explorer" });
        } catch {
          requestOpen(ctx.workspace.id, {}, () => ctx.openPanel("beads"));
        }
      },
    }),
  ];
  return () => cleanups.forEach((c) => c());
}
