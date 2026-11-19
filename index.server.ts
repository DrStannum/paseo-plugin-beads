import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  commentRpc, createRpc, editRpc, exportRpc, healthRpc, issueRpc, jobStatusRpc,
  pingRpc, revisionRpc, searchRpc, syncRpc, treeRpc, workspacesRpc,
} from "./shared/rpc.ts";
import {
  comment, create, edit, exportNow, health, issue, jobStatus, ping, revision, search, sync, tree, workspaceArchived, workspaces,
} from "./server/handlers.ts";
import { shutdown, startup } from "./server/lifecycle.ts";
import { beadsSettings } from "./shared/settings.ts";

export default function contribute(server: PluginServerContext) {
  server.handle(pingRpc, ping);
  server.handle(healthRpc, health);
  server.handle(revisionRpc, revision);
  server.handle(treeRpc, tree);
  server.handle(issueRpc, issue);
  server.handle(searchRpc, search);
  server.handle(editRpc, edit);
  server.handle(createRpc, create);
  server.handle(commentRpc, comment);
  server.handle(exportRpc, exportNow);
  server.handle(syncRpc, sync);
  server.handle(jobStatusRpc, jobStatus);
  // Where the workspace header gets a Beads button.
  server.handle(workspacesRpc, workspaces);
  // The reader's name and the refresh interval; the client reads them with useSettings.
  server.registerSettings(beadsSettings);
  // The archived workspace's project leaves the disk cache with it.
  server.addHook("workspace.archive.after", async ({ workspace }) => {
    workspaceArchived(workspace);
  });
  // Nothing here may wait: the daemon starts plugins one by one. The disk
  // cache is tidied after start, and a project's snapshot is read on its first RPC.
  startup();
  return shutdown;
}
