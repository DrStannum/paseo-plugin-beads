/**
 * The disk cache wired into the read path (server/beads/snapshot.ts): what a
 * restarted plugin answers from the file, when it still runs bd, that writes
 * never plan against an older copy, the workspace.archived hook, and that
 * contribute() schedules the sweep without waiting for it.
 *
 * A restart is simulated by clearCache(): the memory goes, the disk cache
 * (a temporary CBD_CACHE_DIR, tests/support/harness.ts) stays.
 */

import { after, afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { editRpc, healthRpc, issueRpc, revisionRpc, searchRpc, treeRpc } from "../shared/rpc.ts";
import { edit, health, issue, revision, search, tree, workspaceArchived } from "../server/handlers.ts";
import { clearCache } from "../server/beads/snapshot.ts";
import { cacheFileFor, flushPendingSaves } from "../server/beads/disk.ts";
import { resetForTests, shutdown } from "../server/lifecycle.ts";
import { liveTimers } from "../server/beads/timers.ts";
import contribute from "../index.server.ts";
import {
  CACHE_DIR, call, captureLogs, fakeCtx, makeProject, makeStub, sleep, usePath, type Stub,
} from "./support/harness.ts";

const ORIGINAL_PATH = process.env.PATH || "";
const logs = captureLogs();
after(() => {
  logs.restore();
  usePath(null, ORIGINAL_PATH);
});

/** Text that must never reach a log line. */
const SECRETS = ["Secret disk title", "disk-needle-description", "Renamed elsewhere", "Made elsewhere"];

const DATA = [
  { id: "dk-1", title: "Secret disk title", status: "open", priority: 1, issue_type: "epic",
    description: "disk-needle-description", created_at: "2026-01-01T00:00:00Z" },
  { id: "dk-1.1", title: "Child", status: "open", priority: 2, issue_type: "task", parent: "dk-1",
    dependencies: [{ issue_id: "dk-1.1", depends_on_id: "dk-2", type: "blocks" }] },
  { id: "dk-2", title: "Blocker", status: "in_progress", priority: 2, issue_type: "task" },
];

let stub: Stub;
let project: string;
let ctx: ReturnType<typeof fakeCtx>;
let bump = 0;
const ws = { workspaceId: "ws" };
const beadsDir = () => fs.realpathSync(path.join(project, ".beads"));
const cacheFile = () => cacheFileFor(beadsDir());

/** Move the revision the way a write elsewhere would: issues.jsonl changes size. */
function moveRevision() {
  bump++;
  fs.writeFileSync(path.join(project, ".beads", "issues.jsonl"), `${"x".repeat(bump)}\n`);
}

/** One cold load, saved to disk, then the "restart": memory gone, file kept. */
async function loadSaveRestart(): Promise<any> {
  const first = await call(treeRpc, tree, ws, ctx);
  assert.equal(first.ok, true, JSON.stringify(first).slice(0, 200));
  flushPendingSaves();
  assert.ok(fs.existsSync(cacheFile()), "the good load was not saved");
  clearCache();
  return first;
}

beforeEach(() => {
  stub = makeStub(DATA);
  project = makeProject();
  ctx = fakeCtx({ ws: project, twin: project });
  usePath(stub.dir, ORIGINAL_PATH);
});
afterEach(() => {
  resetForTests();
  stub.remove();
  fs.rmSync(project, { recursive: true, force: true });
});

describe("answering from the disk cache after a restart", () => {
  it("a good load is saved after the reply's turn, private, and not before", async () => {
    const res = await call(treeRpc, tree, ws, ctx);
    assert.equal(res.ok, true);
    // scheduleSave: nothing on disk until the event loop turns.
    assert.equal(fs.existsSync(cacheFile()), false);
    await new Promise((r) => setImmediate(r));
    assert.ok(fs.existsSync(cacheFile()));
    assert.equal(fs.statSync(cacheFile()).mode & 0o777, 0o600);
    assert.equal(fs.statSync(CACHE_DIR).mode & 0o777, 0o700);
  });

  it("same revision: the tree comes from the file, bd is not run at all", async () => {
    const first = await loadSaveRestart();
    assert.equal(stub.count("list"), 1);
    const t0 = Date.now();
    const again = await call(treeRpc, tree, ws, ctx);
    const ms = Date.now() - t0;
    assert.equal(again.ok, true);
    assert.equal(again.unchanged, false);
    assert.equal(again.revision, first.revision);
    assert.deepEqual(again.issues, first.issues, "rows from disk must match rows from bd");
    assert.deepEqual(again.counts, first.counts);
    assert.ok(!("stale" in again));
    assert.ok(ms < 500, `answered from disk in ${ms} ms`);
    // The card and the search answer from it too.
    const card = await call(issueRpc, issue, { ...ws, id: "dk-1.1" }, ctx);
    assert.equal(card.ok, true);
    assert.deepEqual(card.issue.relations.blockedBy.map((r: any) => r.id), ["dk-2"]);
    const hits = await call(searchRpc, search, { ...ws, q: "needle" }, ctx);
    assert.deepEqual(hits.ids, ["dk-1"]);
    assert.equal(stub.count("list"), 1, "a matching disk copy needs no bd list");
  });

  it("a client already holding that revision is told unchanged", async () => {
    const first = await loadSaveRestart();
    const res = await call(treeRpc, tree, { ...ws, have: first.revision }, ctx);
    assert.equal(res.unchanged, true);
    assert.equal(stub.count("list"), 1);
  });

  it("moved revision: the old copy answers at once, one bd list runs behind it, the next tree is fresh", async () => {
    const first = await loadSaveRestart();
    stub.setIssues(DATA.map((i) => (i.id === "dk-2" ? { ...i, title: "Renamed elsewhere" } : i)));
    moveRevision();
    stub.config({ listSleepMs: 600 });

    const t0 = Date.now();
    const quick = await call(treeRpc, tree, ws, ctx);
    const ms = Date.now() - t0;
    assert.equal(quick.ok, true);
    assert.ok(ms < 400, `the stand-in took ${ms} ms`);
    assert.equal(quick.revision, first.revision, "the stand-in carries its own (older) revision");
    assert.equal(quick.issues.find((i: any) => i.id === "dk-2").title, "Blocker");
    assert.ok(!("stale" in quick), "an old copy while bd is loading is not a failure");

    // Other reads during the load: the same copy, no second bd.
    const h = await call(healthRpc, health, ws, ctx);
    assert.equal(h.revision, first.revision);
    const again = await call(treeRpc, tree, ws, ctx);
    assert.equal(again.revision, first.revision);

    // The poll sees the revision move; the client asks again with what it has.
    const rev = await call(revisionRpc, revision, ws, ctx);
    assert.notEqual(rev.revision, first.revision);
    const fresh = await call(treeRpc, tree, { ...ws, have: first.revision }, ctx);
    assert.equal(fresh.ok, true);
    assert.equal(fresh.unchanged, false);
    assert.equal(fresh.revision, rev.revision);
    assert.equal(fresh.issues.find((i: any) => i.id === "dk-2").title, "Renamed elsewhere");
    assert.equal(stub.count("list"), 2, "exactly one background bd list after the restart");

    // …and that load replaced the file.
    flushPendingSaves();
    clearCache();
    const third = await call(treeRpc, tree, { ...ws, have: rev.revision }, ctx);
    assert.equal(third.unchanged, true);
    assert.equal(stub.count("list"), 2);
  });

  it("the background load failing: the old copy stays, now marked stale", async () => {
    const first = await loadSaveRestart();
    moveRevision();
    stub.config({ failList: true });
    const quick = await call(treeRpc, tree, ws, ctx);
    assert.equal(quick.revision, first.revision);
    const later = await call(treeRpc, tree, { ...ws, have: first.revision }, ctx);
    assert.equal(later.ok, true);
    assert.equal(later.unchanged, false);
    assert.equal(later.stale?.code, "bd_failed");
    assert.equal(later.issues.length, DATA.length);
  });

  it("no file: an ordinary cold load", async () => {
    await loadSaveRestart();
    fs.rmSync(cacheFile());
    const res = await call(treeRpc, tree, ws, ctx);
    assert.equal(res.ok, true);
    assert.equal(stub.count("list"), 2);
  });

  it("a broken file: dropped, a cold load, then saved again whole", async () => {
    await loadSaveRestart();
    fs.writeFileSync(cacheFile(), '{"format":1,"issues":[', { mode: 0o600 });
    const res = await call(treeRpc, tree, ws, ctx);
    assert.equal(res.ok, true);
    assert.equal(res.issues.length, DATA.length);
    assert.equal(stub.count("list"), 2);
    flushPendingSaves();
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(cacheFile(), "utf8")));
  });

  it("a load failure is never saved", async () => {
    stub.config({ failList: true });
    const res = await call(treeRpc, tree, ws, ctx);
    assert.equal(res.ok, false);
    flushPendingSaves();
    assert.equal(fs.existsSync(cacheFile()), false);
  });

  it("cleanup drops a save not yet written; the file keeps the previous good one", async () => {
    const first = await loadSaveRestart();
    const before = fs.readFileSync(cacheFile(), "utf8");
    moveRevision();
    const res = await call(treeRpc, tree, { ...ws, have: first.revision }, ctx);
    assert.notEqual(res.revision, first.revision);
    shutdown();
    await new Promise((r) => setImmediate(r));
    assert.equal(fs.readFileSync(cacheFile(), "utf8"), before);
  });
});

