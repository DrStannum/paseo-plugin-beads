/**
 * Design tokens of the panel, in one place.
 *
 * Surfaces, ink, accent and the status colours come from the host theme
 * (props.theme.colors), so the panel looks like the rest of Paseo. What the
 * host has no word for — issue type hues, the eight label slots, priority
 * colours, readiness — is taken from the reference tab's own tokens
 * (cloudcli-plugin-beads, dist/index.js CSS), light or dark by the luminance
 * of surface0.
 */

import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Platform } from "react-native";

export type HostTheme = PluginWorkspacePanelProps["theme"];

interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parse(color: string): Rgba | null {
  const c = color.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = h.split("").map((x) => x + x).join("");
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(c);
  if (m) {
    const p = m[1]!.split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: p[0] ?? 0, g: p[1] ?? 0, b: p[2] ?? 0, a: p[3] ?? 1 };
  }
  return null;
}

function fmt(c: Rgba): string {
  const r = Math.round(c.r);
  const g = Math.round(c.g);
  const b = Math.round(c.b);
  return c.a >= 0.999 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.round(c.a * 1000) / 1000})`;
}

/** color-mix(in srgb, a pct%, b): `pct` of `a` over `b`. Unparseable input returns `a`. */
export function mix(a: string, pct: number, b: string): string {
  const x = parse(a);
  const y = b === "transparent" ? { r: x?.r ?? 0, g: x?.g ?? 0, b: x?.b ?? 0, a: 0 } : parse(b);
  if (!x || !y) return a;
  const p = pct / 100;
  return fmt({ r: x.r * p + y.r * (1 - p), g: x.g * p + y.g * (1 - p), b: x.b * p + y.b * (1 - p), a: x.a * p + y.a * (1 - p) });
}

/** The colour with its alpha scaled to `pct` percent. */
export function alpha(color: string, pct: number): string {
  return mix(color, pct, "transparent");
}

function luminance(color: string): number {
  const c = parse(color);
  if (!c) return 0;
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
}

const REF = {
  light: {
    accent: "#2a78d6",
    good: "#0ca30c",
    warning: "#fab219",
    critical: "#d03b3b",
    type: { epic: "#2a78d6", bug: "#eb6834", feature: "#1baf7a" },
    labels: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  },
  dark: {
    accent: "#3987e5",
    good: "#0ca30c",
    warning: "#fab219",
    critical: "#d03b3b",
    type: { epic: "#3987e5", bug: "#d95926", feature: "#199e70" },
    labels: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
  },
};

export interface Palette {
  dark: boolean;
  /** Panel background. */
  bg: string;
  /** Pane (tree, card) background. */
  card: string;
  /** Slightly lifted: id chip, code blocks, header strip. */
  raised: string;
  border: string;
  /** Hairlines inside a pane (section rules, table grid). */
  grid: string;
  ink: string;
  ink2: string;
  muted: string;
  accent: string;
  accentInk: string;
  /** The reference's own blue: links, P1, the active sort. Host accent can be any hue. */
  link: string;
  good: string;
  warning: string;
  critical: string;
  sel: string;
  hover: string;
  flash: string;
  /** Background of a type glyph. */
  type(type: string | null | undefined): string;
  /** Label hue of a slot (0 = past the eighth: muted ink). */
  label(slot: number): string;
  /** Priority icon colour, P0..P4. */
  pri(p: number): string;
  /** Status dot fill (open is drawn as a ring of `ink2`). */
  status(s: string): string;
}

const cache = new WeakMap<object, Palette>();

/** The panel's palette for a host theme (memoised per theme object). */
export function paletteOf(theme: HostTheme): Palette {
  const hit = cache.get(theme.colors);
  if (hit) return hit;
  const c = theme.colors;
  const dark = luminance(c.surface0) < 0.2;
  const ref = dark ? REF.dark : REF.light;
  const good = c.statusSuccess || ref.good;
  const warning = c.statusWarning || ref.warning;
  const critical = c.statusDanger || ref.critical;
  const ink2 = mix(c.foreground, 72, c.foregroundMuted);
  const p: Palette = {
    dark,
    bg: c.surface0,
    card: c.surface0,
    raised: c.surface1,
    border: c.border,
    grid: c.border,
    ink: c.foreground,
    ink2,
    muted: c.foregroundMuted,
    accent: c.accent,
    accentInk: c.accentForeground,
    link: ref.accent,
    good,
    warning,
    critical,
    sel: mix(ref.accent, dark ? 18 : 12, c.surface0),
    hover: mix(c.foreground, 5, c.surface0),
    flash: mix(good, 22, c.surface0),
    type: (t) => {
      if (t === "epic" || t === "bug" || t === "feature") return ref.type[t];
      return c.foregroundMuted;
    },
    label: (slot) => (slot >= 1 && slot <= 8 ? ref.labels[slot - 1]! : c.foregroundMuted),
    pri: (n) => [critical, ref.accent, warning, good, c.foregroundMuted][n] ?? c.foregroundMuted,
    status: (s) =>
      s === "in_progress" ? good : s === "blocked" ? critical : s === "deferred" ? warning : s === "open" ? "transparent" : ink2,
  };
  cache.set(theme.colors, p);
  return p;
}

export const MONO = Platform.select({
  ios: "Menlo",
  android: "monospace",
  default: "ui-monospace, SFMono-Regular, Menlo, monospace",
}) as string;

/**
 * Font sizes, scaled from the reference's rem values (root 14 px) up a notch
 * to sit with Paseo's own text.
 */
export const FONT = {
  title: 17,
  project: 13,
  mode: 11,
  stat: 12,
  control: 12.5,
  rowTitle: 13,
  id: 11.5,
  status: 11.5,
  mark: 10.5,
  label: 11,
  th: 11,
  cardTitle: 16,
  meta: 13,
  md: 13,
  secHead: 11,
  rel: 12.5,
};

/** Fixed tree row height — what makes the virtualised list possible. */
export const ROW_H = 32;
