import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Every call names the workspace; the server resolves its directory itself. */
export const WorkspaceInput = z.object({ workspaceId: z.string().min(1) });

export const pingRpc = defineRpc({
  name: "beads.ping",
  input: WorkspaceInput,
  output: z.union([
    z.object({ ok: z.literal(true), directory: z.string(), bd: z.string().nullable() }),
    z.object({ ok: z.literal(false), code: z.string() }),
  ]),
});
