import type { PluginServerContext } from "@getpaseo/plugin/server";
import { pingRpc } from "./shared/rpc.ts";
import { workspaceDirectory } from "./server/workspaces.ts";

export default function contribute(server: PluginServerContext) {
  server.handle(pingRpc, async ({ workspaceId }, ctx) => {
    const directory = await workspaceDirectory(ctx, workspaceId);
    if (!directory) return { ok: false as const, code: "unknown-workspace" };
    return { ok: true as const, directory, bd: null };
  });
  return () => {};
}
