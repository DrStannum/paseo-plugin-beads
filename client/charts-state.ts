/**
 * The charts view's part of the panel state (reference state.chartsTab,
 * chartsPeriod, chartsStep, personId, authorId, peopleSort, authorsSort):
 * the persisted fields with their zod fallbacks, what lives only while
 * mounted, the actions and their reducer. client/store.tsx folds all of it
 * into the one store; kept apart so node tests can load it (no JSX here).
 */

import { z } from "zod";
import {
  CHART_PERIODS, CHART_STEPS, CHART_TABS,
  type AuthorSortKey, type ChartTab, type Period, type PeopleSortKey, type PinnedStep, type TableSort,
} from "../shared/charts/index.ts";

/** The default period, in days (reference: 90). */
export const CHART_PERIOD_DEFAULT = 90;

/** Persisted per tab: which reading, over what period, cut by what step. Each field falls back alone. */
export const ChartsTabFields = {
  chartsTab: z.enum(["cuts", "flow", "people", "authors"]).catch("cuts"),
  chartsPeriod: z.number().nullable().refine((n) => CHART_PERIODS.indexOf(n) >= 0).catch(CHART_PERIOD_DEFAULT),
  chartsStep: z.enum(["auto", "day", "week", "month"]).catch("auto"),
};

export interface ChartsTabState {
  chartsTab: ChartTab;
  chartsPeriod: Period;
  chartsStep: PinnedStep;
}

export const CHARTS_TAB_DEFAULT: ChartsTabState = { chartsTab: "cuts", chartsPeriod: CHART_PERIOD_DEFAULT, chartsStep: "auto" };

/** Per visit, as in the reference: the drill-downs and the table sorts. */
export interface ChartsLive {
  /** The person / author drilled into; "" is the unassigned / anonymous row; null = the table. */
  personId: string | null;
  authorId: string | null;
  peopleSort: TableSort<PeopleSortKey>;
  authorsSort: TableSort<AuthorSortKey>;
}

export const CHARTS_LIVE_INIT: ChartsLive = {
  personId: null, authorId: null, peopleSort: { key: null, dir: -1 }, authorsSort: { key: null, dir: -1 },
};

export type ChartsState = ChartsTabState & ChartsLive;

export type ChartsAction =
  /** Another reading; leaving one leaves its drill-down too. */
  | { type: "chartsTab"; tab: ChartTab }
  | { type: "chartsPeriod"; period: Period }
  | { type: "chartsStep"; step: PinnedStep }
  /** Drill into a person / an author, or back out (null). */
  | { type: "person"; name: string | null }
  | { type: "author"; name: string | null }
  | { type: "peopleSort"; sort: TableSort<PeopleSortKey> }
  | { type: "authorsSort"; sort: TableSort<AuthorSortKey> };

const CHARTS_ACTIONS = ["chartsTab", "chartsPeriod", "chartsStep", "person", "author", "peopleSort", "authorsSort"];

export function isChartsAction(a: { type: string }): a is ChartsAction {
  return CHARTS_ACTIONS.indexOf(a.type) >= 0;
}

/** The charts' reducer over any state that carries ChartsState. */
export function chartsReducer<S extends ChartsState>(s: S, a: ChartsAction): S {
  switch (a.type) {
    case "chartsTab":
      if (s.chartsTab === a.tab || CHART_TABS.indexOf(a.tab) < 0) return s;
      return { ...s, chartsTab: a.tab, personId: a.tab === "people" ? s.personId : null, authorId: a.tab === "authors" ? s.authorId : null };
    case "chartsPeriod":
      return CHART_PERIODS.indexOf(a.period) >= 0 ? { ...s, chartsPeriod: a.period } : s;
    case "chartsStep":
      return CHART_STEPS.indexOf(a.step) >= 0 ? { ...s, chartsStep: a.step } : s;
    case "person":
      return { ...s, personId: a.name };
    case "author":
      return { ...s, authorId: a.name };
    case "peopleSort":
      return { ...s, peopleSort: a.sort };
    case "authorsSort":
      return { ...s, authorsSort: a.sort };
  }
}

/** The persisted part, for the store's persisted(). */
export function chartsPersisted(s: ChartsTabState): ChartsTabState {
  return { chartsTab: s.chartsTab, chartsPeriod: s.chartsPeriod, chartsStep: s.chartsStep };
}