describe("writes never plan against an older disk copy", () => {
  it("an edit after a restart waits for bd: an issue made elsewhere is found", async () => {
    await loadSaveRestart();
    stub.setIssues([...DATA, { id: "dk-3", title: "Made elsewhere", status: "open", priority: 2, issue_type: "task" }]);
    moveRevision();
    stub.config({ listSleepMs: 300 });
    // A read first, so the background load is already running from the stand-in.
    const quick = await call(treeRpc, tree, ws, ctx);
    assert.equal(quick.issues.some((i: any) => i.id === "dk-3"), false);
    const res = await call(editRpc, edit, { ...ws, id: "dk-3", fields: { priority: 1 } }, ctx);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(res.issue.id, "dk-3");
    assert.equal(res.issue.priority, 1);
    assert.equal(stub.count("update"), 1);
    // The write joined the background load, then reloaded once after it.
    assert.equal(stub.count("list"), 3);
  });

  it("with no read before it, the edit still plans against bd's answer", async () => {
    await loadSaveRestart();
    stub.setIssues([...DATA, { id: "dk-3", title: "Made elsewhere", status: "open", priority: 2, issue_type: "task" }]);
    moveRevision();
    const res = await call(editRpc, edit, { ...ws, id: "dk-3", fields: { priority: 1 } }, ctx);
    assert.equal(res.ok, true, JSON.stringify(res));
    assert.equal(stub.count("update"), 1);
  });

  it("a disk copy of the current revision is fresh: the edit plans on it without a bd list", async () => {
    await loadSaveRestart();
    const res = await call(editRpc, edit, { ...ws, id: "dk-2", fields: { priority: 0 } }, ctx);
    assert.equal(res.ok, true);
    // One list before the restart, one reload after the write — none to plan.
    assert.equal(stub.count("list"), 2);
  });
});

