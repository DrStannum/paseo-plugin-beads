import type { PluginClientContext } from "@getpaseo/plugin/client";
import icon from "./client/icon.svg";
import { BeadsPanel } from "./client/panel.tsx";

export default function contribute(client: PluginClientContext) {
  const cleanups = [
    client.addWorkspacePanel({
      id: "beads",
      title: "Beads",
      icon: { svg: icon },
      locations: ["workspace", "explorer"],
      Component: BeadsPanel,
    }),
    client.addCommandCenterItem({
      id: "open-beads",
      title: "Open Beads",
      icon: { svg: icon },
      keywords: ["beads", "bd", "issues", "tasks"],
      context: "workspace",
      onSelect: (ctx) => ctx.openPanel("beads"),
    }),
  ];
  return () => cleanups.forEach((c) => c());
}
