import type { PluginHandlerContext } from "@getpaseo/plugin/server";

/**
 * The directory of a workspace that Paseo actually has open. A client-supplied
 * path is never trusted: the id is looked up by the daemon itself, and an
 * archived workspace counts as gone.
 */
export async function workspaceDirectory(ctx: PluginHandlerContext, workspaceId: string): Promise<string | null> {
  try {
    const ws = await ctx.paseo.workspaces.ref(workspaceId).refresh();
    if (!ws) return null;
    return ws.workspaceDirectory || null;
  } catch {
    return null;
  }
}