describe("warming and tidying", () => {
  it("the first revision poll warms the project after replying, from disk", async () => {
    await loadSaveRestart();
    logs.lines.length = 0;
    const rev = await call(revisionRpc, revision, ws, ctx);
    assert.equal(rev.ok, true);
    assert.equal(logs.lines.some((l) => l.includes("read back")), false, "the poll must not wait for the read");
    await sleep(20);
    assert.equal(logs.lines.filter((l) => l.includes("read back")).length, 1);
    await call(revisionRpc, revision, ws, ctx);
    await sleep(20);
    assert.equal(logs.lines.filter((l) => l.includes("read back")).length, 1, "warmed once");
    assert.equal(stub.count("list"), 1);
  });

  it("the first revision poll with nothing on disk starts the one bd list the tree joins", async () => {
    stub.config({ listSleepMs: 300 });
    await call(revisionRpc, revision, ws, ctx);
    await sleep(100);
    assert.equal(stub.count("list"), 1);
    const res = await call(treeRpc, tree, ws, ctx);
    assert.equal(res.ok, true);
    assert.equal(stub.count("list"), 1);
  });

  it("workspace.archived drops the file and the memory", async () => {
    await call(treeRpc, tree, ws, ctx);
    flushPendingSaves();
    assert.ok(fs.existsSync(cacheFile()));
    workspaceArchived({ id: "ws", cwd: project });
    assert.equal(fs.existsSync(cacheFile()), false);
    const res = await call(treeRpc, tree, ws, ctx);
    assert.equal(res.ok, true);
    assert.equal(stub.count("list"), 2, "forgotten in memory too");
  });

  it("an archived workspace nobody asked about yet is found by its directory", async () => {
    await loadSaveRestart();
    resetForTests(); // this process has seen no workspace
    workspaceArchived({ id: "other", cwd: project });
    assert.equal(fs.existsSync(cacheFile()), false);
  });

  it("a load still running when the workspace is archived does not bring the file back", async () => {
    stub.config({ listSleepMs: 300 });
    const pending = call(treeRpc, tree, ws, ctx);
    await sleep(100);
    workspaceArchived({ id: "ws", cwd: project });
    await pending;
    flushPendingSaves();
    assert.equal(fs.existsSync(cacheFile()), false);
  });

  it("another workspace on the same .beads keeps the file", async () => {
    await call(treeRpc, tree, ws, ctx);
    await call(revisionRpc, revision, { workspaceId: "twin" }, ctx);
    flushPendingSaves();
    workspaceArchived({ id: "ws", cwd: project });
    assert.ok(fs.existsSync(cacheFile()));
    workspaceArchived({ id: "twin", cwd: project });
    assert.equal(fs.existsSync(cacheFile()), false);
  });

  it("contribute() returns at once, sweeps after it on a tracked timer, and shutdown clears that timer", async () => {
    const hooks: string[] = [];
    const server = {
      handle() {},
      registerSettings() { return {}; },
      addHook(name: string) { hooks.push(name); return () => {}; },
    } as unknown as PluginServerContext;
    const stray = path.join(CACHE_DIR, `${"0".repeat(24)}.json.1.ab.tmp`);
    const old = new Date(Date.now() - 10 * 60_000);

    fs.writeFileSync(stray, "x");
    fs.utimesSync(stray, old, old);
    const t0 = Date.now();
    const cleanup = contribute(server);
    assert.ok(Date.now() - t0 < 100, "contribute must not wait");
    assert.deepEqual(hooks, ["workspace.archive.after"]);
    assert.ok(fs.existsSync(stray), "the sweep must not run inside contribute");
    assert.equal(liveTimers(), 1);
    await sleep(20);
    assert.equal(fs.existsSync(stray), false, "the deferred sweep removes an abandoned temp file");
    assert.equal(liveTimers(), 0);

    resetForTests();
    fs.writeFileSync(stray, "x");
    fs.utimesSync(stray, old, old);
    const cleanup2 = contribute(server);
    assert.equal(cleanup2, cleanup);
    shutdown();
    assert.equal(liveTimers(), 0);
    await sleep(20);
    assert.ok(fs.existsSync(stray), "after cleanup the sweep never runs");
    fs.rmSync(stray);
  });
});

