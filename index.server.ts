import type { PluginServerContext } from "@getpaseo/plugin/server";
import {
  commentRpc, createRpc, editRpc, exportRpc, healthRpc, issueRpc, jobStatusRpc,
  pingRpc, revisionRpc, searchRpc, syncRpc, treeRpc,
} from "./shared/rpc.ts";
import {
  comment, create, edit, exportNow, health, issue, jobStatus, ping, revision, search, sync, tree,
} from "./server/handlers.ts";
import { shutdown } from "./server/lifecycle.ts";
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
  // The reader's name and the refresh interval; the client reads them with useSettings.
  server.registerSettings(beadsSettings);
  return shutdown;
}
