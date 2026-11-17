/**
 * Calling the plugin's RPC handlers the way the daemon does — without one.
 *
 * `call` parses the input with the contract, runs the handler with a fake
 * context whose `paseo.workspaces.ref(id).refresh()` answers from a map, and
 * parses the output with the contract too: an output that does not match its
 * schema fails the test exactly as it would fail the RPC in the daemon.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PluginRpcContract, RpcInput, RpcOutput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { z } from "zod";
import { resetForTests } from "../../server/lifecycle.ts";
import { settleExports } from "../../server/beads/export.ts";

export type Workspaces = Record<string, string>;

export function fakeCtx(workspaces: Workspaces): PluginHandlerContext {
  const paseo = {
    workspaces: {
      ref: (id: string) => ({
        refresh: async () => (id in workspaces ? { id, workspaceDirectory: workspaces[id] } : null),
      }),
    },
  };
  return { paseo } as unknown as PluginHandlerContext;
}

export async function call<C extends PluginRpcContract>(
  contract: C,
  handler: (input: RpcInput<C>, ctx: PluginHandlerContext) => Promise<RpcOutput<C>>,
  input: z.input<C["input"]>,
  ctx: PluginHandlerContext,
): Promise<any> {
  const parsed = await contract.input.parseAsync(input);
  const out = await handler(parsed as RpcInput<C>, ctx);
  return contract.output.parseAsync(out);
}

export function tmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Point PATH at a stub `bd` (or back) and start from a fresh plugin state. */
export function usePath(prefixDir: string | null, original: string): void {
  process.env.PATH = prefixDir ? `${prefixDir}:${original}` : original;
  resetForTests();
}

export interface Stub {
  dir: string;
  calls(): string[];
  count(sub: string): number;
  config(cfg: StubConfig): void;
  setIssues(issues: any[]): void;
  issues(): any[];
  setComments(comments: Record<string, any[]>): void;
  remove(): void;
}

export interface StubConfig {
  /** Every call fails like a project with no database. */
  noDb?: boolean;
  /** `bd list` fails like a locked database. */
  failList?: boolean;
  listSleepMs?: number;
  exportSleepMs?: number;
}

/**
 * A recording `bd`. Every argv lands in calls.log; list/comments answer from
 * issues.json / comments.json; create/update/close/reopen/comment mutate them
 * the way a real database would remember a write (a stub that always hands
 * back the same fixture would make write checks vacuous); export writes the
 * issues to -o. config.json is re-read on every call, so tests flip it live.
 *
 * Plain CommonJS: an extension-less script has no package.json to declare a
 * module type. The log path is baked in because the plugin hands bd a
 * scrubbed env (PATH, HOME, NO_COLOR).
 */
