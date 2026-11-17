/**
 * The board's pure half (reference renderBoard / boardColumn / the drag code):
 * which lanes exist, which cards each draws, and the drag arithmetic. No
 * React here, so the tests run it under node.
 */

import { STATUS_ORDER } from "./charts/types.ts";
import type { TreeRow } from "./types.ts";

/** Cards a lane draws before "N more"; each press draws this many more. */
export const BOARD_PAGE = 50;
/** How far the pointer travels before a press on a card becomes a drag. */
export const DRAG_SLOP = 4;

export interface Lane {
  status: string;
  /** Every row of the lane that passes the filters, sorted. */
  rows: TreeRow[];
}

/**
 * One lane per status the project has (closed only when the reader shows
 * closed issues), the statuses bd knows in their own order, then custom ones
 * alphabetically. Which lanes exist is decided by the project, not by the
 * filter: a lane a filter emptied stays on screen, and stays a drop target.
 */
export function buildLanes(
  rows: readonly TreeRow[],
  passes: (row: TreeRow) => boolean,
  showClosed: boolean,
  cmp: (a: TreeRow, b: TreeRow) => number,
): Lane[] {
  const seen = new Set<string>();
  for (const row of rows) {
    if (row.status === "closed" && !showClosed) continue;
    seen.add(row.status);
  }
  const custom = Array.from(seen).filter((s) => STATUS_ORDER.indexOf(s) < 0).sort();
  const order = STATUS_ORDER.filter((s) => seen.has(s)).concat(custom);
  const by = new Map<string, TreeRow[]>();
  for (const s of order) by.set(s, []);
  for (const row of rows) {
    const list = by.get(row.status);
    if (list && passes(row)) list.push(row);
  }
  return order.map((status) => ({ status, rows: by.get(status)!.sort(cmp) }));
}

/** How many cards a lane draws, given the pages the reader asked for. */
export function lanePage(pages: Readonly<Record<string, number>>, status: string): number {
  return pages[status] ?? BOARD_PAGE;
}

/** Has a press moved far enough to be a drag? */
export function pastSlop(dx: number, dy: number): boolean {
  return Math.abs(dx) >= DRAG_SLOP || Math.abs(dy) >= DRAG_SLOP;
}

/**
 * What a drop does: the new status, or null when nothing should happen —
 * dropped outside every lane, or back into the lane it came from.
 */
export function dropTarget(from: string, over: string | null): string | null {
  return over && over !== from ? over : null;
}

/** The test ids the board's nodes carry; the drag finds lanes and cards by them on web. */
export const LANE_TID = "beads-lane-";
export const CARD_TID = "beads-bcard-";

/** The status / id a board test id names, or null for any other node. */
export function fromTestId(prefix: string, testId: string | null | undefined): string | null {
  return testId && testId.indexOf(prefix) === 0 && testId.length > prefix.length ? testId.slice(prefix.length) : null;
}
