/**
 * Locale-dependent date formatting and the one share format the charts use.
 *
 * Ported from the reference tab (cloudcli-plugin-beads, dist/index.js:
 * fmtDate, fmtDateShort, tipWhen, tempoLabel, shareOf). The locale is a
 * parameter rather than a global, and so is "now" where the reference read
 * the clock.
 */

import { bucketNext } from "./time.ts";
import type { Step } from "./types.ts";

/** A full timestamp: date and time. Null for no value; an unreadable one comes back as is. */
export function fmtDate(iso: string | null | undefined, locale: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(locale, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** A compact date for a list column; the year only when it is not the current one. */
export function fmtDateShort(iso: string | null | undefined, locale: string, now: number): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(locale, sameYear
    ? { month: "short", day: "numeric" }
    : { year: "2-digit", month: "short", day: "numeric" });
}

/** The shortest honest name for a step under the pointer: a date, or the month for a month. */
export function tipWhen(start: number, step: Step, locale: string): string {
  const d = new Date(start);
  return step === "month"
    ? d.toLocaleDateString(locale, { year: "numeric", month: "long" })
    : d.toLocaleDateString(locale, { month: "long", day: "numeric" });
}

/**
 * How a step is named in a table row: a day, a week as its calendar span (the
 * month repeated on the right only when the span crosses one), a month by name.
 */
export function tempoLabel(start: number, step: Step, locale: string): string {
  const from = new Date(start);
  if (step === "month") return from.toLocaleDateString(locale, { year: "numeric", month: "long" });
  if (step === "day") return from.toLocaleDateString(locale, { month: "short", day: "numeric" });
  const to = new Date(bucketNext(start, step) - 1);
  const sameMonth = from.getMonth() === to.getMonth();
  const left = from.toLocaleDateString(locale, { month: "short", day: "numeric" });
  const right = to.toLocaleDateString(locale, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" });
  return `${left} – ${right}`;
}

/** The ETA date: day, month by name, year. */
export function fmtEtaDate(at: number, locale: string): string {
  return new Date(at).toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
}

/**
 * A part of a whole as a percentage that does not lie in either direction: a
 * non-zero part never shows as 0 %, a part short of the whole never as 100 %.
 * Empty for an empty whole.
 */
export function shareOf(part: number, whole: number): string {
  if (!whole) return "";
  const pct = (part / whole) * 100;
  if (part > 0 && pct < 1) return "<1 %";
  if (part < whole && pct > 99) return ">99 %";
  return `${Math.round(pct)} %`;
}
