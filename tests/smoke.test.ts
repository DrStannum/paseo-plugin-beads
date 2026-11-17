/**
 * Smoke test of the read side — port of the reference's tests/smoke.mjs
 * (validation, the --readonly invariant, jsonl mode, the snapshot cache).
 *
 * The handlers are called in-process with a fake daemon context and a
 * recording `bd` stub on PATH; the invariants are checked from the argv the
 * stub actually received, not from the source.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  healthRpc, issueRpc, jobStatusRpc, pingRpc, revisionRpc, searchRpc, treeRpc, editRpc, createRpc, commentRpc,
} from "../shared/rpc.ts";
import {
  comment, create, edit, health, issue, jobStatus, ping, revision, search, tree,
} from "../server/handlers.ts";
import { tuning } from "../server/beads/snapshot.ts";
import { shutdown } from "../server/lifecycle.ts";
import { liveRuns } from "../server/beads/run.ts";
import { liveTimers } from "../server/beads/timers.ts";
import { call, captureLogs, fakeCtx, makeProject, makeStub, sleep, tmpDir, usePath, type Stub } from "./support/harness.ts";

const ORIGINAL_PATH = process.env.PATH || "";
const logs = captureLogs();
after(() => {
  logs.restore();
  usePath(null, ORIGINAL_PATH);
});

/** Text that must never reach a log line. */
const SECRETS = ["Secret title one", "needle-in-description", "hello-comment-secret", "unicornDescriptionToken"];

// ── validation ─────────────────────────────────────────────────────────

describe("workspace and project resolution", () => {
  const bare = tmpDir("pbd-bare-");
  const shell = tmpDir("pbd-shell-");
  fs.mkdirSync(path.join(shell, ".beads"));
  fs.writeFileSync(path.join(shell, ".beads", "eventsData"), "");
  const file = path.join(bare, "a-file");
  fs.writeFileSync(file, "");
  const ctx = fakeCtx({ bare, shell, gone: "/definitely/not/here", file, rel: "../../etc" });
  after(() => {
    fs.rmSync(bare, { recursive: true, force: true });
    fs.rmSync(shell, { recursive: true, force: true });
  });

  it("an unknown workspace is a code, not a throw", async () => {
    for (const [contract, handler] of [[treeRpc, tree], [revisionRpc, revision], [healthRpc, health]] as const) {
      const res = await call(contract, handler as any, { workspaceId: "wks_nope" }, ctx);
      assert.equal(res.ok, false);
      assert.equal(res.code, "unknown_workspace");
    }
    const p = await call(pingRpc, ping, { workspaceId: "wks_nope" }, ctx);
    assert.equal(p.code, "unknown_workspace");
  });

  it("ping answers with the workspace directory", async () => {
    const p = await call(pingRpc, ping, { workspaceId: "bare" }, ctx);
    assert.equal(p.ok, true);
    assert.equal(p.directory, bare);
  });

  it("a directory without .beads is an empty state: no_beads with bdFound", async () => {
    for (const [contract, handler, extra] of [
      [treeRpc, tree, {}], [healthRpc, health, {}], [revisionRpc, revision, {}], [jobStatusRpc, jobStatus, {}],
      [issueRpc, issue, { id: "x-1" }], [searchRpc, search, { q: "x" }],
      [editRpc, edit, { id: "x-1", fields: { title: "x" } }], [createRpc, create, { fields: { title: "x" } }],
      [commentRpc, comment, { id: "x-1", text: "x" }],
    ] as const) {
      const res = await call(contract, handler as any, { workspaceId: "bare", ...extra }, ctx);
      assert.equal(res.ok, false, contract.name);
      assert.equal(res.code, "no_beads", contract.name);
      assert.equal(typeof res.bdFound, "boolean");
    }
  });

  it("an empty .beads shell left by another tool is walked past", async () => {
    const res = await call(treeRpc, tree, { workspaceId: "shell" }, ctx);
    assert.equal(res.code, "no_beads");
  });

  it("a vanished directory, a file and a relative path are refused", async () => {
    assert.equal((await call(treeRpc, tree, { workspaceId: "gone" }, ctx)).code, "not_found");
    assert.equal((await call(treeRpc, tree, { workspaceId: "file" }, ctx)).code, "not_a_directory");
    assert.equal((await call(treeRpc, tree, { workspaceId: "rel" }, ctx)).code, "not_absolute");
  });
});

// ── the --readonly invariant, and the jsonl fallback ────────────────────

