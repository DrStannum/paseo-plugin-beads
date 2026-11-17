/**
 * The controls that write, as they sit in the panel's slots (reference
 * statusControl, assignToMe, the comment box, the Sync button and the export
 * badge, New issue, the card's + and pencil). The writing itself is in
 * client/writes.tsx; the form in client/editor.tsx.
 *
 * In jsonl mode nothing can be written: the controls turn into plain labels
 * or disabled buttons whose tooltip says why (editJsonl / newJsonl / …).
 */

import { TextInput } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View, type TextStyle } from "react-native";
import { statusChoices } from "../shared/form.ts";
import type { Card } from "../shared/types.ts";
import { useBeads } from "./beads.tsx";
import { statusLabel } from "./format.ts";
import { useBeadsSettings, useOpenSettings } from "./settings.tsx";
import { useStore } from "./store.tsx";
import { FONT, mix, type Palette } from "./theme.ts";
import { Backdrop, Btn, Menu, StatusDot, titled, type DomKeyEvent } from "./ui.tsx";
import { useWrites } from "./writes.tsx";

/** A text field in the panel's look (comment box, edit form). */
export function inputStyle(pal: Palette, multiline = false): TextStyle {
  return {
    borderWidth: 1, borderColor: pal.border, borderRadius: 8, backgroundColor: pal.card, color: pal.ink,
    paddingHorizontal: 10, paddingVertical: multiline ? 8 : 6, fontSize: FONT.md,
    minHeight: multiline ? 62 : 32, textAlignVertical: multiline ? "top" : "center",
  };
}

/** The red line under a refused write (reference .cbd-err). */
export function ErrorBox({ pal, message, testID }: { pal: Palette; message: string; testID?: string }) {
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={{
        marginTop: 8, paddingVertical: 7, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1,
        borderColor: mix(pal.critical, 35, pal.border), backgroundColor: mix(pal.critical, 10, pal.card),
      }}
    >
      <Text style={{ color: pal.critical, fontSize: FONT.control }}>{message}</Text>
    </View>
  );
}

/** The accent "save" button (reference .cbd-save). */
export function SaveBtn({ pal, label, onPress, disabled, testID, title }: { pal: Palette; label: string; onPress: () => void; disabled?: boolean; testID?: string; title?: string }) {
  return (
    <Pressable
      testID={testID}
      ref={titled(title) as never}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={(st) => ({
        height: 30, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center",
        borderColor: disabled ? pal.border : pal.link,
        backgroundColor: disabled ? pal.card : (st as { hovered?: boolean }).hovered ? mix(pal.link, 85, "#000000") : pal.link,
      })}
    >
      <Text style={{ color: disabled ? pal.muted : "#ffffff", fontSize: FONT.control }}>{label}</Text>
    </Pressable>
  );
}

// ── the card ─────────────────────────────────────────────────────────

/** The status as the control that changes it; a plain label in jsonl mode. */
export function StatusControl({ card }: { card: Card }) {
  const { pal, t } = useBeads();
  const w = useWrites();
  const [open, setOpen] = useState(false);
  const pill = { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, borderWidth: 1, borderColor: pal.border, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 };
  if (card.mode !== "bd") {
    return (
      <View testID="beads-status" ref={titled(t.editJsonl) as never} style={pill}>
        <StatusDot pal={pal} status={card.status} />
        <Text style={{ fontSize: FONT.meta, color: pal.ink2 }}>{statusLabel(t, card.status)}</Text>
      </View>
    );
  }
  const busy = w.quick.statusBusy === card.id;
  // bd's five, plus the current one if it is custom — never missing from its own menu.
  const choices = statusChoices([], card.status);
  return (
    <View style={{ position: "relative", zIndex: open ? 50 : 1 }}>
      <Pressable
        testID="beads-status"
        ref={titled(t.stChange) as never}
        accessibilityRole="button"
        accessibilityLabel={t.stChange}
        accessibilityState={{ disabled: busy, expanded: open }}
        disabled={busy}
        onPress={() => setOpen(!open)}
        style={(st) => ({ ...pill, backgroundColor: (st as { hovered?: boolean }).hovered && !busy ? pal.hover : pal.raised })}
      >
        <StatusDot pal={pal} status={card.status} />
        <Text style={{ fontSize: FONT.meta, color: pal.ink2 }}>{busy ? t.stChanging : statusLabel(t, card.status)}</Text>
        <Text style={{ fontSize: 9, color: pal.muted }}>▾</Text>
      </Pressable>
      {open ? <Backdrop onClose={() => setOpen(false)} /> : null}
      {open ? (
        <Menu
          pal={pal}
          top={28}
          testID="beads-status-menu"
          onClose={() => setOpen(false)}
          items={choices.map((s) => ({
            key: s,
            label: statusLabel(t, s),
            icon: <StatusDot pal={pal} status={s} />,
            selected: s === card.status,
            testID: `beads-status-${s}`,
            onPick: () => {
              setOpen(false);
              if (s !== card.status) w.changeStatus(card.id, s);
            },
          }))}
        />
      ) : null}
    </View>
  );
}

