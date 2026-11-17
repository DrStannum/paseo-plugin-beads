/**
 * The vocabulary every chart reading shares: the row it is computed from, the
 * steps and periods it is cut on, and the constants the reference tab fixed
 * (cloudcli-plugin-beads, dist/index.js — the top of the file).
 *
 * Pure: no DOM, no clock. Every reading that depends on "now" takes it as a
 * parameter, so a fixture with fixed dates gives the same numbers every run.
 */

/**
 * What the charts read off one issue.
 *
 * A structural subset of the tree row the server sends (TreeRow in
 * shared/types.ts): a TreeRow is a ChartRow, and so is a row of an older
 * projection that never carried some of the optional fields — the readings
 * treat a missing field as an empty one, as the reference does.
 */
export interface ChartRow {
  id: string;
  status: string;
  issue_type?: string | null;
  priority?: number | null;
  assignee?: string | null;
  created_by?: string | null;
  labels?: string[] | null;
  created_at?: string | null;
  updated_at?: string | null;
  started_at?: string | null;
  closed_at?: string | null;
  ready?: boolean | null;
  blockers?: string[] | null;
}

/** How wide one bucket of a series is. */
export type Step = "day" | "week" | "month";
/** A step the reader can pin; "auto" leaves it to the period. */
export type PinnedStep = "auto" | Step;
/** Days back, or null for the whole history. */
export type Period = number | null;

export const DAY_MS = 86400000;

/** bd's own status order. */
export const STATUS_ORDER: readonly string[] = ["open", "in_progress", "blocked", "deferred", "closed"];

/** The issue types the tab knows, in the order the type breakdown draws them. */
export const TYPE_ORDER: readonly string[] = [
  "epic", "feature", "bug", "task", "chore", "decision", "merge-request", "molecule", "gate", "convoy",
];

/** Named buckets a ranked cut (assignees, tags) draws before folding the rest into "other". */
export const CHART_TAIL_N = 8;

/** The readings the charts view offers. */
export const CHART_TABS: readonly ("cuts" | "flow" | "people" | "authors")[] = ["cuts", "flow", "people", "authors"];
export type ChartTab = (typeof CHART_TABS)[number];

/** Step widths a reader can pin the series to. */
export const CHART_STEPS: readonly PinnedStep[] = ["auto", "day", "week", "month"];

/** Periods the time readings offer, in days; null is the whole history. */
export const CHART_PERIODS: readonly Period[] = [30, 90, 180, null];

/**
 * Most points a series will draw. Past this a pinned step keeps its width and
 * the series drops its oldest end instead, and says how much it dropped.
 */
export const CHART_MAX_POINTS = 180;

/** The ages a cohort is followed to, in steps. */
export const COHORT_AGES: readonly number[] = [1, 2, 4];

/** How many cohorts the table shows (the most recent ones). */
export const COHORT_ROWS = 12;

/** Days an issue can sit in progress before its age is flagged. */
export const STALE_WIP_DAYS = 14;