describe("read-only invariant (bd always says: no database)", () => {
  let stub: Stub;
  let project: string;
  let ctx: ReturnType<typeof fakeCtx>;
  before(() => {
    stub = makeStub();
    stub.config({ noDb: true });
    project = makeProject({
      "issues.jsonl": [
        { _type: "issue", id: "stub-1", title: "stub", status: "open", priority: 2, issue_type: "task" },
        { _type: "issue", id: "stub-2", title: "child", status: "open", issue_type: "task",
          dependencies: [{ issue_id: "stub-2", depends_on_id: "stub-1", type: "parent-child" }] },
        { _type: "memory", key: "m", value: "not an issue" },
      ].map((r) => JSON.stringify(r)).join("\n") + "\n{broken\n",
    });
    fs.mkdirSync(path.join(project, "sub"));
    ctx = fakeCtx({ ws: project, sub: path.join(project, "sub") });
    usePath(stub.dir, ORIGINAL_PATH);
  });
  after(() => {
    stub.remove();
    fs.rmSync(project, { recursive: true, force: true });
  });

  it("a bd failure falls back to issues.jsonl, issues only, parents derived", async () => {
    const res = await call(treeRpc, tree, { workspaceId: "ws" }, ctx);
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 200));
    assert.equal(res.mode, "jsonl");
    assert.deepEqual(res.issues.map((i: any) => i.id), ["stub-1", "stub-2"]);
    assert.equal(res.issues[1].parent, "stub-1");
    assert.ok(res.warnings.some((w: string) => /unparseable/.test(w)));
  });

  it("a subdirectory of the workspace resolves to the same .beads", async () => {
    const a = await call(healthRpc, health, { workspaceId: "ws" }, ctx);
    const b = await call(healthRpc, health, { workspaceId: "sub" }, ctx);
    assert.equal(a.ok, true);
    assert.equal(b.beadsDir, a.beadsDir);
    assert.equal(a.mode, "jsonl");
  });

  it("fields missing from the export degrade to empty, not to errors", async () => {
    const res = await call(issueRpc, issue, { workspaceId: "ws", id: "stub-1" }, ctx);
    assert.equal(res.ok, true);
    assert.deepEqual(res.issue.labels, []);
    assert.equal(res.issue.design, null);
    assert.equal(res.issue.commentsAvailable, false);
    assert.deepEqual(res.issue.comments, []);
    assert.equal(res.issue.relations.children[0].id, "stub-2");
  });

  it("jsonl mode is read-only: edit, create and comment are refused before bd", async () => {
    const before = stub.calls().length;
    const e = await call(editRpc, edit, { workspaceId: "ws", id: "stub-1", fields: { title: "x" } }, ctx);
    const c = await call(createRpc, create, { workspaceId: "ws", fields: { title: "x" } }, ctx);
    const m = await call(commentRpc, comment, { workspaceId: "ws", id: "stub-1", text: "x" }, ctx);
    for (const r of [e, c, m]) assert.equal(r.code, "read_only_mode");
    // Reads may re-run (the revision did not move, so they do not); writes never.
    for (const call_ of stub.calls().slice(before)) assert.ok(call_.split(/\s+/).includes("--readonly"), call_);
  });

  it("an unknown id is not_found, not a crash", async () => {
    const res = await call(issueRpc, issue, { workspaceId: "ws", id: "nope-9999" }, ctx);
    assert.equal(res.code, "not_found");
  });

  it("every recorded bd invocation carried --readonly and no write verb", () => {
    const calls = stub.calls();
    assert.ok(calls.length > 0, "the stub was never called");
    const writeVerbs = new Set(["create", "update", "close", "reopen", "delete", "edit", "assign", "label", "tag",
      "link", "dep", "note", "comment", "priority", "set-state", "promote", "init", "q", "export", "import"]);
    for (const c of calls) {
      const words = c.split(/\s+/);
      assert.ok(words.includes("--readonly"), `no --readonly in: ${c}`);
      for (const w of words) assert.ok(!writeVerbs.has(w), `write subcommand "${w}" in: ${c}`);
    }
  });
});

// ── a bd project: tree, card, search ───────────────────────────────────

const DATA = [
  { id: "st-1", title: "Secret title one", status: "open", priority: 1, issue_type: "epic", labels: ["area:x"],
    description: "needle-in-description", comment_count: 1, created_at: "2026-01-01T00:00:00Z", created_by: "a" },
  { id: "st-1.1", title: "Child one", status: "open", priority: 2, issue_type: "task", parent: "st-1",
    description: "unicornDescriptionToken mentions st-1",
    dependencies: [{ issue_id: "st-1.1", depends_on_id: "st-1.2", type: "blocks" },
      { issue_id: "st-1.1", depends_on_id: "st-9", type: "discovered-from" }] },
  { id: "st-1.2", title: "Child two", status: "in_progress", priority: 2, issue_type: "task", parent: "st-1",
    started_at: "2026-01-02T00:00:00Z" },
  { id: "st-9", title: "Done", status: "closed", priority: 3, issue_type: "bug",
    started_at: "2026-01-02T00:00:00Z", closed_at: "2026-01-03T00:00:00Z",
    dependencies: [{ issue_id: "st-9", depends_on_id: "st-1", type: "relates-to" }] },
];

