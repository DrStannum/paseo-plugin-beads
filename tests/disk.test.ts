/**
 * The on-disk snapshot store (server/beads/disk.ts): owner-only permissions,
 * atomic writes, files that cannot be used are dropped, the size limits and
 * the sweep. Everything runs in a temporary CBD_CACHE_DIR — never the real
 * ~/.paseo.
 */

import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FORMAT, cacheDir, cacheFileFor, cancelPendingSaves, diskTuning, dropProject, flushPendingSaves, readSnapshot,
  saveSnapshot, scheduleSave, sweep, touch,
} from "../server/beads/disk.ts";
import { countUp, indexIssues, normalize, type Issue } from "../server/beads/issues.ts";
import type { Snapshot } from "../server/beads/snapshot.ts";
import { captureLogs, tmpDir } from "./support/harness.ts";

const DISK_TS = fileURLToPath(new URL("../server/beads/disk.ts", import.meta.url));
const ORIGINAL_ENV = process.env.CBD_CACHE_DIR;
const DEFAULTS = { ...diskTuning };
const logs = captureLogs();

const base = tmpDir("pbd-disk-");
const CACHE = path.join(base, "plugin-data", "beads");
process.env.CBD_CACHE_DIR = CACHE;

after(() => {
  logs.restore();
  if (ORIGINAL_ENV === undefined) delete process.env.CBD_CACHE_DIR;
  else process.env.CBD_CACHE_DIR = ORIGINAL_ENV;
  fs.rmSync(base, { recursive: true, force: true });
});
afterEach(() => {
  Object.assign(diskTuning, DEFAULTS);
  cancelPendingSaves();
});

/** Text that must never reach a log line. */
const SECRETS = ["Secret disk title", "disk-needle-in-description", "disk-design-token"];

function raw(): any[] {
  return [
    { id: "dk-1", title: SECRETS[0], description: SECRETS[1], design: SECRETS[2], status: "open", priority: 1, issue_type: "epic", labels: ["area:x"], created_at: "2026-01-01T00:00:00Z" },
    { id: "dk-2", title: "Child", status: "in_progress", issue_type: "task", assignee: "sam", dependencies: [{ issue_id: "dk-2", depends_on_id: "dk-1", type: "parent-child" }] },
    { id: "dk-3", title: "Blocked", status: "open", dependencies: [{ depends_on_id: "dk-2", type: "blocks" }, { depends_on_id: "dk-1", type: "parent-child" }] },
    { id: "dk-4", title: "Orphan", status: "closed", parent: "dk-gone", closed_at: "2026-02-01T00:00:00Z", close_reason: "done", comment_count: 2 },
  ];
}

let n = 0;
function project(): { root: string; beadsDir: string } {
  const root = path.join(base, `p${++n}`);
  const beadsDir = path.join(root, ".beads");
  fs.mkdirSync(beadsDir, { recursive: true });
  return { root, beadsDir };
}

function snap(beadsDir: string, revision = "rev-a", extra: Partial<Snapshot> = {}, rows = raw()): Snapshot {
  const issues = rows.map(normalize).filter((i): i is Issue => i !== null);
  const { byId, roots } = indexIssues(issues);
  return {
    revision, mode: "bd", root: path.dirname(beadsDir), beadsDir, prefix: "dk", issues, byId, roots,
    counts: countUp(issues), warnings: ["one warning"], error: null, loadedAt: 1_760_000_000_000,
    commentCache: new Map(), ...extra,
  };
}

const mode = (p: string) => fs.statSync(p).mode & 0o777;
const dropped = () => logs.lines.filter((l) => l.includes("dropped"));

