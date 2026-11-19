import { defineTranslations, useTranslation } from "@getpaseo/plugin/client";
import { stringsFor, type Strings } from "./strings.ts";

/**
 * Labels the host renders itself (panel tab, command center), which must be
 * PluginText resolved in the app's language. Everything inside the panel comes
 * from the STRINGS tables instead — see useStrings.
 */
export const messages = defineTranslations({
  resources: {
    en: { panelTitle: "Beads", openPanel: "Open Beads", openBoard: "Open Beads board", settingsTitle: "Beads" },
    ru: { panelTitle: "Beads", openPanel: "Открыть Beads", openBoard: "Открыть доску Beads", settingsTitle: "Beads" },
  },
});

/** The panel's string table for the app's current language (reactive). */
export function useStrings(): Strings {
  const { locale } = useTranslation(messages);
  return stringsFor(locale);
}