describe("deltas across a restart: the disk copy is a base", () => {
  const D = { ...ws, deltas: true };

  it("the client's revision is the disk copy's, the project moved: it waits for bd and gets a delta", async () => {
    const first = await loadSaveRestart();
    stub.setIssues(DATA.map((i) => (i.id === "dk-2" ? { ...i, title: "Renamed elsewhere" } : i)));
    moveRevision();
    const res = await call(treeRpc, tree, { ...D, have: first.revision }, ctx);
    assert.equal(res.delta, true, JSON.stringify(res).slice(0, 200));
    assert.equal(res.base, first.revision);
    assert.notEqual(res.revision, first.revision);
    assert.deepEqual(res.upsert.map((r: any) => [r.id, r.title]), [["dk-2", "Renamed elsewhere"]]);
    assert.deepEqual(res.removed, []);
    assert.equal(stub.count("list"), 2, "one bd list after the restart");
  });

  it("the stand-in a fresh tab got after the restart is a base too", async () => {
    await loadSaveRestart();
    stub.setIssues(DATA.filter((i) => i.id !== "dk-1.1"));
    moveRevision();
    stub.config({ listSleepMs: 400 });
    const quick = await call(treeRpc, tree, D, ctx);
    assert.equal(quick.issues.length, 3, "the stand-in, in full");
    const res = await call(treeRpc, tree, { ...D, have: quick.revision }, ctx);
    assert.equal(res.delta, true);
    assert.deepEqual(res.removed, ["dk-1.1"]);
  });

  it("same revision after the restart: unchanged, no bd", async () => {
    const first = await loadSaveRestart();
    const res = await call(treeRpc, tree, { ...D, have: first.revision }, ctx);
    assert.equal(res.unchanged, true);
    assert.equal(stub.count("list"), 1);
  });

  it("a revision from before the restart that is not on disk: the full set", async () => {
    const old = await call(treeRpc, tree, D, ctx);
    stub.setIssues(DATA.map((i) => (i.id === "dk-1" ? { ...i, priority: 0 } : i)));
    moveRevision();
    await loadSaveRestart(); // the file now holds the newer revision
    stub.setIssues(DATA.map((i) => (i.id === "dk-1" ? { ...i, priority: 3 } : i)));
    moveRevision();
    const res = await call(treeRpc, tree, { ...D, have: old.revision }, ctx);
    assert.ok(!("delta" in res));
    assert.equal(res.issues.length, 3);
  });
});

describe("logs", () => {
  it("no log line carries issue content (invariant 6)", () => {
    assert.ok(logs.lines.some((l) => l.includes("disk cache")), "the disk cache said nothing at all");
    for (const line of logs.lines) for (const s of SECRETS) assert.ok(!line.includes(s), `log leaked "${s}": ${line}`);
  });
});