describe("disk snapshot store", () => {
  let oldUmask = 0;
  before(() => {
    oldUmask = process.umask(0); // the widest umask: the modes must come from the code
  });
  after(() => {
    process.umask(oldUmask);
    for (const line of logs.lines) for (const secret of SECRETS) assert.ok(!line.includes(secret), `a log line carries issue text: ${line}`);
  });
  beforeEach(() => {
    logs.lines.length = 0;
  });

  it("lives under CBD_CACHE_DIR, one hashed file per project", () => {
    const { root, beadsDir } = project();
    assert.equal(cacheDir(), CACHE);
    const file = cacheFileFor(beadsDir);
    assert.equal(path.dirname(file), CACHE);
    assert.match(path.basename(file), /^[0-9a-f]{24}\.json$/, "a hash, no project name");
    assert.ok(!file.includes(path.basename(root)));
    assert.equal(cacheFileFor(beadsDir + "/"), file, "the same .beads, the same file");
    assert.notEqual(cacheFileFor(project().beadsDir), file);
  });

  it("without CBD_CACHE_DIR it is PASEO_HOME/plugin-data/beads", () => {
    const saved = { cbd: process.env.CBD_CACHE_DIR, home: process.env.PASEO_HOME };
    try {
      delete process.env.CBD_CACHE_DIR;
      process.env.PASEO_HOME = path.join(base, "paseo-home");
      assert.equal(cacheDir(), path.join(base, "paseo-home", "plugin-data", "beads"));
    } finally {
      process.env.CBD_CACHE_DIR = saved.cbd;
      if (saved.home === undefined) delete process.env.PASEO_HOME;
      else process.env.PASEO_HOME = saved.home;
    }
  });

  it("creates the directory 0700 and files 0600, even over a wider directory", () => {
    fs.mkdirSync(CACHE, { recursive: true, mode: 0o755 });
    fs.chmodSync(CACHE, 0o755);
    const { beadsDir } = project();
    assert.equal(saveSnapshot(snap(beadsDir)), true);
    assert.equal(mode(CACHE), 0o700);
    assert.equal(mode(cacheFileFor(beadsDir)), 0o600);
    // An existing file of the wrong mode is replaced, not reused.
    fs.chmodSync(cacheFileFor(beadsDir), 0o644);
    assert.equal(saveSnapshot(snap(beadsDir, "rev-b")), true);
    assert.equal(mode(cacheFileFor(beadsDir)), 0o600);
  });

  it("reads back what it saved, graph rebuilt the same", () => {
    const { beadsDir } = project();
    const s = snap(beadsDir);
    assert.equal(saveSnapshot(s), true);
    const back = readSnapshot(beadsDir);
    assert.ok(back);
    assert.equal(back.format, FORMAT);
    assert.equal(back.beadsDir, beadsDir);
    assert.equal(back.revision, "rev-a");
    assert.equal(back.mode, "bd");
    assert.equal(back.prefix, "dk");
    assert.deepEqual(back.warnings, ["one warning"]);
    assert.equal(back.savedAt, s.loadedAt);
    // Graph fields come back empty and indexIssues fills them exactly as before.
    assert.deepEqual(back.issues.map((i) => i.childIds), [[], [], [], []]);
    const { byId, roots } = indexIssues(back.issues);
    assert.deepEqual(back.issues, s.issues);
    assert.deepEqual(roots, s.roots);
    assert.deepEqual([...byId.keys()], [...s.byId.keys()]);
    assert.deepEqual(countUp(back.issues), s.counts);
    // The graph is not stored: it is rebuilt.
    const stored = JSON.parse(fs.readFileSync(cacheFileFor(beadsDir), "utf8"));
    assert.equal("childIds" in stored.issues[0], false);
    assert.equal("byId" in stored || "roots" in stored || "commentCache" in stored, false);
  });

  it("a jsonl snapshot keeps its mode", () => {
    const { beadsDir } = project();
    saveSnapshot(snap(beadsDir, "rev-j", { mode: "jsonl", prefix: null, warnings: [] }));
    const back = readSnapshot(beadsDir);
    assert.equal(back?.mode, "jsonl");
    assert.equal(back?.prefix, null);
  });

  it("no file is null, quietly", () => {
    const { beadsDir } = project();
    assert.equal(readSnapshot(beadsDir), null);
    assert.equal(logs.lines.length, 0);
  });

  it("does not save a failed load or a stale stand-in", () => {
    const { beadsDir } = project();
    assert.equal(saveSnapshot(snap(beadsDir, "r", { error: { code: "timeout", message: "x" } })), false);
    assert.equal(saveSnapshot(snap(beadsDir, "r", { stale: { code: "timeout", message: "x", at: 1 } })), false);
    assert.equal(fs.existsSync(cacheFileFor(beadsDir)), false);
  });

  const broken: Array<[string, (good: string) => string, string]> = [
    ["broken JSON", () => "{not json", "bad_json"],
    ["a truncated file", (good) => good.slice(0, Math.floor(good.length / 2)), "bad_json"],
    ["another format", (good) => JSON.stringify({ ...JSON.parse(good), format: FORMAT + 1 }), "other_format"],
    ["another project's file", (good) => JSON.stringify({ ...JSON.parse(good), beadsDir: "/elsewhere/.beads" }), "other_project"],
    ["the wrong shape", (good) => JSON.stringify({ ...JSON.parse(good), issues: { not: "an array" } }), "bad_shape"],
    ["a mode it does not know", (good) => JSON.stringify({ ...JSON.parse(good), mode: "sqlite" }), "bad_shape"],
    ["an issue without an id", (good) => {
      const j = JSON.parse(good);
      j.issues.push({ title: "no id" });
      return JSON.stringify(j);
    }, "bad_issue"],
    ["an array at the top", () => "[]", "bad_shape"],
  ];
  for (const [what, spoil, why] of broken) {
    it(`${what} reads as null and the file is dropped`, () => {
      const { beadsDir } = project();
      saveSnapshot(snap(beadsDir));
      const file = cacheFileFor(beadsDir);
      fs.writeFileSync(file, spoil(fs.readFileSync(file, "utf8")));
      assert.equal(readSnapshot(beadsDir), null);
      assert.equal(fs.existsSync(file), false);
      assert.equal(dropped().length, 1);
      assert.ok(dropped()[0]!.includes(`(${why})`), dropped()[0]);
      // and the next save starts clean
      assert.equal(saveSnapshot(snap(beadsDir, "rev-b")), true);
      assert.equal(readSnapshot(beadsDir)?.revision, "rev-b");
    });
  }

  it("a file over the size limit is not read", () => {
    const { beadsDir } = project();
    saveSnapshot(snap(beadsDir));
    diskTuning.maxFileBytes = 100;
    assert.equal(readSnapshot(beadsDir), null);
    assert.equal(fs.existsSync(cacheFileFor(beadsDir)), false);
    assert.ok(dropped()[0]!.includes("(too_big)"));
  });

  it("a snapshot over the size limit is not cached, and the older file goes", () => {
    const { beadsDir } = project();
    assert.equal(saveSnapshot(snap(beadsDir)), true);
    const size = fs.statSync(cacheFileFor(beadsDir)).size;
    diskTuning.maxFileBytes = size - 1;
    assert.equal(saveSnapshot(snap(beadsDir, "rev-b")), false);
    assert.equal(fs.existsSync(cacheFileFor(beadsDir)), false);
    assert.ok(logs.lines.some((l) => l.includes("too big, not cached")), logs.lines.join("\n"));
    diskTuning.maxFileBytes = size + 100;
    assert.equal(saveSnapshot(snap(beadsDir, "rev-c")), true);
  });

  it("a write cut short leaves a temp file no read sees, and sweep removes it once old", () => {
    const { beadsDir } = project();
    saveSnapshot(snap(beadsDir, "rev-a"));
    const file = cacheFileFor(beadsDir);
    // what a process killed mid-write leaves: half of a newer snapshot
    const half = JSON.stringify({ format: FORMAT, beadsDir, revision: "rev-b" }).slice(0, 20);
    const oldTmp = `${file}.4242.deadbeef.tmp`;
    const newTmp = `${file}.4243.cafebabe.tmp`;
    fs.writeFileSync(oldTmp, half);
    fs.writeFileSync(newTmp, half);
    const longAgo = new Date(Date.now() - diskTuning.tmpMaxAgeMs - 5000);
    fs.utimesSync(oldTmp, longAgo, longAgo);
    assert.equal(readSnapshot(beadsDir)?.revision, "rev-a");
    const res = sweep();
    assert.equal(fs.existsSync(oldTmp), false);
    assert.equal(fs.existsSync(newTmp), true, "a write in progress is left alone");
    assert.equal(fs.existsSync(file), true);
    assert.ok(res.removed >= 1);
    fs.rmSync(newTmp);
  });

  it("dropProject removes the file and a save still waiting for its turn", () => {
    const { beadsDir } = project();
    saveSnapshot(snap(beadsDir));
    dropProject(beadsDir);
    assert.equal(fs.existsSync(cacheFileFor(beadsDir)), false);
    scheduleSave(snap(beadsDir, "rev-later"));
    dropProject(beadsDir);
    flushPendingSaves();
    assert.equal(fs.existsSync(cacheFileFor(beadsDir)), false);
    dropProject(beadsDir); // nothing there: no throw
  });

  it("scheduleSave writes once, on the next turn, the last snapshot", async () => {
    const { beadsDir } = project();
    scheduleSave(snap(beadsDir, "rev-1"));
    scheduleSave(snap(beadsDir, "rev-2"));
    scheduleSave(snap(beadsDir, "rev-3", { error: { code: "timeout", message: "x" } })); // ignored
    assert.equal(fs.existsSync(cacheFileFor(beadsDir)), false, "not inside the caller's turn");
    await new Promise((r) => setImmediate(r));
    assert.equal(readSnapshot(beadsDir)?.revision, "rev-2");
    scheduleSave(snap(beadsDir, "rev-4"));
    cancelPendingSaves();
    await new Promise((r) => setImmediate(r));
    assert.equal(readSnapshot(beadsDir)?.revision, "rev-2");
  });
});

