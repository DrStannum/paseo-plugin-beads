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
 * Plain TS with no runtime imports, so node tests and the preview script can
 * load it. NOTE for reconciliation: client/theme.ts (written concurrently)
 * may grow the same derived tokens (grid, ink2, type/label palettes); when it
 * does, this file should read them from there instead of deriving its own.
 */

import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";

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

// ── color arithmetic ─────────────────────────────────────────────────

interface Rgba { r: number; g: number; b: number; a: number }

/** #rgb, #rrggbb, #rrggbbaa, rgb()/rgba(); null for anything else. */
export function parseColor(c: string): Rgba | null {
  const s = String(c).trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (m) {
    const h = m[1]!;
    if (h.length === 3) {
      return { r: parseInt(h[0]! + h[0]!, 16), g: parseInt(h[1]! + h[1]!, 16), b: parseInt(h[2]! + h[2]!, 16), a: 1 };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) {
    const aRaw = m[4];
    const a = aRaw == null ? 1 : aRaw.endsWith("%") ? parseFloat(aRaw) / 100 : parseFloat(aRaw);
    return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a };
  }
  return null;
}

const hex2 = (v: number) => {
  const s = Math.round(Math.max(0, Math.min(255, v))).toString(16);
  return s.length < 2 ? `0${s}` : s;
};

/** `pct` % of `a` over `b`, as CSS color-mix(in srgb, a pct%, b) does. Unparseable → `a`. */
export function mix(a: string, pct: number, b: string): string {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return a;
  const k = Math.max(0, Math.min(100, pct)) / 100;
  // A translucent `a` is flattened onto `b` first: a mark is opaque.
  const xr = x.r * x.a + y.r * (1 - x.a);
  const xg = x.g * x.a + y.g * (1 - x.a);
  const xb = x.b * x.a + y.b * (1 - x.a);
  return `#${hex2(xr * k + y.r * (1 - k))}${hex2(xg * k + y.g * (1 - k))}${hex2(xb * k + y.b * (1 - k))}`;
}

/** Relative luminance 0..1; 1 for an unparseable color (treated as light). */
export function luminance(c: string): number {
  const p = parseColor(c);
  if (!p) return 1;
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(p.r) + 0.7152 * ch(p.g) + 0.0722 * ch(p.b);
}

// ── the reference's own palettes (map §20) ───────────────────────────

const LABELS_LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const LABELS_DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

/** All chart colors for a host theme. */
export function chartColors(c: HostColors): ChartColors {
  const dark = luminance(c.surface0) < 0.4;
  const card = c.surface1 || c.surface0;
  const ink = c.foreground;
  const dataAccent = dark ? "#3987e5" : "#2a78d6";
  return {
    dark,
    page: c.surface0,
    card,
    raised: c.surface2 || card,
    border: c.border,
    ink,
    ink2: mix(ink, 72, c.foregroundMuted),
    muted: c.foregroundMuted,
    grid: dark ? mix("#2c2c2a", 60, mix(c.border, 100, card)) : mix("#e1e0d9", 60, mix(c.border, 100, card)),
    accent: dataAccent,
    uiAccent: c.accent,
    accentForeground: c.accentForeground,
    accentSoft: mix(dataAccent, 45, card),
    good: c.statusSuccess,
    warning: c.statusWarning,
    critical: c.statusDanger,
    hover: mix(ink, 6, card),
    sel: mix(c.accent, 14, card),
    tipBg: ink,
    tipFg: card,
    labels: dark ? LABELS_DARK : LABELS_LIGHT,
    types: dark
      ? { epic: "#3987e5", bug: "#d95926", feature: "#199e70" }
      : { epic: "#2a78d6", bug: "#eb6834", feature: "#1baf7a" },
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
