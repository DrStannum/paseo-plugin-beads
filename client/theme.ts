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
import { REF, isDarkSurface, mix } from "./tokens.ts";

export type HostTheme = PluginWorkspacePanelProps["theme"];

// The arithmetic, the light/dark rule and the reference hues are shared with
// the charts' palette (client/charts/palette.ts) through client/tokens.ts.
export { alpha, mix } from "./tokens.ts";

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
  const dark = isDarkSurface(c.surface0);
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
