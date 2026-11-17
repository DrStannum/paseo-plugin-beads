/**
 * Labels and dates as the panel prints them (reference statusLabel, typeLabel,
 * priorityLabel, priorityTitle, columnLabel, fmtDate, fmtDateShort).
 */

import type { Strings } from "./i18n/strings.ts";

type Table = Record<string, unknown>;

function entry(t: Strings, key: string): string | null {
  const v = (t as unknown as Table)[key];
  return typeof v === "string" ? v : null;
}

export function statusLabel(t: Strings, status: string): string {
  return entry(t, `st_${status}`) ?? status;
}

export function typeLabel(t: Strings, type: string): string {
  return entry(t, `ty_${String(type).replace(/-/g, "_")}`) ?? type;
}

export function priorityLabel(t: Strings, p: number): string {
  return entry(t, `pri_${p}`) ?? `P${p}`;
}

/** Accessible name of a priority icon shown without its text, e.g. "P0 — critical". */
export function priorityTitle(t: Strings, p: number): string {
  return `P${p} — ${priorityLabel(t, p)}`;
}

export function columnLabel(t: Strings, key: string): string {
  return entry(t, `col${key.charAt(0).toUpperCase()}${key.slice(1)}`) ?? key;
}

/** A string entry by key (the short column captions). */
export function stringOf(t: Strings, key: string): string {
  return entry(t, key) ?? key;
}

/** Full timestamp, e.g. "Jul 14, 2026, 03:25 PM". */
export function fmtDate(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

/** Compact date for a tree column; the year only when it is not this one. */
export function fmtDateShort(iso: string | null | undefined, locale: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  try {
    return d.toLocaleDateString(locale, sameYear ? { month: "short", day: "numeric" } : { year: "2-digit", month: "short", day: "numeric" });
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Last path segment: the project name of a `.beads` root. */
export function baseName(path: string | null | undefined): string {
  if (!path) return "";
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] ?? "";
}
