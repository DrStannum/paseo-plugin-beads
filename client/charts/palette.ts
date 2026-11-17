/**
 * The charts' colors: palette token names (what a Scene's marks and the
 * breakdown rows carry) resolved against the Paseo host theme.
 *
 * Paseo's theme has eleven colors; the reference tab (cloudcli-plugin-beads,
 * dist/index.js CSS block, and CHART_STATUS_COLOR / CHART_PRI_COLOR /
 * CHART_READY_COLOR) painted with more — grid, ink-2, the type and label
 * palettes, mixes over the card. Those are derived here: from the host colors
 * where one fits, from the reference's light/dark values otherwise, picking
 * light or dark by the luminance of surface0.
 *
 * Plain TS importing only client/tokens.ts, so node tests and the preview
 * script can load it. The color arithmetic, the light/dark rule and the reference hues
 * come from client/tokens.ts — the same ones the panel's palette
 * (client/theme.ts) uses.
 */

import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { REF, isDarkSurface, mix, over } from "../tokens.ts";

export type HostColors = PluginWorkspacePanelProps["theme"]["colors"];

/** Every named token the charts use, resolved. */
export interface ChartColors {
  dark: boolean;
  /** The page the cards sit on (surface0) and the card itself (surface1). */
  page: string;
  card: string;
  /** One step off the card: breakdown tracks, cohort cells (surface2). */
  raised: string;
  border: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  /**
   * The data accent: the reference's blue, not the host accent. Paseo's
   * accent is green in some themes (beside statusSuccess, "in progress" and
   * "done" would be one colour) and near-white in others, so series use this.
   */
  accent: string;
  /** The host's own accent, for UI chrome (a pressed row's outline, focus). */
  uiAccent: string;
  accentForeground: string;
  /** The data accent washed over the card — the second line of a banded pair. */
  accentSoft: string;
  good: string;
  warning: string;
  critical: string;
  /** Row hover and a hit strip under the pointer. */
  hover: string;
  /** A pressed (filtering) breakdown row. */
  sel: string;
  /** The tooltip: ink on card turned inside out. */
  tipBg: string;
  tipFg: string;
  /** Label slots 1–8 (index 0 unused → muted). */
  labels: string[];
  types: { epic: string; bug: string; feature: string };
}

// The arithmetic and the reference's hues live in client/tokens.ts, shared
// with the panel's palette (client/theme.ts); re-exported for the tests and
// the preview scripts.
export { luminance, mix, parseColor } from "../tokens.ts";

/** All chart colors for a host theme. */
export function chartColors(c: HostColors): ChartColors {
  const dark = isDarkSurface(c.surface0);
  const ref = dark ? REF.dark : REF.light;
  const card = c.surface1 || c.surface0;
  const ink = c.foreground;
  return {
    dark,
    page: c.surface0,
    card,
    raised: c.surface2 || card,
    border: c.border,
    ink,
    ink2: mix(ink, 72, c.foregroundMuted),
    muted: c.foregroundMuted,
    grid: mix(ref.grid, 60, over(c.border, card)),
    accent: ref.accent,
    uiAccent: c.accent,
    accentForeground: c.accentForeground,
    accentSoft: mix(ref.accent, 45, card),
    good: c.statusSuccess,
    warning: c.statusWarning,
    critical: c.statusDanger,
    hover: mix(ink, 6, card),
    sel: mix(c.accent, 14, card),
    tipBg: ink,
    tipFg: card,
    labels: ref.labels,
    types: ref.type,
  };
}

/**
 * A token → CSS color resolver for sceneToSvgMarkup and the web renderer.
 * Tokens: any ChartColors string key ("good", "grid", "accentSoft", …),
 * "lab1".."lab8", "type-epic" / "type-bug" / "type-feature", "none",
 * "transparent"; a literal "#…" / "rgb…" passes through; anything unknown → muted.
 */
export function colorResolver(colors: ChartColors): (token: string) => string {
  return (token) => {
    if (token === "none" || token === "transparent") return token;
    if (token.charAt(0) === "#" || token.slice(0, 3) === "rgb") return token;
    if (token.slice(0, 3) === "lab") {
      const slot = Number(token.slice(3));
      return slot >= 1 && slot <= colors.labels.length ? colors.labels[slot - 1]! : colors.muted;
    }
    if (token.slice(0, 5) === "type-") {
      const ty = token.slice(5) as keyof ChartColors["types"];
      return colors.types[ty] || colors.muted;
    }
    const v = (colors as unknown as Record<string, unknown>)[token];
    return typeof v === "string" ? v : colors.muted;
  };
}

// ── what each bucket of a breakdown is painted with ─────────────────

/** CHART_STATUS_COLOR. */
export const STATUS_TOKEN: Record<string, string> = {
  open: "ink2", in_progress: "good", blocked: "critical", deferred: "warning", closed: "muted",
};
/** CHART_PRI_COLOR, P0..P4. */
export const PRIORITY_TOKEN: readonly string[] = ["critical", "accent", "warning", "good", "muted"];
/** CHART_READY_COLOR. */
export const READY_TOKEN: Record<string, string> = { ready: "good", blocked: "critical", plain: "muted" };
/** Only these types are coloured; the rest are muted. */
export const COLORED_TYPES: readonly string[] = ["epic", "bug", "feature"];
/** How many tags get a categorical color before the rest go muted. */
export const LABEL_SLOTS = 8;

/**
 * Label → color slot (1..8, 0 = muted), assigned over the project's own
 * sorted label list so a tag keeps its color however the filters change.
 */
export function labelSlots(allLabels: Iterable<string>): Map<string, number> {
  const sorted: string[] = [];
  const seen = new Set<string>();
  for (const l of allLabels) if (!seen.has(l)) { seen.add(l); sorted.push(l); }
  sorted.sort();
  const out = new Map<string, number>();
  sorted.forEach((l, i) => out.set(l, i + 1 <= LABEL_SLOTS ? i + 1 : 0));
  return out;
}

/**
 * The token one bucket of a cut is painted with (the reference's colorVar):
 * assignees accent; status/priority/readiness/type by their fixed maps; tags
 * by slot; the folded tail and the empty buckets muted.
 */
export function bucketToken(cutKey: string, bucketKey: string, kind: string, slots?: Map<string, number>): string {
  if (kind !== "value") return "muted";
  switch (cutKey) {
    case "assignee": return "accent";
    case "status": return STATUS_TOKEN[bucketKey] ?? "muted";
    case "priority": return PRIORITY_TOKEN[Number(bucketKey)] ?? "muted";
    case "readiness": return READY_TOKEN[bucketKey] ?? "muted";
    case "type": return COLORED_TYPES.indexOf(bucketKey) >= 0 ? `type-${bucketKey}` : "muted";
    case "labels": {
      const s = slots ? slots.get(bucketKey) || 0 : 0;
      return s ? `lab${s}` : "muted";
    }
    default: return "muted";
  }
}