/** "Assign to me" beside the assignee: only with a name set, a writable card, and not already me. */
export function AssignMe({ card }: { card: Card }) {
  const { pal, t } = useBeads();
  const w = useWrites();
  const me = useBeadsSettings().currentUser.trim();
  if (card.mode !== "bd" || !me || me === (card.assignee ?? "")) return null;
  const busy = w.quick.assignBusy === card.id;
  return (
    <Pressable
      testID="beads-assign-me"
      accessibilityRole="button"
      disabled={busy}
      onPress={() => w.assignToMe(card.id)}
      style={(st) => ({
        borderWidth: 1, borderColor: pal.border, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 1,
        backgroundColor: (st as { hovered?: boolean }).hovered && !busy ? pal.hover : pal.card, opacity: busy ? 0.6 : 1,
      })}
    >
      <Text style={{ fontSize: FONT.status, color: pal.ink2 }}>{busy ? t.assigning : t.assignToMe}</Text>
    </Pressable>
  );
}

/** Why the last quick edit of this card was refused. */
export function CardNotices({ card }: { card: Card }) {
  const { pal } = useBeads();
  const { quick } = useWrites();
  const msgs = [quick.statusError, quick.assignError].filter((e) => e && e.id === card.id).map((e) => e!.message);
  if (!msgs.length) return null;
  return (
    <View style={{ marginTop: -4, marginBottom: 12 }}>
      {msgs.map((m) => (
        <ErrorBox key={m} pal={pal} message={m} testID="beads-quick-error" />
      ))}
    </View>
  );
}

/** + (new issue under this one) and the pencil, in the card's head. */
export function CardHeaderActions({ card }: { card: Card | null }) {
  const { pal, t } = useBeads();
  const w = useWrites();
  const writable = Boolean(card && card.mode === "bd");
  const jsonl = card?.mode === "jsonl";
  return (
    <>
      <Btn
        pal={pal}
        icon="Plus"
        testID="beads-card-sub"
        title={jsonl ? t.newJsonl : t.newSub}
        disabled={!writable}
        onPress={() => card && w.openEditor({ mode: "create", parent: card.id })}
      />
      <Btn
        pal={pal}
        icon="Pencil"
        testID="beads-card-edit"
        title={jsonl ? t.editJsonl : t.edit}
        disabled={!writable}
        onPress={() => card && w.openEditor({ mode: "edit", card })}
      />
    </>
  );
}

