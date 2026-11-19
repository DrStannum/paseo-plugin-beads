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

/** Pages of the daemon's workspace list read at most (200 each). */
const MAX_PAGES = 50;

/**
 * Every workspace the daemon has open, background ones included (a workspace
 * opened by id still has a header), as id → directory. Archived workspaces
 * are not listed by the daemon.
 */
export async function listWorkspaceDirectories(ctx: PluginHandlerContext): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await ctx.paseo.workspaces.list({ includeBackground: true, page: { limit: 200, ...(cursor ? { cursor } : {}) } });
    for (const w of res.entries) if (w.workspaceDirectory) out.set(w.id, w.workspaceDirectory);
    if (!res.pageInfo.hasMore || !res.pageInfo.nextCursor) break;
    cursor = res.pageInfo.nextCursor;
  }
  return out;
}
