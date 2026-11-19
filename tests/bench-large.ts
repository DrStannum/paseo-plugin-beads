/**
 * How the read path holds up on a large project — the numbers behind the
 * bd timeouts in server/beads/run.ts and the handler budget in
 * server/handlers.ts. On a LARGE SYNTHETIC fixture (tests/fixture/build.mjs,
 * `many` + `rich`: epics, children, every status, kilobytes of text per
 * issue), never on a real project.
 *
 *   npm run bench                         # 4000 issues, built and removed
 *   npm run bench -- --n 2000             # another size
 *   npm run bench -- --keep               # leave the fixture for another run
 *   npm run bench -- --dir <fixture dir>  # reuse one left by --keep
 *
 * Measures bd itself (list / comments, alone and four at once, the way
 * several open panels or a running export load the VM) and then the
 * handlers, in-process with a fake daemon context: a cold tree, an
 * unchanged tree, a card, three cold trees at once, the revision poll, and
 * a restart answered from the disk cache (a temporary CBD_CACHE_DIR, see
 * tests/support/harness.ts) — same revision, and moved (the stand-in).
 * Prints a table; it asserts only that every read answers inside the
 * daemon's 30 s and that none times out — the rest is for reading.
 * Building the 4000-issue fixture takes bd about 2.5 min.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { issueRpc, revisionRpc, treeRpc } from "../shared/rpc.ts";
import { issue, revision, tree } from "../server/handlers.ts";
import { BD_LIST_TIMEOUT_MS, BD_TIMEOUT_MS } from "../server/beads/run.ts";
import { clearCache } from "../server/beads/snapshot.ts";
import { cacheFileFor, flushPendingSaves } from "../server/beads/disk.ts";
import { shutdown } from "../server/lifecycle.ts";
import { call, fakeCtx, wipeDiskCache } from "./support/harness.ts";
// @ts-ignore -- plain JS fixture builder
import { buildFixture } from "./fixture/build.mjs";

const argv = process.argv.slice(2);
const opt = (name: string) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const N = Number(opt("--n") ?? 4000);
const DAEMON_RPC_MS = 30000;

const env = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", BD_NON_INTERACTIVE: "1" };

function bdMs(dir: string, args: string[]): Promise<{ ms: number; bytes: number; ok: boolean }> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let bytes = 0;
    const child = spawn("bd", ["--readonly", "--json", "-C", dir, ...args], { cwd: dir, env, stdio: ["ignore", "pipe", "ignore"] });
    child.stdout.on("data", (b: Buffer) => { bytes += b.length; });
    child.on("close", (code) => resolve({ ms: Date.now() - t0, bytes, ok: code === 0 }));
  });
}

const rows: Array<[string, string]> = [];
const note = (what: string, value: string) => {
  rows.push([what, value]);
  console.error(`  ${what}: ${value}`);
};
const timed = async <T>(fn: () => Promise<T>): Promise<[number, T]> => {
  const t0 = Date.now();
  const v = await fn();
  return [Date.now() - t0, v];
};

const t0 = Date.now();
let dir = opt("--dir");
let cleanup = () => {};
if (!dir) {
  console.error(`building a ${N}-issue rich fixture…`);
  const fx = buildFixture({ mode: "bd", many: N, rich: true, tag: "bench" });
  dir = fx.dir as string;
  if (!argv.includes("--keep")) cleanup = fx.cleanup;
  note("fixture build", `${((Date.now() - t0) / 1000).toFixed(0)} s, ${fx.rows.length} issues`);
}
const KEY = "demo-x0005";

try {
  // ── bd alone ──
  const lists = [];
  for (let i = 0; i < 3; i++) lists.push(await bdMs(dir, ["list", "--all", "-n", "0", "--no-pager"]));
  note("bd list, alone (3 runs)", `${lists.map((r) => r.ms).join(" / ")} ms, ${(lists[0]!.bytes / 1e6).toFixed(1)} MB`);
  const cm = await bdMs(dir, ["comments", KEY]);
  note("bd comments, alone", `${cm.ms} ms`);
  const par = await Promise.all([0, 1, 2, 3].map(() => bdMs(dir!, ["list", "--all", "-n", "0", "--no-pager"])));
  note("bd list, four at once", `${par.map((r) => r.ms).join(" / ")} ms`);

  // ── the handlers ──
  const ctx = fakeCtx({ ws: dir });
  const ws = { workspaceId: "ws" };
  clearCache();
  const [coldMs, cold] = await timed(() => call(treeRpc, tree, ws, ctx));
  assert.equal(cold.ok, true, `cold tree: ${JSON.stringify(cold).slice(0, 200)}`);
  note("beads.tree, cold", `${coldMs} ms, ${cold.issues.length} rows, ${(JSON.stringify(cold).length / 1e6).toFixed(1)} MB answer`);
  const [haveMs, have] = await timed(() => call(treeRpc, tree, { ...ws, have: cold.revision }, ctx));
  assert.equal(have.unchanged, true);
  note("beads.tree, have=current", `${haveMs} ms`);
  const [cardMs, card] = await timed(() => call(issueRpc, issue, { ...ws, id: KEY }, ctx));
  assert.equal(card.ok, true);
  note("beads.issue, comments not cached", `${cardMs} ms`);
  const [card2Ms] = await timed(() => call(issueRpc, issue, { ...ws, id: KEY }, ctx));
  note("beads.issue, again", `${card2Ms} ms`);

  // A restart: memory gone, the disk cache kept.
  flushPendingSaves(); // long written by now: it runs on the turn after the cold tree's reply
  const file = cacheFileFor(fs.realpathSync(path.join(dir, ".beads")));
  note("disk cache file", `${(fs.statSync(file).size / 1e6).toFixed(1)} MB`);
  clearCache();
  const [diskMs, disk] = await timed(() => call(treeRpc, tree, ws, ctx));
  assert.equal(disk.ok, true);
  assert.equal(disk.revision, cold.revision);
  note("beads.tree, restart, from disk", `${diskMs} ms, no bd`);

  // Three panels (or a web tab and a phone) opening the project at once: one load serves all.
  clearCache();
  wipeDiskCache();
  const [threeMs, three] = await timed(() => Promise.all([0, 1, 2].map(() => call(treeRpc, tree, ws, ctx))));
  assert.ok(three.every((r: any) => r.ok));
  note("beads.tree, three cold at once", `${threeMs} ms for all three`);
  const [revMs, rev] = await timed(() => call(revisionRpc, revision, ws, ctx));
  assert.equal(rev.ok, true);
  note("beads.revision (the poll)", `${revMs} ms, runs no bd`);

  assert.ok(diskMs < 1000, `the tree from disk took ${diskMs} ms: the aim is under 1 s`);
  for (const [what, ms] of [["cold tree", coldMs], ["card", cardMs]] as const) {
    assert.ok(ms < DAEMON_RPC_MS, `${what} took ${ms} ms: over the daemon's ${DAEMON_RPC_MS} ms`);
  }
  note("limits", `bd list ${BD_LIST_TIMEOUT_MS} ms, other reads ${BD_TIMEOUT_MS} ms, daemon RPC ${DAEMON_RPC_MS} ms`);
} finally {
  await shutdown();
  cleanup();
}

console.log(`\nbench on ${dir} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
for (const [what, value] of rows) console.log(`  ${what.padEnd(36)} ${value}`);