describe("sweep", () => {
  let dir = "";
  beforeEach(() => {
    logs.lines.length = 0;
    dir = path.join(base, `sweep${++n}`);
    process.env.CBD_CACHE_DIR = dir;
  });
  afterEach(() => {
    process.env.CBD_CACHE_DIR = CACHE;
  });

  const ageDays = (file: string, days: number) => {
    const t = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    fs.utimesSync(file, t, t);
  };

  it("an empty or missing directory is nothing to do", () => {
    assert.deepEqual(sweep(), { removed: 0, freedBytes: 0, kept: 0, keptBytes: 0 });
    assert.equal(logs.lines.length, 0);
  });

  it("removes projects idle longer than maxIdleDays; touch keeps one", () => {
    const a = project().beadsDir;
    const b = project().beadsDir;
    const c = project().beadsDir;
    for (const d of [a, b, c]) saveSnapshot(snap(d));
    ageDays(cacheFileFor(a), 40);
    ageDays(cacheFileFor(b), 40);
    ageDays(cacheFileFor(c), 5);
    touch(b, { force: true });
    const res = sweep({ maxIdleDays: 30 });
    assert.equal(fs.existsSync(cacheFileFor(a)), false);
    assert.equal(fs.existsSync(cacheFileFor(b)), true, "touched today");
    assert.equal(fs.existsSync(cacheFileFor(c)), true);
    assert.equal(res.removed, 1);
    assert.equal(res.kept, 2);
    assert.ok(logs.lines.some((l) => l.includes("swept 1 file(s)")));
  });

  it("a successful read counts as a use", () => {
    const a = project().beadsDir;
    saveSnapshot(snap(a));
    ageDays(cacheFileFor(a), 40);
    assert.ok(readSnapshot(a));
    sweep({ maxIdleDays: 30 });
    assert.equal(fs.existsSync(cacheFileFor(a)), true);
  });

  it("touch writes the time at most once per touchEveryMs", () => {
    const a = project().beadsDir;
    saveSnapshot(snap(a)); // a save is a use: the next plain touch is throttled
    ageDays(cacheFileFor(a), 3);
    touch(a);
    assert.ok(Date.now() - fs.statSync(cacheFileFor(a)).mtimeMs > 2 * 24 * 3600 * 1000, "throttled");
    diskTuning.touchEveryMs = 0;
    touch(a);
    assert.ok(Date.now() - fs.statSync(cacheFileFor(a)).mtimeMs < 60_000);
    touch(project().beadsDir); // no file: nothing, no log
    assert.equal(logs.lines.length, 0);
  });

  it("drops the least recently used until the total fits", () => {
    const ds = [project().beadsDir, project().beadsDir, project().beadsDir, project().beadsDir];
    ds.forEach((d) => saveSnapshot(snap(d)));
    // used 4, 3, 2, 1 days ago: ds[0] is the oldest
    ds.forEach((d, i) => ageDays(cacheFileFor(d), 4 - i));
    const size = fs.statSync(cacheFileFor(ds[0]!)).size;
    const res = sweep({ maxTotalBytes: size * 2 + 10 });
    assert.deepEqual(ds.map((d) => fs.existsSync(cacheFileFor(d))), [false, false, true, true]);
    assert.equal(res.removed, 2);
    assert.equal(res.kept, 2);
    assert.ok(res.keptBytes <= size * 2 + 10);
    assert.equal(res.freedBytes, size * 2);
  });

  it("leaves files it did not name alone", () => {
    const a = project().beadsDir;
    saveSnapshot(snap(a));
    const other = path.join(dir, "notes.txt");
    const looksClose = path.join(dir, "abc.json");
    fs.writeFileSync(other, "x");
    fs.writeFileSync(looksClose, "{}");
    ageDays(other, 400);
    ageDays(looksClose, 400);
    ageDays(cacheFileFor(a), 400);
    sweep({ maxTotalBytes: 0 });
    assert.equal(fs.existsSync(cacheFileFor(a)), false);
    assert.equal(fs.existsSync(other), true);
    assert.equal(fs.existsSync(looksClose), true);
  });
});