/** The add-comment box under the thread (or why there is none). */
export function CommentBox({ card }: { card: Card }) {
  const { pal, t } = useBeads();
  const { ui, dispatch } = useStore();
  const w = useWrites();
  const me = useBeadsSettings().currentUser.trim();
  const openSettings = useOpenSettings();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canComment = card.mode === "bd" && card.commentsAvailable !== false;
  if (!canComment) {
    return card.mode !== "bd" ? <Text style={{ marginTop: 8, fontSize: FONT.status, color: pal.muted }}>{t.cmJsonl}</Text> : null;
  }
  const id = card.id;
  const text = ui.drafts[id] ?? "";
  const submit = () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setError(null);
    void w.comment(id, body).then((r) => {
      setBusy(false);
      if (r.ok) dispatch({ type: "draft", id, text: "" });
      else setError(`${t.cmFailed}: ${r.message}`);
    });
  };
  const web = Platform.OS === "web";
  return (
    <View testID="beads-comment-box" style={{ marginTop: 10, gap: 6 }}>
      <TextInput
        testID="beads-comment-input"
        multiline
        value={text}
        editable={!busy}
        placeholder={t.cmWrite}
        placeholderTextColor={pal.muted}
        onChangeText={(v) => dispatch({ type: "draft", id, text: v })}
        onKeyPress={(e) => {
          const k = e.nativeEvent as unknown as DomKeyEvent;
          if (web && k.key === "Enter" && (k.ctrlKey || k.metaKey)) {
            (e as unknown as DomKeyEvent).preventDefault();
            submit();
          }
        }}
        style={inputStyle(pal, true)}
      />
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ flex: 1, fontSize: FONT.status, color: pal.muted }}>
          {web ? `${t.cmHint} · ` : ""}
          {me ? (
            t.cmAs(me)
          ) : (
            <>
              {`${t.cmAnon} `}
              {openSettings ? (
                <Text testID="beads-comment-setname" accessibilityRole="link" onPress={openSettings} style={{ color: pal.link, textDecorationLine: "underline" }}>
                  {t.cmSetName}
                </Text>
              ) : (
                t.cmSetName
              )}
            </>
          )}
        </Text>
        <SaveBtn pal={pal} testID="beads-comment-send" label={busy ? t.cmSending : t.cmSend} disabled={busy || !text.trim()} onPress={submit} />
      </View>
      {error ? <ErrorBox pal={pal} message={error} testID="beads-comment-error" /> : null}
    </View>
  );
}

// ── the header ───────────────────────────────────────────────────────

/** The background export / sync, as a quiet badge beside the mode (reference renderExport). */
export function ExportBadge() {
  const { pal, t } = useBeads();
  const w = useWrites();
  const b = w.badge;
  if (b.kind === "none") return null;
  const box = { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, borderWidth: 1, alignSelf: "center" as const };
  if (b.kind === "running") {
    return (
      <View testID="beads-export-running" style={[box, { borderColor: "transparent" }]}>
        <ActivityIndicator size={10 as never} color={pal.link} />
        <Text style={{ fontSize: FONT.mark + 0.5, color: pal.muted }}>{b.syncing ? t.syncRunning : t.expRunning}</Text>
      </View>
    );
  }
  if (b.kind === "stale") {
    return (
      <View testID="beads-export-stale" ref={titled(`${t.expStaleTip}\n\n${b.error}`) as never} style={[box, { borderColor: mix(pal.critical, 40, pal.border), paddingRight: 2 }]}>
        <Text style={{ fontSize: FONT.mark + 0.5, color: pal.critical }}>{t.expStale}</Text>
        <Btn pal={pal} small testID="beads-export-retry" label={t.expRetry} onPress={w.exportAgain} />
      </View>
    );
  }
  const imp = b.imported;
  const text = imp ? (imp.added || imp.changed ? t.syncPulled(imp.added, imp.changed) : t.syncSame) : t.expDone;
  return (
    <View testID="beads-export-done" style={[box, { borderColor: "transparent" }]}>
      <Text style={{ fontSize: FONT.mark + 0.5, color: pal.good }}>{text}</Text>
    </View>
  );
}

/** Sync: reconcile issues.jsonl and the database, both ways (bd mode only). */
export function SyncButton() {
  const { pal, t, data } = useBeads();
  const w = useWrites();
  const mode = data.state.tree?.mode;
  if (!mode) return null;
  return (
    <Btn
      pal={pal}
      icon="RefreshCcw"
      label={t.sync}
      testID="beads-sync"
      title={mode === "jsonl" ? t.syncJsonl : t.syncTip}
      disabled={mode !== "bd" || w.badge.kind === "running"}
      onPress={w.sync}
    />
  );
}

/** The gear: this plugin's page in Paseo's Settings. */
export function SettingsButton() {
  const { pal, t } = useBeads();
  const open = useOpenSettings();
  if (!open) return null;
  return <Btn pal={pal} icon="Settings" title={t.settings} testID="beads-settings" onPress={open} />;
}

/** New issue, at the end of the toolbar. */
export function NewIssueButton() {
  const { pal, t, data } = useBeads();
  const w = useWrites();
  const mode = data.state.tree?.mode;
  return (
    <Btn
      pal={pal}
      icon="Plus"
      label={t.newIssue}
      testID="beads-new"
      title={mode === "bd" ? t.newIssue : t.newJsonl}
      disabled={mode !== "bd"}
      onPress={() => w.openEditor({ mode: "create", parent: null })}
    />
  );
}
