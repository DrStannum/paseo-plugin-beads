/**
 * The writing side's pure logic: the edit / create form's diff
 * (shared/form.ts), the host settings schema (shared/settings.ts) and the
 * export / sync badge (client/export-state.ts).
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EDIT_TYPES, addLabel, blankForm, computeFields, formFromCard, hasInput, isDirty, parentChoices, peopleOf, statusChoices, suggest, typeChoices,
} from "../shared/form.ts";
import { POLL_CHOICES, POLL_DEFAULT_MS, SETTINGS_DEFAULT, SettingsSchema, beadsSettings } from "../shared/settings.ts";
import type { Card, ExportStatus } from "../shared/types.ts";
import { EXPORT_DONE_MS, TRACK_INIT, badgeOf, inFlight, observed, requested } from "../client/export-state.ts";

const card = (over: Partial<Card> = {}): Card => ({
  id: "x-1", title: "Title", description: "desc", design: null, acceptance_criteria: null, notes: "n",
  status: "open", priority: 1, issue_type: "task", owner: "o@x", assignee: null, external_ref: "EXT-1", spec_id: null,
  labels: ["a", "b"], created_at: null, created_by: null, updated_at: null, started_at: null, closed_at: null,
  close_reason: "old reason", defer_until: null, parent: "x-0", dependency_count: 0, dependent_count: 0, comment_count: 0,
  blockers: [], activeBlockers: [], ready: true,
  relations: { parent: null, children: [], blockedBy: [], blocking: [], discoveredFrom: [], discovered: [], other: [] },
  comments: [], commentsAvailable: true, mode: "bd", ...over,
});

test("an untouched edit form sends nothing and is not dirty", () => {
  const o = formFromCard(card());
  assert.deepEqual(computeFields(o, o, false), {});
  assert.equal(isDirty(o, o, false), false);
  assert.equal(hasInput(o, o, false), false);
  // null text fields become "", and the close reason only rides along a closed issue
  assert.equal(o.design, "");
  assert.equal(o.close_reason, "");
});

test("an edit sends exactly the changed fields", () => {
  const o = formFromCard(card());
  const f = {
    ...o, title: "  New title ", priority: 3, assignee: " me@x ", parent: "", external_ref: "EXT-1",
    labels: ["b", "c"], notes: "", design: "d",
  };
  assert.deepEqual(computeFields(o, f, false), {
    title: "New title", priority: 3, assignee: "me@x", parent: "", addLabels: ["c"], removeLabels: ["a"], design: "d", notes: "",
  });
  assert.ok(isDirty(o, f, false));
});

test("a blank title is never sent; a status move to closed carries the reason", () => {
  const o = formFromCard(card());
  assert.deepEqual(computeFields(o, { ...o, title: "   " }, false), {});
  assert.deepEqual(computeFields(o, { ...o, status: "closed", close_reason: " done " }, false), { status: "closed", close_reason: "done" });
  assert.deepEqual(computeFields(o, { ...o, status: "in_progress", close_reason: "ignored" }, false), { status: "in_progress" });
  // a closed issue opens with its reason; reopening does not send it
  const c = formFromCard(card({ status: "closed" }));
  assert.equal(c.close_reason, "old reason");
  assert.deepEqual(computeFields(c, { ...c, status: "open" }, false), { status: "open" });
});

test("priority: unset never goes out as a change", () => {
  const o = formFromCard(card({ priority: null }));
  assert.deepEqual(computeFields(o, o, false), {});
  assert.deepEqual(computeFields(o, { ...o, priority: 0 }, false), { priority: 0 });
});

test("create sends the whole form, blanks left out", () => {
  const o = blankForm("x-0");
  assert.equal(o.parent, "x-0");
  assert.equal(o.issue_type, "task");
  assert.equal(o.priority, 2);
  assert.equal(isDirty(o, o, true), false, "no title, nothing to create");
  const f = { ...o, title: " T ", labels: ["l"], description: "D", assignee: " " };
  assert.deepEqual(computeFields(o, f, true), { title: "T", issue_type: "task", priority: 2, parent: "x-0", labels: ["l"], description: "D" });
  assert.ok(isDirty(o, f, true));
  // a description without a title is not savable, but it is input a stray click must not lose
  const g = { ...o, description: "D" };
  assert.equal(isDirty(o, g, true), false);
  assert.equal(hasInput(o, g, true), true);
});

test("option lists and suggestions", () => {
  assert.deepEqual(addLabel(["a"], " b "), ["a", "b"]);
  assert.deepEqual(addLabel(["a"], "a"), ["a"]);
  assert.deepEqual(addLabel(["a"], "  "), ["a"]);
  assert.deepEqual(typeChoices(["task", "custom"], "weird"), EDIT_TYPES.concat("custom", "weird"));
  assert.deepEqual(statusChoices([], "pinned"), ["open", "in_progress", "blocked", "deferred", "closed", "pinned"]);
  assert.deepEqual(statusChoices([], "open"), ["open", "in_progress", "blocked", "deferred", "closed"]);
  assert.deepEqual(suggest(["Alpha", "beta", "gamma"], "A", ["gamma"]), ["Alpha", "beta"]);
  assert.deepEqual(suggest(["a", "b", "c"], "", [], 2), ["a", "b"]);
  assert.deepEqual(peopleOf([{ assignee: "b", owner: "a" }, { assignee: null, owner: "b" }]), ["a", "b"]);
  const rows = [{ id: "x-1", title: "One" }, { id: "x-2", title: "Two" }, { id: "y-3", title: "three x" }];
  assert.deepEqual(parentChoices(rows, "x-1", "x").map((r) => r.id), ["x-2", "y-3"]);
  assert.deepEqual(parentChoices(rows, null, "two").map((r) => r.id), ["x-2"]);
});

test("settings: defaults, and each field falls back on its own", () => {
  assert.equal(beadsSettings.id, "beads");
  assert.equal(beadsSettings.scope, "host");
  assert.deepEqual(SettingsSchema.parse({}), SETTINGS_DEFAULT);
  assert.deepEqual(SETTINGS_DEFAULT, { currentUser: "", pollMs: POLL_DEFAULT_MS });
  assert.deepEqual(SettingsSchema.parse({ currentUser: "me", pollMs: 12345 }), { currentUser: "me", pollMs: POLL_DEFAULT_MS });
  assert.deepEqual(SettingsSchema.parse({ currentUser: 7, pollMs: POLL_CHOICES[0] }), { currentUser: "", pollMs: POLL_CHOICES[0] });
});

const st = (over: Partial<ExportStatus> = {}): ExportStatus => ({
  running: false, pending: false, lastOkAt: null, lastError: null, lastDurationMs: null, runs: 0,
  supersededFrom: null, revision: null, lastImport: null, syncing: false, stale: false, ...over,
});

test("export badge: an idle project shows nothing; a seen run flashes done, then goes", () => {
  let t = observed(TRACK_INIT, st(), 0);
  assert.deepEqual(badgeOf(t, 0), { kind: "none" });
  t = observed(t, st({ running: true, runs: 0 }), 100);
  assert.deepEqual(badgeOf(t, 100), { kind: "running", syncing: false });
  t = observed(t, st({ runs: 1 }), 200);
  assert.deepEqual(badgeOf(t, 300), { kind: "done", imported: null });
  assert.deepEqual(badgeOf(t, 200 + EXPORT_DONE_MS + 1), { kind: "none" });
});

test("export badge: Sync is running from the press until a later run finishes, then reports the import", () => {
  let t = observed(TRACK_INIT, st({ runs: 4 }), 0);
  t = requested(t, true);
  assert.ok(inFlight(t));
  assert.deepEqual(badgeOf(t, 10), { kind: "running", syncing: true });
  // the next poll still shows the old run: not done yet
  t = observed(t, st({ runs: 4, lastOkAt: 1 }), 20);
  assert.deepEqual(badgeOf(t, 20), { kind: "running", syncing: true });
  const imp = { at: 1, changed: 2, added: 1, skippedStale: 0, error: null };
  t = observed(t, st({ runs: 5, lastImport: imp }), 30);
  assert.equal(inFlight(t), false);
  assert.deepEqual(badgeOf(t, 40), { kind: "done", imported: imp });
  assert.equal(t.syncWanted, false);
});

test("export badge: a failed export is stale until retried", () => {
  let t = observed(TRACK_INIT, st({ runs: 1, lastError: "boom" }), 0);
  assert.deepEqual(badgeOf(t, 0), { kind: "stale", error: "boom" });
  t = requested(t, false);
  assert.deepEqual(badgeOf(t, 1), { kind: "running", syncing: false });
  t = observed(t, st({ runs: 2 }), 2);
  assert.deepEqual(badgeOf(t, 3), { kind: "done", imported: null });
});

test("export badge: the export a save asked for flashes done even when no poll saw it running", () => {
  let t = observed(TRACK_INIT, st({ runs: 3 }), 0);
  t = requested(t, false); // the write landed: its export is ours
  t = observed(t, st({ runs: 4, lastOkAt: 5 }), 50); // already over by the first look
  assert.deepEqual(badgeOf(t, 60), { kind: "done", imported: null });
  assert.equal(inFlight(t), false);
});
