/**
 * The delta base ring (server/beads/history.ts): the pure diff, the size
 * limit that turns a delta into a full answer, and the ring itself — how
 * many revisions it keeps, and that a revision seen with two row sets stops
 * being a base.
 */

import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clearHistory, deltaFrom, deltaLimit, diffRows, historyTuning, remember, rememberedOf, rowHash, rowsOf,
} from "../server/beads/history.ts";
import type { Issue } from "../server/beads/issues.ts";

/** Just enough of an Issue for treeRow. */
function issue(id: string, over: Partial<Issue> = {}): Issue {
  return {
    id, title: `Title ${id}`, status: "open", priority: 2, issue_type: "task", parent: null, labels: [],
    assignee: null, owner: null, created_at: null, created_by: null, updated_at: null, started_at: null,
    closed_at: null, dependency_count: 0, dependent_count: 0, comment_count: 0, activeBlockers: [], ready: true,
    ...over,
  } as unknown as Issue;
}

const many = (n: number) => Array.from({ length: n }, (_, i) => issue(`h-${i + 1}`));
const tuned = { ...historyTuning };
afterEach(() => {
  Object.assign(historyTuning, tuned);
  clearHistory();
});

describe("diffRows", () => {
  const base = many(10);

  it("nothing moved: an empty delta", () => {
    assert.deepEqual(diffRows(rowsOf(base).hashes, rowsOf(many(10)), 50), { upsert: [], removed: [] });
  });

  it("a changed, an added and a removed row; rows in the new order, removed in the old", () => {
    const next = base.filter((i) => i.id !== "h-3" && i.id !== "h-7").map((i) => (i.id === "h-5" ? issue("h-5", { title: "renamed" }) : i));
    next.push(issue("h-11"));
    const d = diffRows(rowsOf(base).hashes, rowsOf(next), 50)!;
    assert.deepEqual(d.upsert.map((r) => [r.id, r.title]), [["h-5", "renamed"], ["h-11", "Title h-11"]]);
    assert.deepEqual(d.removed, ["h-3", "h-7"]);
  });

  it("every field of the row counts, not only updated_at", () => {
    const next = base.map((i) => (i.id === "h-2" ? issue("h-2", { ready: false, activeBlockers: ["h-1"] }) : i));
    assert.deepEqual(diffRows(rowsOf(base).hashes, rowsOf(next), 50)!.upsert.map((r) => r.id), ["h-2"]);
  });

  it("past the limit — counting upserts and removals together — no delta", () => {
    const next = base.slice(2).map((i) => (i.id === "h-4" ? issue("h-4", { status: "closed" }) : i));
    assert.ok(diffRows(rowsOf(base).hashes, rowsOf(next), 3));
    assert.equal(diffRows(rowsOf(base).hashes, rowsOf(next), 2), null);
  });

  it("the limit is max(minRows, share × issues)", () => {
    assert.equal(deltaLimit(10), 50);
    assert.equal(deltaLimit(4000), 800);
  });

  it("row hashes are stable and short; rows are projected once per issue set", () => {
    const rows = rowsOf(base);
    assert.equal(rowsOf(base), rows);
    assert.equal(rowHash(rows.rows[0]!), rowHash({ ...rows.rows[0]! }));
    assert.ok(rowHash(rows.rows[0]!).length <= 12);
    assert.notEqual(rowHash(rows.rows[0]!), rowHash(rows.rows[1]!));
  });
});

describe("the ring of remembered revisions", () => {
  it("a delta from a remembered revision; an unknown one or a changed mode gives none", () => {
    const a = many(5);
    remember("/p", "rev-a", "bd", a);
    const b = a.map((i) => (i.id === "h-1" ? issue("h-1", { priority: 0 }) : i));
    assert.deepEqual(deltaFrom("/p", "rev-a", "bd", b)!.upsert.map((r) => r.id), ["h-1"]);
    assert.equal(deltaFrom("/p", "rev-x", "bd", b), null);
    assert.equal(deltaFrom("/p", "rev-a", "jsonl", b), null);
    assert.equal(deltaFrom("/other", "rev-a", "bd", b), null);
  });

  it("a big gap gives none", () => {
    historyTuning.minRows = 2;
    historyTuning.share = 0;
    const a = many(20);
    remember("/p", "rev-a", "bd", a);
    assert.equal(deltaFrom("/p", "rev-a", "bd", a.slice(3)), null);
    assert.ok(deltaFrom("/p", "rev-a", "bd", a.slice(2)));
  });

  it(`keeps the newest ${historyTuning.keep}; seeing a revision again moves it to the front`, () => {
    const set = many(3);
    for (let i = 1; i <= historyTuning.keep + 2; i++) remember("/p", `r${i}`, "bd", set);
    const kept = rememberedOf("/p");
    assert.equal(kept.length, historyTuning.keep);
    assert.equal(kept[0], `r${historyTuning.keep + 2}`);
    assert.ok(!kept.includes("r1") && !kept.includes("r2"));
    remember("/p", "r3", "bd", set);
    assert.equal(rememberedOf("/p")[0], "r3");
    assert.equal(rememberedOf("/p").length, historyTuning.keep);
  });

  it("the same rows under a revision again (disk copy, then bd): still a base", () => {
    remember("/p", "rev-a", "bd", many(4));
    remember("/p", "rev-a", "bd", many(4));
    assert.ok(deltaFrom("/p", "rev-a", "bd", many(4)));
  });

  it("a revision seen with two different row sets is no base any more", () => {
    remember("/p", "rev-a", "bd", many(4));
    remember("/p", "rev-a", "bd", many(5));
    assert.equal(deltaFrom("/p", "rev-a", "bd", many(5)), null);
    remember("/p", "rev-a", "bd", many(5));
    assert.equal(deltaFrom("/p", "rev-a", "bd", many(5)), null, "it stays ambiguous");
  });
});