describe("bd mode against the stub: tree, card, search, snapshot cache", () => {
  let stub: Stub;
  let project: string;
  let ctx: ReturnType<typeof fakeCtx>;
  const C_RETRY_MS = 1500;
  let bump = 0;
  /** Move the revision the way a write elsewhere would: issues.jsonl changes size. */
  const moveRevision = () => {
    bump++;
    fs.writeFileSync(path.join(project, ".beads", "issues.jsonl"), `${"x".repeat(bump)}\n`);
  };
  before(() => {
    stub = makeStub(DATA, { "st-1": [{ id: "c1", author: "a", text: "hello-comment-secret", created_at: "2026-08-06T10:00:00Z" }] });
    stub.config({ listSleepMs: 250 });
    project = makeProject();
    ctx = fakeCtx({ ws: project });
    usePath(stub.dir, ORIGINAL_PATH);
    tuning.errorRetryMs = C_RETRY_MS;
  });
  after(() => {
    stub.remove();
    fs.rmSync(project, { recursive: true, force: true });
  });

  let first: any;
  it("the first tree loads from bd: the whole set, light rows, chart fields", async () => {
    first = await call(treeRpc, tree, { workspaceId: "ws" }, ctx);
    assert.equal(first.ok, true, JSON.stringify(first).slice(0, 200));
    assert.equal(first.mode, "bd");
    assert.equal(first.unchanged, false);
    assert.equal(first.issues.length, 4);
    assert.equal(first.counts.total, 4);
    assert.equal(first.prefix, "st");
    assert.ok(!("stale" in first), "a fresh answer must not carry stale");
    assert.equal(stub.count("list"), 1);
    const call0 = stub.calls()[0]!;
    assert.match(call0, /--readonly --json -C .* list --all -n 0 --no-pager/);
    for (const row of first.issues) {
      for (const heavy of ["description", "design", "acceptance_criteria", "notes"]) assert.ok(!(heavy in row), heavy);
      for (const f of ["created_at", "created_by", "updated_at", "started_at", "closed_at", "assignee", "status"]) {
        assert.ok(f in row, `the charts read ${f}`);
      }
    }
    assert.ok(first.issues.some((i: any) => i.closed_at));
    assert.ok(first.issues.some((i: any) => i.started_at));
  });

  it("ready, blockers and parents are computed like bd ready", () => {
    const byId = new Map(first.issues.map((i: any) => [i.id, i]));
    const child: any = byId.get("st-1.1");
    assert.deepEqual(child.blockers, ["st-1.2"]);
    assert.equal(child.ready, false);
    assert.equal((byId.get("st-1") as any).ready, true);
    assert.equal(child.parent, "st-1");
    assert.equal(first.counts.ready, 1);
    assert.equal(first.counts.blocked, 1);
  });

  it("the card carries heavy text, both link directions and the thread", async () => {
    const res = await call(issueRpc, issue, { workspaceId: "ws", id: "st-1.1" }, ctx);
    assert.equal(res.ok, true);
    const card = res.issue;
    assert.match(card.description, /unicornDescriptionToken/);
    assert.equal(card.relations.parent.id, "st-1");
    assert.equal(card.relations.parent.title, "Secret title one");
    assert.deepEqual(card.relations.blockedBy.map((r: any) => r.id), ["st-1.2"]);
    assert.deepEqual(card.relations.discoveredFrom.map((r: any) => r.id), ["st-9"]);
    const blocker = await call(issueRpc, issue, { workspaceId: "ws", id: "st-1.2" }, ctx);
    assert.deepEqual(blocker.issue.relations.blocking.map((r: any) => r.id), ["st-1.1"]);
    const epic = await call(issueRpc, issue, { workspaceId: "ws", id: "st-1" }, ctx);
    assert.deepEqual(epic.issue.relations.children.map((r: any) => r.id), ["st-1.1", "st-1.2"]);
    assert.deepEqual(epic.issue.relations.other.map((r: any) => [r.id, r.direction]), [["st-9", "in"]]);
    assert.equal(epic.issue.commentsAvailable, true);
    assert.deepEqual(epic.issue.comments.map((c: any) => c.text), ["hello-comment-secret"]);
  });

  it("search finds description-only text; a whole key answers alone; a stem finds the family", async () => {
    const r = await call(searchRpc, search, { workspaceId: "ws", q: "unicorndescriptiontoken" }, ctx);
    assert.deepEqual(r.ids, ["st-1.1"]);
    const key = await call(searchRpc, search, { workspaceId: "ws", q: "ST-1" }, ctx);
    assert.deepEqual(key.ids, ["st-1"]);
    const stem = await call(searchRpc, search, { workspaceId: "ws", q: "st-1." }, ctx);
    assert.ok(stem.ids.length > 1);
    assert.equal(r.truncated, false);
    const empty = await call(searchRpc, search, { workspaceId: "ws", q: "  " }, ctx);
    assert.deepEqual(empty.ids, []);
  });

  it("revision is stable across calls, matches the tree and runs no bd", async () => {
    const before = stub.calls().length;
    const a = await call(revisionRpc, revision, { workspaceId: "ws" }, ctx);
    const b = await call(revisionRpc, revision, { workspaceId: "ws" }, ctx);
    assert.equal(a.revision, b.revision);
    assert.equal(a.revision, first.revision);
    assert.equal(a.loadError, null);
    assert.equal(a.export.running, false);
    assert.equal(stub.calls().length, before);
  });

  it("parallel tree, issue, search, health after a revision move spawn one bd list", async () => {
    moveRevision();
    const before = stub.count("list");
    const replies = await Promise.all([
      call(treeRpc, tree, { workspaceId: "ws" }, ctx),
      call(treeRpc, tree, { workspaceId: "ws" }, ctx),
      call(treeRpc, tree, { workspaceId: "ws" }, ctx),
      call(issueRpc, issue, { workspaceId: "ws", id: "st-1.2" }, ctx),
      call(searchRpc, search, { workspaceId: "ws", q: "needle" }, ctx),
      call(healthRpc, health, { workspaceId: "ws" }, ctx),
    ]);
    for (const r of replies) assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
    assert.equal(stub.count("list") - before, 1);
    const revs = new Set(replies.filter((r) => r.revision).map((r) => r.revision));
    assert.equal(revs.size, 1);
  });

  it("the comment thread is fetched once per snapshot", async () => {
    const before = stub.count("comments");
    const a = await call(issueRpc, issue, { workspaceId: "ws", id: "st-1" }, ctx);
    const b = await call(issueRpc, issue, { workspaceId: "ws", id: "st-1" }, ctx);
    assert.deepEqual(b.issue.comments, a.issue.comments);
    assert.equal(stub.count("comments") - before, 1);
  });

  it("tree with have=<current revision> answers unchanged, without the rows or a bd run", async () => {
    const rev = (await call(revisionRpc, revision, { workspaceId: "ws" }, ctx)).revision;
    const before = stub.count("list");
    const res = await call(treeRpc, tree, { workspaceId: "ws", have: rev }, ctx);
    assert.equal(res.unchanged, true);
    assert.equal(res.revision, rev);
    assert.ok(!("issues" in res));
    assert.equal(res.counts.total, 4);
    assert.equal(res.mode, "bd");
    assert.ok(res.export);
    assert.equal(stub.count("list"), before);
    const other = await call(treeRpc, tree, { workspaceId: "ws", have: "not-this-one" }, ctx);
    assert.equal(other.unchanged, false);
    assert.equal(other.issues.length, 4);
  });

  let goodRevision = "";
  it("a failing bd list serves the last good snapshot, marked stale, after one retry", async () => {
    goodRevision = (await call(treeRpc, tree, { workspaceId: "ws" }, ctx)).revision;
    stub.config({ listSleepMs: 250, failList: true });
    moveRevision();
    const before = stub.count("list");
    const res = await call(treeRpc, tree, { workspaceId: "ws", have: goodRevision }, ctx);
    assert.equal(res.ok, true);
    assert.equal(res.unchanged, false, "a stale answer must not claim unchanged");
    assert.equal(res.issues.length, 4);
    assert.equal(res.stale.code, "bd_failed");
    assert.match(res.stale.message, /locked/);
    assert.equal(res.mode, "bd", "a failing bd must not flip a bd project to jsonl");
    assert.equal(stub.count("list") - before, 2);
  });

  it("revision reports the failed load without running bd", async () => {
    const before = stub.calls().length;
    const res = await call(revisionRpc, revision, { workspaceId: "ws" }, ctx);
    assert.equal(res.loadError.code, "bd_failed");
    assert.equal(stub.calls().length, before);
  });

  it("issue, search and health answer stale too, comments from the cache, no spawn", async () => {
    const before = stub.calls().length;
    const i = await call(issueRpc, issue, { workspaceId: "ws", id: "st-1" }, ctx);
    assert.equal(i.stale.code, "bd_failed");
    assert.deepEqual(i.issue.comments.map((c: any) => c.text), ["hello-comment-secret"]);
    const s = await call(searchRpc, search, { workspaceId: "ws", q: "needle" }, ctx);
    assert.deepEqual(s.ids, ["st-1"]);
    assert.equal(s.stale.code, "bd_failed");
    const h = await call(healthRpc, health, { workspaceId: "ws" }, ctx);
    assert.equal(h.ok, true);
    assert.equal(h.stale.code, "bd_failed");
    assert.equal(stub.calls().length, before);
  });

  it("a write whose reload fails still answers ok:true", async () => {
    const res = await call(editRpc, edit, { workspaceId: "ws", id: "st-1", fields: { priority: 3 } }, ctx);
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 200));
    assert.equal(res.stale.code, "bd_failed");
    assert.ok(res.issue === null || res.issue.id === "st-1");
    assert.ok(stub.count("update") >= 1);
  });

  it(`a failed load is retried no sooner than errorRetryMs (${C_RETRY_MS} ms here)`, async () => {
    const before = stub.count("list");
    const soon = await call(treeRpc, tree, { workspaceId: "ws" }, ctx);
    assert.equal(soon.stale.code, "bd_failed");
    assert.equal(stub.count("list"), before, "retried inside the window");
    await sleep(C_RETRY_MS + 150);
    const later = await call(treeRpc, tree, { workspaceId: "ws" }, ctx);
    assert.equal(later.stale.code, "bd_failed");
    assert.equal(stub.count("list") - before, 2);
  });

  it("once bd works again the answer is fresh: no stale, no loadError", async () => {
    stub.config({ listSleepMs: 250 });
    await sleep(C_RETRY_MS + 150);
    const res = await call(treeRpc, tree, { workspaceId: "ws" }, ctx);
    assert.ok(!("stale" in res));
    assert.notEqual(res.revision, goodRevision);
    assert.equal((await call(revisionRpc, revision, { workspaceId: "ws" }, ctx)).loadError, null);
    assert.equal((await call(treeRpc, tree, { workspaceId: "ws", have: res.revision }, ctx)).unchanged, true);
  });

  it("the failure was logged — the reason, never the issue text", () => {
    const lines = logs.lines.filter((l) => l.includes("bd list failed"));
    assert.ok(lines.length > 0, "nothing logged");
    assert.ok(lines.every((l) => l.includes("bd_failed") && l.includes("locked")), lines[0]);
    const all = logs.lines.join("\n");
    for (const s of SECRETS) assert.ok(!all.includes(s), `issue text "${s}" reached the log`);
  });
});