describe("two processes saving at once", () => {
  it("leave one whole file of one of the two revisions", async () => {
    const dir = path.join(base, "race");
    const beadsDir = path.join(base, "race-project", ".beads");
    fs.mkdirSync(beadsDir, { recursive: true });
    // Big enough that a write takes a while: a mix would show as broken JSON.
    const child = (revision: string) => new Promise<number>((resolve, reject) => {
      const code = `
        const { saveSnapshot } = await import(${JSON.stringify(DISK_TS)});
        const rows = Array.from({ length: 400 }, (_, i) => ({ id: "rc-" + i, title: "Row " + i, description: process.env.REV.repeat(300) }));
        const issues = rows.map((r) => ({ ...r, design: null, acceptance_criteria: null, notes: null,
          status: "open", priority: 2, issue_type: "task", owner: null, assignee: null, external_ref: null, spec_id: null,
          labels: [], created_at: null, created_by: null, updated_at: null, started_at: null, closed_at: null,
          close_reason: null, defer_until: null, parent: null, links: [], dependency_count: 0, dependent_count: 0,
          comment_count: 0, blockers: [], activeBlockers: [], ready: true, childIds: [], incoming: [] }));
        let ok = 0;
        for (let k = 0; k < 25; k++) {
          if (saveSnapshot({ revision: process.env.REV, mode: "bd", root: "", beadsDir: process.env.BEADS, prefix: "rc",
            issues, warnings: [], error: null, loadedAt: Date.now() })) ok++;
        }
        process.exit(ok === 25 ? 0 : 3);
      `;
      const p = spawn(process.execPath, ["--input-type=module", "-e", code], {
        env: { ...process.env, CBD_CACHE_DIR: dir, BEADS: beadsDir, REV: revision },
        stdio: ["ignore", "ignore", "inherit"],
      });
      p.on("error", reject);
      p.on("close", (c) => resolve(c ?? -1));
    });

    process.env.CBD_CACHE_DIR = dir;
    try {
      const file = cacheFileFor(beadsDir);
      const seen = new Set<string>();
      let reading = true;
      const reader = (async () => {
        while (reading) {
          try {
            const text = fs.readFileSync(file, "utf8");
            seen.add(JSON.parse(text).revision); // throws on a torn file
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          }
          await new Promise((r) => setImmediate(r));
        }
      })();
      let codes: number[];
      try {
        codes = await Promise.all([child("rev-one"), child("rev-two")]);
      } finally {
        reading = false;
      }
      await reader;
      assert.deepEqual(codes, [0, 0]);
      for (const r of seen) assert.ok(r === "rev-one" || r === "rev-two", r);
      const back = readSnapshot(beadsDir);
      assert.ok(back && (back.revision === "rev-one" || back.revision === "rev-two"));
      assert.equal(back.issues.length, 400);
      assert.deepEqual(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp")), [], "no temp file left behind");
    } finally {
      process.env.CBD_CACHE_DIR = CACHE;
    }
  });
});
