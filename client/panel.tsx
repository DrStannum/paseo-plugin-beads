import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useRpc, useWorkspace } from "@getpaseo/plugin/client";
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { pingRpc } from "../shared/rpc.ts";

export function BeadsPanel({ theme, host, workspaceId }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (w) => w.directory);
  const ping = useRpc(pingRpc);
  const q = useQuery({
    queryKey: ["beads", host.id, workspaceId, "ping"],
    queryFn: () => ping({ workspaceId }),
  });
  const text = { color: theme.colors.foreground };
  return (
    <View style={{ flex: 1, padding: 16, gap: 8, backgroundColor: theme.colors.surface0 }}>
      <Text style={text}>Beads</Text>
      <Text style={{ color: theme.colors.foregroundMuted }}>{directory ?? "…"}</Text>
      <Text style={text}>{q.data ? JSON.stringify(q.data) : q.error ? String(q.error) : "…"}</Text>
    </View>
  );
}
