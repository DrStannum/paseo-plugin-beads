/**
 * The charts' drawing layer for the views (Breakdowns, Over time, Assignees,
 * Authors): the Chart renderer, the View-based blocks, the palette and the
 * wording helpers. The scene builders themselves are pure and live in
 * shared/charts/scene.ts.
 */

export { Chart, type ChartProps } from "./Chart.tsx";
export {
  BreakdownCard, ChartCard, CohortGrid, EtaRow, KpiTiles, Legend, Sparkline,
  type BreakdownCardProps, type ChartCardProps, type LegendItem,
} from "./blocks.tsx";
export * from "./palette.ts";
export * from "./text.ts";
