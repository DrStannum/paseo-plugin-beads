/**
 * The color arithmetic and the reference's own palettes, shared by the
 * panel's palette (client/theme.ts) and the charts' (client/charts/palette.ts)
 * so the two can never drift: one parser, one mix, one light/dark rule, one
 * set of type / label / accent hues.
 *
 * The hues are the reference tab's (cloudcli-plugin-beads, dist/index.js CSS
 * tokens), light or dark by the luminance of the host's surface0. Plain TS
 * with no runtime imports, so node tests and the preview scripts load it.
 */

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** #rgb, #rgba, #rrggbb, #rrggbbaa, rgb()/rgba(); null for anything else (a CSS variable, a name). */
export function parseColor(color: string): Rgba | null {
  const c = String(color).trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = h.split("").map((x) => x + x).join("");
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(c);
  if (m) {
    const aRaw = m[4];
    const a = aRaw == null ? 1 : aRaw.charAt(aRaw.length - 1) === "%" ? parseFloat(aRaw) / 100 : parseFloat(aRaw);
    return { r: +m[1]!, g: +m[2]!, b: +m[3]!, a };
  }
  return null;
}

const hex2 = (v: number) => {
  const s = Math.round(Math.max(0, Math.min(255, v))).toString(16);
  return s.length < 2 ? `0${s}` : s;
};

/** An opaque color as #rrggbb, a translucent one as rgba(). */
export function formatColor(c: Rgba): string {
  if (c.a >= 0.999) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${Math.round(c.a * 1000) / 1000})`;
}

/**
 * color-mix(in srgb, a pct%, b): `pct` % of `a` over `b`, alpha mixed too.
 * `b` may be "transparent". Unparseable input returns `a` unchanged.
 */
export function mix(a: string, pct: number, b: string): string {
  const x = parseColor(a);
  const y = b === "transparent" ? (x ? { r: x.r, g: x.g, b: x.b, a: 0 } : null) : parseColor(b);
  if (!x || !y) return a;
  const p = Math.max(0, Math.min(100, pct)) / 100;
  return formatColor({ r: x.r * p + y.r * (1 - p), g: x.g * p + y.g * (1 - p), b: x.b * p + y.b * (1 - p), a: x.a * p + y.a * (1 - p) });
}

/** The colour with its alpha scaled to `pct` percent. */
export function alpha(color: string, pct: number): string {
  return mix(color, pct, "transparent");
}

/** A translucent `a` laid on an opaque `b`, flattened to the opaque color it shows as. */
export function over(a: string, b: string): string {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return a;
  return formatColor({ r: x.r * x.a + y.r * (1 - x.a), g: x.g * x.a + y.g * (1 - x.a), b: x.b * x.a + y.b * (1 - x.a), a: 1 });
}

/** Relative luminance 0..1; 1 for an unparseable color (treated as light). */
export function luminance(color: string): number {
  const p = parseColor(color);
  if (!p) return 1;
  const ch = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * ch(p.r) + 0.7152 * ch(p.g) + 0.0722 * ch(p.b);
}

/** The one light/dark rule: a dark page under the panel. */
export function isDarkSurface(surface0: string): boolean {
  return luminance(surface0) < 0.2;
}

export interface RefTokens {
  /** The reference's blue: links, P1, the active control, data series. */
  accent: string;
  good: string;
  warning: string;
  critical: string;
  /** The chart grid / bar track tone the reference drew under data. */
  grid: string;
  type: { epic: string; bug: string; feature: string };
  /** Label slots 1–8. */
  labels: string[];
}

/** The reference tab's own tokens (map §20), for what the host theme has no word for. */
export const REF: { light: RefTokens; dark: RefTokens } = {
  light: {
    accent: "#2a78d6",
    good: "#0ca30c",
    warning: "#fab219",
    critical: "#d03b3b",
    grid: "#e1e0d9",
    type: { epic: "#2a78d6", bug: "#eb6834", feature: "#1baf7a" },
    labels: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  },
  dark: {
    accent: "#3987e5",
    good: "#0ca30c",
    warning: "#fab219",
    critical: "#d03b3b",
    grid: "#2c2c2a",
    type: { epic: "#3987e5", bug: "#d95926", feature: "#199e70" },
    labels: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
  },
};
