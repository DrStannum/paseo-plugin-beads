/**
 * The write path against a real, disposable `bd` project — port of the
 * reference's tests/write.mjs.
 *
 * The smoke tests prove the *shape* of every call against a stub; this file
 * asks the real binary the questions only a real database can answer: did the
 * field change, did the export keep the memory record, did dolt stay
 * uncommitted, did git stay untouched.
 *
 * The project is created under the OS temp dir and removed at the end. This
 * repository's own .beads is never touched: every bd call carries -C <temp>.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  commentRpc, createRpc, editRpc, exportRpc, issueRpc, jobStatusRpc, revisionRpc, syncRpc, treeRpc,
} from "../shared/rpc.ts";
import { comment, create, edit, exportNow, issue, jobStatus, revision, sync, tree } from "../server/handlers.ts";
import { resetBdPath } from "../server/beads/run.ts";
import { call, fakeCtx, sleep, tmpDir, usePath } from "./support/harness.ts";

const ORIGINAL_PATH = process.env.PATH || "";
const ORIGINAL_ACTOR = process.env.BEADS_ACTOR;

function bdAvailable(): boolean {
  try {
    execFileSync("bd", ["version"], { stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

describe("write path against a real bd", { skip: bdAvailable() ? false : "no bd binary on PATH" }, () => {
  const project = tmpDir("pbd-write-");
  const jsonlPath = path.join(project, ".beads", "issues.jsonl");
  const run = (bin: string, args: string[]) =>
    execFileSync(bin, args, { cwd: project, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const bd = (args: string[]) => run("bd", [...args, "-C", project]);
  const git = (args: string[]) => run("git", args);
  const readJsonl = (): any[] =>
    fs.readFileSync(jsonlPath, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const doltCommit = () => JSON.parse(bd(["vc", "status", "--json"])).commit;

  const bare = tmpDir("pbd-write-bare-");
  const ctx = fakeCtx({ ws: project, bare });
  const ws = { workspaceId: "ws" };
  let A = "";
  let B = "";
  let initialDoltCommit = "";
  let initialGitLog = "";

  async function waitForExportIdle(timeoutMs = 20000) {
    const start = Date.now();
    for (;;) {
      const res = await call(jobStatusRpc, jobStatus, ws, ctx);
      if (!res.export.running && !res.export.pending) return res.export;
      if (Date.now() - start > timeoutMs) throw new Error(`export never went idle: ${JSON.stringify(res.export)}`);
      await sleep(60);
    }
  }

  before(() => {
    // The plugin's own identity is what a comment without an author must get.
    delete process.env.BEADS_ACTOR;
    usePath(null, ORIGINAL_PATH);
    git(["init", "-q"]);
    git(["config", "user.email", "pbd-test@example.com"]);
    git(["config", "user.name", "pbd-test"]);
    run("bd", ["init", "--prefix", "tw", "--non-interactive", "--skip-agents", "--skip-hooks", "-q"]);
    A = bd(["create", "Alpha", "--type", "task", "-p", "2", "--silent"]).trim();
    B = bd(["create", "Beta", "--type", "bug", "-p", "3", "--silent"]).trim();
    bd(["remember", "a memory that must survive every export", "--key", "pbd-test-mem"]);
    // issues.jsonl as a real repo carries it: on disk, already holding a non-issue record.
    bd(["export", "--include-memories", "-o", jsonlPath]);
    initialDoltCommit = doltCommit();
    // `bd init` makes its own git commit; the baseline is taken after it.
    initialGitLog = git(["log", "--oneline"]).trim();
  });

  after(() => {
    if (ORIGINAL_ACTOR !== undefined) process.env.BEADS_ACTOR = ORIGINAL_ACTOR;
    usePath(null, ORIGINAL_PATH);
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(bare, { recursive: true, force: true });
  });

  it("an edit changes exactly the fields sent, nothing else", async () => {
    const beforeCard = (await call(issueRpc, issue, { ...ws, id: A }, ctx)).issue;
    const res = await call(editRpc, edit, { ...ws, id: A, fields: { title: "Alpha, renamed", priority: 0 } }, ctx);
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
    assert.equal(res.issue.title, "Alpha, renamed");
    assert.equal(res.issue.priority, 0);
    for (const key of ["status", "issue_type", "assignee", "external_ref", "description", "design", "notes"]) {
      assert.deepEqual(res.issue[key], beforeCard[key], `${key} should not have moved`);
    }
  });

  it("the tree reflects the write immediately, before the export has run", async () => {
    const res = await call(treeRpc, tree, ws, ctx);
    assert.equal(res.issues.find((i: any) => i.id === A).title, "Alpha, renamed");
  });

  it("issues.jsonl carries the edit once the export is idle, and kept the memory record", async () => {
    await waitForExportIdle();
    const rows = readJsonl();
    assert.equal(rows.find((r) => r.id === A)?.title, "Alpha, renamed");
    assert.ok(rows.some((r) => r._type === "memory"), "the memory record is gone from issues.jsonl");
  });

  let made = "";
  it("creating an issue answers with the card bd actually made", async () => {
    const res = await call(createRpc, create, {
      ...ws,
      fields: {
        title: "Created from the panel", issue_type: "bug", priority: 1, parent: A,
        labels: ["area:ui", "from:test"], assignee: "alex", description: "body **text**", notes: "a note",
      },
    }, ctx);
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
    made = res.id;
    const card = res.issue;
    assert.equal(card.id, made);
    assert.equal(card.title, "Created from the panel");
    assert.equal(card.issue_type, "bug");
    assert.equal(card.priority, 1);
    assert.equal(card.parent, A);
    assert.equal(card.assignee, "alex");
    assert.equal(card.status, "open");
    assert.deepEqual([...card.labels].sort(), ["area:ui", "from:test"]);
    assert.equal(card.description, "body **text**");
    assert.equal(card.notes, "a note");
  });

  it("the new issue is in the tree, under its parent, right away", async () => {
    const res = await call(treeRpc, tree, ws, ctx);
    assert.equal(res.issues.find((i: any) => i.id === made)?.parent, A);
    const parent = (await call(issueRpc, issue, { ...ws, id: A }, ctx)).issue;
    assert.ok(parent.relations.children.some((c: any) => c.id === made));
  });

  it("creation is refused for anything bd would reject, and adds nothing", async () => {
    const before = (await call(treeRpc, tree, ws, ctx)).issues.length;
    for (const [fields, code] of [
      [{}, "bad_title"], [{ title: "   " }, "bad_title"], [{ title: "x", priority: 9 }, "bad_priority"],
      [{ title: "x", issue_type: "nope" }, "bad_type"], [{ title: "x", parent: "nope-404" }, "bad_parent"],
      [{ title: "x", labels: ["a,b"] }, "bad_label"],
    ] as const) {
      const res = await call(createRpc, create, { ...ws, fields }, ctx);
      assert.equal(res.code, code, JSON.stringify(res));
    }
    assert.equal((await call(treeRpc, tree, ws, ctx)).issues.length, before);
  });

  it("the created issue reaches issues.jsonl through the same export", async () => {
    await waitForExportIdle();
    assert.equal(readJsonl().find((r) => r.id === made)?.title, "Created from the panel");
  });

  it("close sets closed_at and close_reason; reopen clears them", async () => {
    const closed = await call(editRpc, edit, { ...ws, id: B, fields: { status: "closed", close_reason: "done for now" } }, ctx);
    assert.equal(closed.issue.status, "closed");
    assert.ok(closed.issue.closed_at);
    assert.equal(closed.issue.close_reason, "done for now");
    const reopened = await call(editRpc, edit, { ...ws, id: B, fields: { status: "open" } }, ctx);
    assert.equal(reopened.issue.status, "open");
    assert.equal(reopened.issue.closed_at, null);
    assert.equal(reopened.issue.close_reason, null);
    await waitForExportIdle();
  });

  it("a comment posted from the card is really in the database", async () => {
    const body = "From the card.\n\nWith a second paragraph and a `code span`.";
    const res = await call(commentRpc, comment, { ...ws, id: A, text: body }, ctx);
    assert.equal(res.ok, true, JSON.stringify(res).slice(0, 300));
    assert.equal(res.issue.comment_count, 1);
    assert.deepEqual(res.issue.comments.map((c: any) => c.text), [body]);
    const fromBd = JSON.parse(bd(["comments", A, "--json"]));
    assert.equal(fromBd.length, 1);
    assert.equal(fromBd[0].text, body);
    const row = (await call(treeRpc, tree, ws, ctx)).issues.find((i: any) => i.id === A);
    assert.equal(row.comment_count, 1);
    await waitForExportIdle();
  });

  it("a comment carries the author the caller sent", async () => {
    const body = "Comment with a reader-supplied author.";
    const res = await call(commentRpc, comment, { ...ws, id: A, text: body, author: "reader@example.com" }, ctx);
    assert.equal(res.issue.comments.find((c: any) => c.text === body).author, "reader@example.com");
    const fromBd = JSON.parse(bd(["comments", A, "--json"])).find((c: any) => c.text === body);
    assert.equal(fromBd.author, "reader@example.com");
    await waitForExportIdle();
  });

  it("a comment with no author falls back to the plugin identity", async () => {
    const body = "Comment with no author.";
    const res = await call(commentRpc, comment, { ...ws, id: A, text: body }, ctx);
    assert.equal(res.issue.comments.find((c: any) => c.text === body).author, "paseo-beads");
    await waitForExportIdle();
  });

  it("an empty comment, or one on a missing issue, is refused without touching bd", async () => {
    const before = JSON.parse(bd(["comments", A, "--json"])).length;
    assert.equal((await call(commentRpc, comment, { ...ws, id: A, text: "\n  \n" }, ctx)).code, "bad_comment");
    assert.equal(JSON.parse(bd(["comments", A, "--json"])).length, before);
    assert.equal((await call(commentRpc, comment, { ...ws, id: "tw-nope", text: "hello" }, ctx)).code, "not_found");
  });

  it("a label can be added and then removed", async () => {
    const added = await call(editRpc, edit, { ...ws, id: A, fields: { addLabels: ["triage"] } }, ctx);
    assert.deepEqual(added.issue.labels, ["triage"]);
    const removed = await call(editRpc, edit, { ...ws, id: A, fields: { removeLabels: ["triage"] } }, ctx);
    assert.deepEqual(removed.issue.labels, []);
    await waitForExportIdle();
  });

  it("changing the parent restructures the tree; an empty string detaches", async () => {
    const res = await call(editRpc, edit, { ...ws, id: B, fields: { parent: A } }, ctx);
    assert.equal(res.issue.parent, A);
    assert.equal((await call(treeRpc, tree, ws, ctx)).issues.find((i: any) => i.id === B).parent, A);
    await waitForExportIdle();
    const loop = await call(editRpc, edit, { ...ws, id: A, fields: { parent: B } }, ctx);
    assert.equal(loop.code, "bad_parent", "a loop must be refused");
    const detached = await call(editRpc, edit, { ...ws, id: B, fields: { parent: "" } }, ctx);
    assert.equal(detached.issue.parent, null);
    await waitForExportIdle();
  });

  it("a save does not force a redundant second tree fetch", async () => {
    await call(editRpc, edit, { ...ws, id: A, fields: { external_ref: "gh-1" } }, ctx);
    const revAfterWrite = (await call(revisionRpc, revision, ws, ctx)).revision;
    const exp = await waitForExportIdle();
    assert.equal(exp.supersededFrom, revAfterWrite, JSON.stringify(exp));
    assert.ok(exp.revision && exp.revision !== revAfterWrite);
  });

  it("invalid input is refused without touching bd; a workspace without .beads is no_beads", async () => {
    assert.equal((await call(editRpc, edit, { ...ws, id: A, fields: { status: "nope" } }, ctx)).code, "bad_status");
    assert.equal((await call(editRpc, edit, { ...ws, id: A, fields: { priority: 9 } }, ctx)).code, "bad_priority");
    assert.equal((await call(editRpc, edit, { ...ws, id: "tw-nope-9999", fields: { title: "x" } }, ctx)).code, "not_found");
    assert.equal((await call(editRpc, edit, { workspaceId: "bare", id: A, fields: { title: "x" } }, ctx)).code, "no_beads");
  });

  it("three saves in a row do not each get their own export", async () => {
    const before = (await call(jobStatusRpc, jobStatus, ws, ctx)).export.runs;
    await Promise.all(["gh-2", "gh-3", "gh-4"].map((v) =>
      call(editRpc, edit, { ...ws, id: A, fields: { external_ref: v } }, ctx)));
    const exp = await waitForExportIdle();
    assert.ok(exp.runs > before, "no export ran at all");
    assert.ok(exp.runs - before <= 3, `three saves triggered ${exp.runs - before} export run(s)`);
  });

  it("editing and creating leave dolt history untouched", () => {
    assert.equal(doltCommit(), initialDoltCommit, "a dolt commit landed during edits and creates");
  });

  // ── sync: the two halves drifting apart, both ways ──────────────────

  let doltBeforeSync = "";
  const syncAndWait = async () => {
    const res = await call(syncRpc, sync, ws, ctx);
    assert.equal(res.ok, true);
    return waitForExportIdle(60000);
  };

  it("a database ahead of the file wins, and the file catches up", async () => {
    doltBeforeSync = doltCommit();
    bd(["--dolt-auto-commit", "off", "update", A, "--title", "Only in the database"]);
    assert.notEqual(readJsonl().find((r) => r.id === A).title, "Only in the database");
    const state = await syncAndWait();
    assert.equal(state.lastImport?.error, null, JSON.stringify(state.lastImport));
    assert.ok((state.lastImport?.skippedStale ?? 0) >= 1, JSON.stringify(state.lastImport));
    assert.equal(readJsonl().find((r) => r.id === A).title, "Only in the database");
  });

  it("a file ahead of the database is pulled in", async () => {
    const rows = readJsonl();
    const row = rows.find((r) => r.id === B);
    row.title = "Only in the file";
    row.updated_at = new Date(Date.now() + 60000).toISOString().replace(/\.\d+Z$/, "Z");
    fs.writeFileSync(jsonlPath, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
    const state = await syncAndWait();
    assert.equal(state.lastImport?.error, null);
    assert.ok((state.lastImport?.changed ?? 0) >= 1, JSON.stringify(state.lastImport));
    assert.equal((await call(treeRpc, tree, ws, ctx)).issues.find((i: any) => i.id === B).title, "Only in the file");
  });

  it("an issue only the file has arrives in the database", async () => {
    const rows = readJsonl();
    const seed = rows.find((r) => r.id === A);
    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    rows.push({ ...seed, id: "tw-fromfile", title: "Arrived from the file", parent: null,
      created_at: now, updated_at: now, comments: [], comment_count: 0 });
    fs.writeFileSync(jsonlPath, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
    const state = await syncAndWait();
    assert.equal(state.lastImport?.error, null);
    assert.ok((state.lastImport?.added ?? 0) >= 1, JSON.stringify(state.lastImport));
    assert.ok((await call(treeRpc, tree, ws, ctx)).issues.some((i: any) => i.id === "tw-fromfile"));
  });

  it("both sides moving at once loses neither", async () => {
    bd(["--dolt-auto-commit", "off", "update", A, "--title", "Database moved again"]);
    const rows = readJsonl();
    const row = rows.find((r) => r.id === B);
    row.title = "File moved again";
    row.updated_at = new Date(Date.now() + 120000).toISOString().replace(/\.\d+Z$/, "Z");
    fs.writeFileSync(jsonlPath, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
    await syncAndWait();
    const issues = (await call(treeRpc, tree, ws, ctx)).issues;
    assert.equal(issues.find((i: any) => i.id === A).title, "Database moved again");
    assert.equal(issues.find((i: any) => i.id === B).title, "File moved again");
    const file = readJsonl();
    for (const id of [A, B]) assert.equal(file.find((r) => r.id === id).title, issues.find((i: any) => i.id === id).title);
  });

  it("syncing an already-agreeing project changes nothing", async () => {
    const before = fs.readFileSync(jsonlPath, "utf8");
    const state = await syncAndWait();
    assert.equal(state.lastImport?.error, null);
    assert.equal(state.lastImport?.added, 0);
    assert.equal(state.lastImport?.changed, 0);
    assert.equal(fs.readFileSync(jsonlPath, "utf8"), before);
  });

  it("the memory record survived every sync too", () => {
    assert.ok(readJsonl().some((r) => r._type === "memory"));
  });

  it("pulling the file in advances dolt history — bd import does that, not us", () => {
    // Measured: `bd import` writes a dolt commit whenever it changes a row,
    // even with --dolt-auto-commit off. Recorded so the day it changes, it shows.
    assert.notEqual(doltCommit(), doltBeforeSync);
  });

  it("no git commit happened and nothing was staged", () => {
    assert.equal(git(["log", "--oneline"]).trim(), initialGitLog, "a git commit landed during writes");
    // Porcelain v1: column one is the index. Never trim() before reading it.
    for (const line of git(["status", "--porcelain"]).split("\n").filter((l) => l)) {
      assert.ok(line[0] === " " || line[0] === "?", `something got staged: ${line}`);
    }
  });

  // ── export failure and recovery ─────────────────────────────────────

  it("a write lands though its export fails; the failure stays visible; a retry clears it", async () => {
    const wrapDir = tmpDir("pbd-write-wrap-");
    const realBd = execFileSync("which", ["bd"], { encoding: "utf8" }).trim();
    fs.writeFileSync(
      path.join(wrapDir, "bd"),
      `#!/bin/sh\nfor a in "$@"; do if [ "$a" = "export" ]; then echo "Error: injected export failure" >&2; exit 1; fi; done\nexec ${realBd} "$@"\n`,
    );
    fs.chmodSync(path.join(wrapDir, "bd"), 0o755);
    try {
      // Swap bd without a plugin reset: the export state must carry over.
      process.env.PATH = `${wrapDir}:${ORIGINAL_PATH}`;
      resetBdPath();
      const res = await call(editRpc, edit, { ...ws, id: A, fields: { notes: "edited during export outage" } }, ctx);
      assert.equal(res.ok, true);
      assert.equal(res.issue.notes, "edited during export outage");
      let exp = await waitForExportIdle();
      assert.ok(exp.lastError, "a failed export must report lastError");
      assert.equal(exp.stale, true);
      assert.ok(readJsonl().find((r) => r.id === A), "issues.jsonl was corrupted by the failed export");
      const rev = await call(revisionRpc, revision, ws, ctx);
      assert.equal(rev.export.stale, true);

      process.env.PATH = ORIGINAL_PATH;
      resetBdPath();
      assert.equal((await call(exportRpc, exportNow, ws, ctx)).ok, true);
      exp = await waitForExportIdle();
      assert.equal(exp.lastError, null);
      assert.equal(exp.stale, false);
      assert.equal(readJsonl().find((r) => r.id === A).notes, "edited during export outage");
    } finally {
      process.env.PATH = ORIGINAL_PATH;
      resetBdPath();
      fs.rmSync(wrapDir, { recursive: true, force: true });
    }
  });
});
