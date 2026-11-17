/**
 * The plugin's host settings: the reader's name (comment author, "Assign to
 * me") and the auto-refresh interval. The reference kept both in the
 * browser's localStorage; in Paseo they live with the host, shared by every
 * client of it, and both the settings screen and the panel read them through
 * useSettings (one query, refreshed when the host announces a change).
 *
 * Every field falls back to its default on its own, so a hand-edited or
 * outdated file never turns the whole document invalid.
 */

import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Poll interval choices, in ms (reference POLL_CHOICES). */
export const POLL_CHOICES: readonly number[] = [10000, 30000, 60000, 300000, 900000];
/** Default poll interval. A beads tree moves in minutes, not seconds. */
export const POLL_DEFAULT_MS = 300000;

export const SettingsSchema = z.object({
  /** Who the reader is: comment author and the "Assign to me" value. Blank = anonymous. */
  currentUser: z.string().catch("").default(""),
  pollMs: z
    .number()
    .refine((n) => POLL_CHOICES.indexOf(n) >= 0)
    .catch(POLL_DEFAULT_MS)
    .default(POLL_DEFAULT_MS),
});
export type BeadsSettings = z.infer<typeof SettingsSchema>;

export const SETTINGS_DEFAULT: BeadsSettings = { currentUser: "", pollMs: POLL_DEFAULT_MS };

/** The settings document; its id doubles as the settings screen's id. */
export const beadsSettings = defineSettings({ id: "beads", scope: "host", version: 1, schema: SettingsSchema });