export function makeStub(initial: any[] = [], comments: Record<string, any[]> = {}): Stub {
  const dir = tmpDir("pbd-stub-");
  const j = (f: string) => JSON.stringify(path.join(dir, f));
  fs.writeFileSync(path.join(dir, "calls.log"), "");
  fs.writeFileSync(path.join(dir, "issues.json"), JSON.stringify(initial));
  fs.writeFileSync(path.join(dir, "comments.json"), JSON.stringify(comments));
  fs.writeFileSync(path.join(dir, "config.json"), "{}");
  fs.writeFileSync(
    path.join(dir, "bd"),
    `#!/usr/bin/env node
const fs = require('node:fs');
function sleepMs(ms) { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); }
const read = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const args = process.argv.slice(2);
fs.appendFileSync(${j("calls.log")}, args.join(' ') + '\\n');
const cfg = read(${j("config.json")}, {});
const issues = read(${j("issues.json")}, []);
const save = () => fs.writeFileSync(${j("issues.json")}, JSON.stringify(issues));
const valueOf = (flag) => { const i = args.indexOf(flag); return i === -1 ? undefined : args[i + 1]; };
const allValuesOf = (flag) => { const out = []; for (let i = 0; i < args.length; i++) if (args[i] === flag) out.push(args[i + 1]); return out; };
const SUBS = new Set(['list', 'comments', 'create', 'update', 'close', 'reopen', 'export', 'import', 'comment']);
const sub = args.find((a) => SUBS.has(a));
const at = args.indexOf(sub);
const fail = (msg) => { process.stderr.write(msg + '\\n'); process.exit(1); };
if (cfg.noDb || !sub) fail('Error: no beads database found');
if (sub === 'list') {
  sleepMs(cfg.listSleepMs || 0);
  if (cfg.failList) fail('Error: database is locked by another process');
  process.stdout.write(JSON.stringify(issues));
  process.exit(0);
}
if (sub === 'comments') {
  process.stdout.write(JSON.stringify(read(${j("comments.json")}, {})[args[at + 1]] || []));
  process.exit(0);
}
if (sub === 'import') {
  process.stdout.write(JSON.stringify({ created: 0, ids: [], skipped: 0, source: valueOf('-i') }));
  process.exit(0);
}
if (sub === 'export') {
  sleepMs(cfg.exportSleepMs || 0);
  const o = valueOf('-o');
  if (o) fs.writeFileSync(o, issues.map((i) => JSON.stringify(i)).join('\\n') + '\\n');
  process.exit(0);
}
if (sub === 'create') {
  // bd prints one object here, not an array.
  const made = { id: 'stub-' + (issues.length + 1), title: args[at + 1], status: 'open',
    issue_type: valueOf('-t') || 'task',
    priority: valueOf('-p') !== undefined ? Number(valueOf('-p')) : 2,
    assignee: valueOf('-a') || '', parent: valueOf('--parent') || null,
    labels: allValuesOf('-l'), description: valueOf('-d') || null, comment_count: 0 };
  issues.push(made); save();
  process.stdout.write(JSON.stringify(made));
  process.exit(0);
}
const s = issues.find((i) => i.id === args[at + 1]);
if (!s) fail('Error: no issue ' + args[at + 1]);
if (sub === 'comment') {
  const all = read(${j("comments.json")}, {});
  const list = all[s.id] || (all[s.id] = []);
  list.push({ id: 'c' + (list.length + 1), author: valueOf('--actor'), text: args[at + 2], created_at: '2026-08-06T10:00:00Z' });
  fs.writeFileSync(${j("comments.json")}, JSON.stringify(all));
  s.comment_count = list.length; save();
  process.stdout.write(JSON.stringify({ ok: true }));
  process.exit(0);
}
if (sub === 'update') {
  const map = { '--title': 'title', '-t': 'issue_type', '-s': 'status', '-a': 'assignee', '--external-ref': 'external_ref',
    '-d': 'description', '--design': 'design', '--acceptance': 'acceptance_criteria', '--notes': 'notes' };
  for (const [flag, key] of Object.entries(map)) if (valueOf(flag) !== undefined) s[key] = valueOf(flag);
  if (valueOf('-p') !== undefined) s.priority = Number(valueOf('-p'));
  if (valueOf('--parent') !== undefined) s.parent = valueOf('--parent') || null;
  s.labels = s.labels || [];
  for (const l of allValuesOf('--add-label')) if (!s.labels.includes(l)) s.labels.push(l);
  for (const l of allValuesOf('--remove-label')) s.labels = s.labels.filter((x) => x !== l);
} else if (sub === 'close') {
  s.status = 'closed'; s.close_reason = valueOf('-r') || ''; s.closed_at = '2026-08-06T11:00:00Z';
} else if (sub === 'reopen') {
  s.status = 'open'; s.close_reason = null; s.closed_at = null;
}
save();
process.stdout.write(JSON.stringify([s]));
process.exit(0);
`,
  );
  fs.chmodSync(path.join(dir, "bd"), 0o755);

  const calls = () => fs.readFileSync(path.join(dir, "calls.log"), "utf8").split("\n").filter((l) => l.trim());
  return {
    dir,
    calls,
    count: (sub) => calls().filter((c) => c.split(/\s+/).includes(sub)).length,
    config: (cfg) => fs.writeFileSync(path.join(dir, "config.json"), JSON.stringify(cfg)),
    setIssues: (issues) => fs.writeFileSync(path.join(dir, "issues.json"), JSON.stringify(issues)),
    issues: () => JSON.parse(fs.readFileSync(path.join(dir, "issues.json"), "utf8")),
    setComments: (c) => fs.writeFileSync(path.join(dir, "comments.json"), JSON.stringify(c)),
    remove: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

/** A directory that is a beads project as far as resolveProject is concerned. */
export function makeProject(files: Record<string, string> = { "config.yaml": "prefix: stub\n" }): string {
  const dir = tmpDir("pbd-proj-");
  fs.mkdirSync(path.join(dir, ".beads"));
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(dir, ".beads", name), body);
  return dir;
}

/** Everything the plugin logs while a test file runs. */
export function captureLogs(): { lines: string[]; restore(): void } {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return { lines, restore: () => { console.error = original; } };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Wait until the background export is neither running nor pending. */
export async function exportsIdle(): Promise<void> {
  await settleExports();
}
