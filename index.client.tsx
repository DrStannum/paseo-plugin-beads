import type { PluginClientContext, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import icon from "./client/icon.svg";
import { messages } from "./client/i18n/messages.ts";
import { BeadsPanel } from "./client/panel.tsx";
import { SettingsScreen } from "./client/settings.tsx";
import { beadsSettings } from "./shared/settings.ts";

export default function contribute(client: PluginClientContext) {
  const openSettings = () => client.openSettings(beadsSettings.id);
  // One component for the life of the contribution: the panel's links to the
  // settings page ride on it.
  const Panel = (props: PluginWorkspacePanelProps) => <BeadsPanel {...props} openSettings={openSettings} />;
  const cleanups = [
    client.addWorkspacePanel({
      id: "beads",
      title: messages.message("panelTitle"),
      icon: { svg: icon },
      locations: ["workspace", "explorer"],
      Component: Panel,
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
      onSelect: (ctx) => ctx.openPanel("beads"),
    }),
  ];
  return () => cleanups.forEach((c) => c());
}