// ── the RPC budget and cleanup ─────────────────────────────────────────

describe("budget and cleanup", () => {
  it("a load that overruns the handler budget answers busy, then lands for the next call", async () => {
    const { handlerTuning } = await import("../server/handlers.ts");
    const stub = makeStub(DATA);
    stub.config({ listSleepMs: 600 });
    const project = makeProject();
    const ctx = fakeCtx({ ws: project });
    usePath(stub.dir, ORIGINAL_PATH);
    const saved = handlerTuning.budgetMs;
    handlerTuning.budgetMs = 100;
    try {
      const res = await call(treeRpc, tree, { workspaceId: "ws" }, ctx);
      assert.equal(res.code, "busy");
      await sleep(900);
      const again = await call(treeRpc, tree, { workspaceId: "ws" }, ctx);
      assert.equal(again.ok, true);
      assert.equal(stub.count("list"), 1, "the overrunning load was not reused");
    } finally {
      handlerTuning.budgetMs = saved;
      stub.remove();
      fs.rmSync(project, { recursive: true, force: true });
    }
  });

  it("cleanup leaves no timer and no bd child behind", async () => {
    const stub = makeStub(DATA);
    stub.config({ listSleepMs: 2000 });
    const project = makeProject();
    const ctx = fakeCtx({ ws: project });
    usePath(stub.dir, ORIGINAL_PATH);
    try {
      const pending = call(treeRpc, tree, { workspaceId: "ws" }, ctx);
      await sleep(200);
      assert.ok(liveRuns() > 0 && liveTimers() > 0, "nothing was running to clean up");
      shutdown();
      assert.equal(liveTimers(), 0);
      await sleep(100);
      assert.equal(liveRuns(), 0);
      void pending.catch(() => {});
    } finally {
      stub.remove();
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
