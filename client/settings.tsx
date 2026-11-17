/**
 * The plugin's host settings, read and written (shared/settings.ts): the
 * panel reads them through useBeadsSettings(); the settings screen in Paseo's
 * Settings writes them (reference: the header's settings panel, now a page of
 * the app's own Settings, and the interval picker, now shared by every client
 * of the host).
 */

import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { useSettings } from "@getpaseo/plugin/client";
import { ScrollView, SettingsAction, SettingsCard, SettingsInput, SettingsSection, SettingsSelect } from "@getpaseo/plugin/client/ui";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { POLL_CHOICES, SETTINGS_DEFAULT, beadsSettings, type BeadsSettings } from "../shared/settings.ts";
import { useStrings } from "./i18n/messages.ts";

/** How long the name field waits for the typing to stop before it saves. */
const NAME_SAVE_MS = 600;

export interface BeadsSettingsApi extends BeadsSettings {
  /** The host answered (until then the defaults stand in). */
  ready: boolean;
  /** Save one field over the current document; false if the host refused. */
  set(patch: Partial<BeadsSettings>): Promise<boolean>;
}

/** The settings as the panel uses them: defaults while loading, never an error. */
export function useBeadsSettings(): BeadsSettingsApi {
  const s = useSettings(beadsSettings);
  const values = s.status === "ready" ? s.values : SETTINGS_DEFAULT;
  const latest = useRef(s);
  latest.current = s;
  const set = useCallback(async (patch: Partial<BeadsSettings>) => {
    const cur = latest.current;
    if (cur.status !== "ready") return false;
    return cur.save({ ...cur.values, ...patch }, cur.revision);
  }, []);
  return { currentUser: values.currentUser, pollMs: values.pollMs, ready: s.status === "ready", set };
}

/** The poll interval — the one place the panel reads it from. */
export function usePollMs(): [number, (ms: number) => void] {
  const s = useBeadsSettings();
  return [s.pollMs, (ms: number) => void s.set({ pollMs: ms })];
}

/**
 * Opens this plugin's settings screen. The panel gets it from the client
 * context (index.client.tsx); absent (tests, old hosts) the links hide.
 */
export const OpenSettingsContext = createContext<(() => void) | null>(null);

export function useOpenSettings(): (() => void) | null {
  return useContext(OpenSettingsContext);
}

/** The page under Paseo's Settings: the reader's name and the refresh interval. */
export function SettingsScreen({ theme }: PluginSurfaceProps) {
  const t = useStrings();
  const s = useSettings(beadsSettings);
  const [name, setName] = useState<string | null>(null);
  const latest = useRef(s);
  latest.current = s;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  // A typed name is saved once the typing stops: one revision per pause, not per key.
  const flush = useCallback((text: string) => {
    const cur = latest.current;
    if (cur.status !== "ready" || cur.values.currentUser === text) return;
    void cur.save({ ...cur.values, currentUser: text }, cur.revision).then((ok) => {
      if (ok) setName(null);
    });
  }, []);

  if (s.status === "loading") return <ActivityIndicator color={theme.colors.foregroundMuted} />;
  if (s.status !== "ready") {
    return (
      <View style={{ gap: 12, padding: 16 }}>
        <Text style={{ color: theme.colors.statusDanger }}>{s.error}</Text>
        <SettingsCard>
          <SettingsAction label={t.settingsReload} actionLabel={t.retryLoad} onPress={() => void s.reload()} />
          {s.status === "invalid" ? <SettingsAction label={t.settingsResetHint} actionLabel={t.settingsReset} disabled={s.saving} onPress={() => void s.reset()} /> : null}
        </SettingsCard>
      </View>
    );
  }
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 16 }}>
      <SettingsSection title={t.title} testID="beads-settings">
        <SettingsCard>
          <SettingsInput
            testID="beads-settings-name"
            label={t.settingsCurrentUser}
            hint={t.settingsCurrentUserHint}
            initialValue={name ?? s.values.currentUser}
            placeholder={t.settingsCurrentUserPlaceholder}
            onChangeText={(text) => {
              setName(text);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => flush(text.trim()), NAME_SAVE_MS);
            }}
          />
          <SettingsSelect
            testID="beads-settings-interval"
            label={t.interval}
            hint={t.settingsIntervalHint}
            value={String(s.values.pollMs)}
            options={POLL_CHOICES.map((ms) => ({ value: String(ms), label: t.intervalOption(ms) }))}
            disabled={s.saving}
            onValueChange={(v) => void s.save({ ...s.values, pollMs: Number(v) }, s.revision)}
          />
        </SettingsCard>
        {s.saveError ? <Text accessibilityRole="alert" style={{ color: theme.colors.statusDanger }}>{s.saveError}</Text> : null}
      </SettingsSection>
    </ScrollView>
  );
}
