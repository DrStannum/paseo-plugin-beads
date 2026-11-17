/**
 * Smoke test of the write side against a recording `bd` stub — port of the
 * "write invariant" section of the reference's tests/smoke.mjs.
 *
 * The stub remembers what each write did, so the checks are about what bd was
 * actually asked to do, and the argv log proves the shape of every call: reads
 * carry --readonly, writes are one of the closed set and never do, nothing
 * turns dolt auto-commit on, and `delete` is refused before bd is reached.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  commentRpc, createRpc, editRpc, exportRpc, jobStatusRpc, revisionRpc, syncRpc, treeRpc,
} from "../shared/rpc.ts";
import { comment, create, edit, exportNow, jobStatus, revision, sync, tree } from "../server/handlers.ts";
import { runBdWrite, WRITE_SUBCOMMANDS } from "../server/beads/run.ts";
import { call, captureLogs, fakeCtx, makeProject, makeStub, sleep, usePath, type Stub } from "./support/harness.ts";

const ORIGINAL_PATH = process.env.PATH || "";
const ORIGINAL_ACTOR = process.env.BEADS_ACTOR;
const logs = captureLogs();

const SEED = [{
  id: "stub-1", title: "Stub issue", status: "open", priority: 2, issue_type: "task", assignee: "",
  labels: [], dependencies: [], description: "d", comment_count: 0,
}];

describe("write invariant", () => {
  let stub: Stub;
  let project: string;
  let ctx: ReturnType<typeof fakeCtx>;
  const ws = { workspaceId: "ws" };

  before(() => {
    delete process.env.BEADS_ACTOR;
    stub = makeStub(SEED);
    // A slow export gives a burst of saves a window to collapse into.
    stub.config({ exportSleepMs: 300 });
    project = makeProject();
    ctx = fakeCtx({ ws: project });
    usePath(stub.dir, ORIGINAL_PATH);
  });
  after(() => {
    logs.restore();
    if (ORIGINAL_ACTOR !== undefined) process.env.BEADS_ACTOR = ORIGINAL_ACTOR;
    stub.remove();
    fs.rmSync(project, { recursive: true, force: true });
    usePath(null, ORIGINAL_PATH);
  });

  /** Poll the job status until the background export is neither running nor pending. */
  async function waitForExportIdle(timeoutMs = 5000) {
    const start = Date.now();
    for (;;) {
      const res = await call(jobStatusRpc, jobStatus, ws, ctx);
      if (!res.export.running && !res.export.pending) return res.export;
      if (Date.now() - start > timeoutMs) throw new Error("export never went idle");
      await sleep(40);
    }
  }

  it("the whitelist is exactly create/update/close/reopen/export/import/comment", () => {
    assert.deepEqual([...WRITE_SUBCOMMANDS].sort(), ["close", "comment", "create", "export", "import", "reopen", "update"]);
  });

  it("delete (or anything else) is refused before bd is reached", async () => {
    const before = stub.calls().length;
    for (const sub of ["delete", "dep", "init", "sync", ""]) {
      const res = await runBdWrite(project, [sub, "stub-1"]);
      assert.equal(res.ok, false);
      assert.match(res.stderr, /refusing/);
    }
    assert.equal(stub.calls().length, before, "a refused subcommand still reached bd");
  });

  it("an edit lands via bd update and answers with the updated card", async () => {
    const res = await call(editRpc, edit, { ...ws, id: "stub-1", fields: { title: "edited" } }, ctx);
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 200));
    assert.equal(res.issue.title, "edited");
  });

  it("the tree right after the write already carries the change", async () => {
    const res = await call(treeRpc, tree, ws, ctx);
    assert.equal(res.issues[0].title, "edited");
  });

  it("a create runs bd create and takes the id from what bd printed", async () => {
    const before = stub.calls().length;
    const res = await call(createRpc, create, {
      ...ws, fields: { title: "made here", issue_type: "bug", priority: 1, labels: ["x"] },
    }, ctx);
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 200));
    assert.equal(res.id, "stub-2");
    assert.equal(res.issue.title, "made here");
    assert.deepEqual(res.issue.labels, ["x"]);
    const creates = stub.calls().slice(before).filter((c) => c.split(/\s+/).includes("create"));
    assert.equal(creates.length, 1);
    assert.ok(!creates[0]!.split(/\s+/).includes("--readonly"));
    assert.ok(creates[0]!.includes("create made here"), "the title is positional");
  });

  it("the created issue shows up in the next tree", async () => {
    const res = await call(treeRpc, tree, ws, ctx);
    assert.ok(res.issues.some((i: any) => i.id === "stub-2"));
  });

  it("exactly one bd update so far, without --readonly, with the plugin's actor", () => {
    const updates = stub.calls().filter((c) => c.split(/\s+/).includes("update"));
    assert.equal(updates.length, 1);
    assert.ok(!updates[0]!.split(/\s+/).includes("--readonly"));
    assert.match(updates[0]!, /--actor paseo-beads --dolt-auto-commit off -C /);
  });

  it("the export that follows a write runs and leaves the state clean", async () => {
    const exp = await waitForExportIdle();
    assert.ok(stub.count("export") >= 1);
    assert.equal(exp.lastError, null);
    assert.equal(exp.stale, false);
  });

  it("closing goes through bd close, reopening through bd reopen", async () => {
    const closed = await call(editRpc, edit, { ...ws, id: "stub-1", fields: { status: "closed", close_reason: "done" } }, ctx);
    assert.equal(closed.issue.status, "closed");
    assert.equal(closed.issue.close_reason, "done");
    await waitForExportIdle();
    const reopened = await call(editRpc, edit, { ...ws, id: "stub-1", fields: { status: "in_progress" } }, ctx);
    assert.equal(reopened.issue.status, "in_progress", "reopen, then -s for anything but open");
    await waitForExportIdle();
    assert.ok(stub.count("close") >= 1);
    assert.ok(stub.count("reopen") >= 1);
    const order = stub.calls().filter((c) => /\b(reopen|update)\b/.test(c)).slice(-2);
    assert.match(order[0]!, /reopen/);
    assert.match(order[1]!, /update stub-1 -s in_progress/);
  });

  it("a comment lands via bd comment and comes back on the card", async () => {
    const before = stub.calls().length;
    const res = await call(commentRpc, comment, { ...ws, id: "stub-1", text: "from the card" }, ctx);
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 200));
    assert.deepEqual(res.issue.comments.map((c: any) => c.text), ["from the card"]);
    assert.equal(res.issue.comments[0].author, "paseo-beads");
    const comments = stub.calls().slice(before).filter((c) => c.split(/\s+/).includes("comment"));
    assert.equal(comments.length, 1);
    assert.ok(comments[0]!.includes("comment stub-1 from the card"));
    await waitForExportIdle();
  });

  it("a comment author from the caller becomes the --actor", async () => {
    const res = await call(commentRpc, comment, { ...ws, id: "stub-1", text: "second", author: "  reader@example.com " }, ctx);
    assert.equal(res.issue.comments.at(-1).author, "reader@example.com");
    await waitForExportIdle();
  });

  it("an empty comment is refused before bd is asked", async () => {
    const before = stub.calls().length;
    const res = await call(commentRpc, comment, { ...ws, id: "stub-1", text: "   " }, ctx);
    assert.equal(res.code, "bad_comment");
    assert.ok(!stub.calls().slice(before).some((c) => c.split(/\s+/).includes("comment")));
  });

  it("three saves in a row collapse into at most two exports", async () => {
    const before = (await call(jobStatusRpc, jobStatus, ws, ctx)).export.runs;
    await Promise.all(["a", "b", "c"].map((v) =>
      call(editRpc, edit, { ...ws, id: "stub-1", fields: { external_ref: v } }, ctx)));
    const exp = await waitForExportIdle();
    assert.ok(exp.runs - before <= 2, `three saves triggered ${exp.runs - before} export run(s)`);
  });

  it("a save does not force a second tree fetch once the export settles", async () => {
    await call(editRpc, edit, { ...ws, id: "stub-1", fields: { external_ref: "d" } }, ctx);
    const revAfterWrite = (await call(revisionRpc, revision, ws, ctx)).revision;
    const exp = await waitForExportIdle();
    assert.equal(exp.supersededFrom, revAfterWrite, JSON.stringify(exp));
    assert.ok(exp.revision && exp.revision !== revAfterWrite);
    // …and the cached snapshot was relabelled, so have=<new> is unchanged without a bd run.
    const lists = stub.count("list");
    const res = await call(treeRpc, tree, { ...ws, have: exp.revision }, ctx);
    assert.equal(res.unchanged, true);
    assert.equal(stub.count("list"), lists);
  });

  it("bad input is rejected with a code before anything runs", async () => {
    const before = stub.calls().length;
    const cases: [string, Record<string, unknown>, string][] = [
      ["stub-1", { status: "nope" }, "bad_status"],
      ["stub-1", { priority: 9 }, "bad_priority"],
      ["stub-1", { priority: 1.5 }, "bad_priority"],
      ["stub-1", { issue_type: "nope" }, "bad_type"],
      ["stub-1", { title: "  " }, "bad_title"],
      ["stub-1", { parent: "stub-1" }, "bad_parent"],
      ["stub-1", { parent: "nope-1" }, "bad_parent"],
      ["stub-1", { notes: 5 }, "bad_text"],
      ["stub-1", { notes: "x".repeat(600 * 1024) }, "too_long"],
      ["stub-1", {}, "no_changes"],
      ["no-such-id", { title: "x" }, "not_found"],
    ];
    for (const [id, fields, code] of cases) {
      const res = await call(editRpc, edit, { ...ws, id, fields }, ctx);
      assert.equal(res.ok, false);
      assert.equal(res.code, code, JSON.stringify(fields).slice(0, 80));
    }
    for (const [fields, code] of [
      [{}, "bad_title"], [{ title: "x", priority: 9 }, "bad_priority"], [{ title: "x", issue_type: "nope" }, "bad_type"],
      [{ title: "x", parent: "nope-404" }, "bad_parent"], [{ title: "x", labels: ["a,b"] }, "bad_label"],
    ] as const) {
      const res = await call(createRpc, create, { ...ws, fields }, ctx);
      assert.equal(res.code, code);
    }
    assert.equal(stub.calls().length, before, "a rejected write must not touch bd at all");
  });

  it("export retry is reachable and idempotent", async () => {
    const res = await call(exportRpc, exportNow, ws, ctx);
    assert.equal(res.ok, true);
    assert.equal(res.export.running, true);
    await waitForExportIdle();
  });

  it("a sync runs import before export, both without --readonly, no --allow-stale", async () => {
    fs.writeFileSync(`${project}/.beads/issues.jsonl`, JSON.stringify(SEED[0]) + "\n");
    const before = stub.calls().length;
    const res = await call(syncRpc, sync, ws, ctx);
    assert.equal(res.ok, true);
    // While it runs, the job says it is a sync (the reference's flag almost never did).
    assert.equal(res.export.running, true);
    assert.equal(res.export.syncing, true, "beads.sync answers syncing:true");
    const mid = await call(jobStatusRpc, jobStatus, ws, ctx);
    assert.equal(mid.export.syncing, mid.export.running, "beads.job-status: syncing for as long as the sync runs");
    const rev = await call(revisionRpc, revision, ws, ctx);
    if (rev.ok && rev.export.running) assert.equal(rev.export.syncing, true, "beads.revision: syncing while the sync runs");
    const exp = await waitForExportIdle();
    assert.equal(exp.syncing, false, "done: not syncing any more");
    assert.equal(exp.lastImport?.error, null);
    const calls = stub.calls().slice(before);
    const imports = calls.filter((c) => c.split(/\s+/).includes("import"));
    const exports_ = calls.filter((c) => c.split(/\s+/).includes("export"));
    assert.equal(imports.length, 1);
    assert.ok(exports_.length >= 1);
    assert.ok(calls.indexOf(imports[0]!) < calls.indexOf(exports_[0]!), "export ran before import");
    assert.ok(!imports[0]!.split(/\s+/).includes("--readonly"));
    assert.ok(!imports[0]!.includes("--allow-stale"));
  });

  it("every call is a --readonly read or a whitelisted write without --readonly", () => {
    const calls = stub.calls();
    assert.ok(calls.length > 0);
    for (const c of calls) {
      const words = c.split(/\s+/);
      const sub = words.find((w) => WRITE_SUBCOMMANDS.has(w) || w === "list" || w === "comments");
      assert.ok(sub, `no recognizable subcommand: ${c}`);
      if (sub === "list" || sub === "comments") assert.ok(words.includes("--readonly"), c);
      else assert.ok(!words.includes("--readonly"), c);
      assert.ok(!words.includes("delete"), c);
    }
  });

  it("no call ever turns dolt auto-commit on, and every write turns it off", () => {
    const calls = stub.calls();
    assert.ok(!/--dolt-auto-commit[= ](on|batch)/.test(calls.join("\n")));
    for (const c of calls.filter((c) => !c.includes("--readonly"))) assert.match(c, /--dolt-auto-commit off/);
  });

  it("the logs carry no issue text", () => {
    const all = logs.lines.join("\n");
    for (const s of ["Stub issue", "edited", "made here", "from the card", "reader@example.com"]) {
      assert.ok(!all.includes(s), `"${s}" reached the log`);
    }
  });
});
