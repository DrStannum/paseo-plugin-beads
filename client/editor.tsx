/**
 * The edit / create form (reference openEditor): one form for both, opened
 * from the card's pencil, from New issue and from the card's + (which
 * pre-fills the parent). Editing sends only the fields that changed; creating
 * sends what the form holds and then opens the issue bd actually made.
 *
 * While the form holds unsaved input the panel's tab is marked modified, so
 * Paseo shows its dot and asks before the tab closes. Closing the form itself
 * with unsaved input asks first, in the form (the host has no confirm
 * dialog).
 */

import { Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import {
  addLabel, blankForm, computeFields, formFromCard, hasInput, isDirty, parentChoices, peopleOf, statusChoices, suggest, typeChoices,
  type IssueForm,
} from "../shared/form.ts";
import { useBeads } from "./beads.tsx";
import { priorityLabel, statusLabel, typeLabel } from "./format.ts";
import { useBeadsSettings } from "./settings.tsx";
import { FONT, MONO, MONO_DOM, mix, type Palette } from "./theme.ts";
import { Backdrop, Btn, LabelChip, Menu, PriIcon, StatusDot, TypeGlyph, titled, type MenuItem } from "./ui.tsx";
import { ErrorBox, SaveBtn, inputStyle } from "./write-controls.tsx";
import { useWrites, type EditorTarget } from "./writes.tsx";

/** Below this the form is one column. */
const TWO_COLUMNS_PX = 420;
/** How long a field's suggestion list outlives the field's focus (a click on it lands first). */
const BLUR_GRACE_MS = 180;

/** The open form, if any — rendered once by the panel. */
export function EditorHost() {
  const w = useWrites();
  if (!w.editor) return null;
  const key = w.editor.mode === "edit" ? `edit:${w.editor.card.id}` : `create:${w.editor.parent ?? ""}`;
  return <EditorModal key={key} target={w.editor} />;
}

function FieldLabel({ pal, text }: { pal: Palette; text: string }) {
  return <Text style={{ color: pal.muted, fontSize: FONT.control, marginBottom: 5 }}>{text}</Text>;
}

/** A select drawn like a field, whose options carry their icon (reference iconSelect). */
function FormSelect({ pal, value, items, icon, label, testID }: { pal: Palette; value: string; items: (close: () => void) => MenuItem[]; icon: ReactNode; label: string; testID: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ position: "relative", zIndex: open ? 80 : 1 }}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityValue={{ text: value }}
        onPress={() => setOpen(!open)}
        style={(st) => [inputStyle(pal), { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: (st as { hovered?: boolean }).hovered ? pal.hover : pal.card }]}
      >
        {icon}
        <Text numberOfLines={1} style={{ flex: 1, color: pal.ink, fontSize: FONT.md }}>{label}</Text>
        <Text style={{ fontSize: 9, color: pal.muted }}>▾</Text>
      </Pressable>
      {open ? <Backdrop onClose={() => setOpen(false)} /> : null}
      {open ? <Menu pal={pal} top={36} align="stretch" testID={`${testID}-menu`} items={items(() => setOpen(false))} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

/**
 * A text field with a suggestion list under it while focused (reference
 * autocomplete): arrows walk it on web, Enter takes the highlighted one,
 * Escape puts it away; typing by hand always works.
 */
function Combo({ pal, value, onChange, onPick, suggestions, placeholder, testID, onSubmit, inputWidth, emptyText }: {
  pal: Palette;
  value: string;
  onChange: (v: string) => void;
  /** A suggestion was taken (default: it becomes the value). */
  onPick?: (v: string) => void;
  suggestions: (needle: string) => { value: string; label: string; icon?: ReactNode }[];
  placeholder?: string;
  testID: string;
  /** Enter with nothing highlighted (the label field adds what was typed). */
  onSubmit?: () => void;
  inputWidth?: number;
  emptyText?: string;
}) {
  const [focused, setFocused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const blur = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (blur.current) clearTimeout(blur.current);
  }, []);
  const list = focused ? suggestions(value) : [];
  const open = focused && !hidden && (list.length > 0 || Boolean(emptyText && value.trim()));
  return (
    <View style={{ position: "relative", zIndex: open ? 80 : 1, width: inputWidth }}>
      <TextInput
        testID={testID}
        value={value}
        placeholder={placeholder}
        placeholderTextColor={pal.muted}
        autoCapitalize="none"
        autoCorrect={false}
        onChangeText={(v) => {
          setHidden(false);
          onChange(v);
        }}
        onFocus={() => {
          if (blur.current) clearTimeout(blur.current);
          setFocused(true);
          setHidden(false);
        }}
        onBlur={() => {
          blur.current = setTimeout(() => setFocused(false), BLUR_GRACE_MS);
        }}
        onSubmitEditing={onSubmit}
        blurOnSubmit={false}
        style={inputStyle(pal)}
      />
      {open ? (
        <Menu
          pal={pal}
          top={36}
          align={inputWidth ? "left" : "stretch"}
          minWidth={inputWidth ?? 160}
          testID={`${testID}-list`}
          empty={emptyText}
          onClose={() => setHidden(true)}
          items={list.map((s) => ({
            key: s.value,
            label: s.label,
            icon: s.icon,
            testID: `${testID}-opt-${s.value}`,
            onPick: () => {
              if (onPick) onPick(s.value);
              else onChange(s.value);
              setHidden(true);
            },
          }))}
        />
      ) : null}
    </View>
  );
}

function EditorModal({ target }: { target: NonNullable<EditorTarget> }) {
  const b = useBeads();
  const { pal, t, data, index } = b;
  const w = useWrites();
  const me = useBeadsSettings().currentUser.trim();
  const creating = target.mode === "create";
  const id = target.mode === "edit" ? target.card.id : null;
  const original = useMemo<IssueForm>(() => (target.mode === "edit" ? formFromCard(target.card) : blankForm(target.parent)), [target]);
  const [form, setForm] = useState<IssueForm>(original);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [labelDraft, setLabelDraft] = useState("");
  const [width, setWidth] = useState(0);
  const set = <K extends keyof IssueForm>(k: K, v: IssueForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const dirty = isDirty(original, form, creating);
  const unsaved = hasInput(original, form, creating) || Boolean(labelDraft.trim());
  // Paseo's unsaved dot on the tab, and its question before the tab closes.
  const tab = w.tab;
  useEffect(() => {
    tab.setModified(unsaved);
  }, [tab, unsaved]);
  useEffect(() => () => tab.setModified(false), [tab]);

  const close = () => w.openEditor(null);
  const requestClose = () => {
    if (saving) return;
    if (confirming) {
      setConfirming(false);
      return;
    }
    if (unsaved) setConfirming(true);
    else close();
  };

  const save = async () => {
    if (saving || !dirty) return;
    setSaving(true);
    setError(null);
    setConfirming(false);
    const res = creating ? await w.create(computeFields(original, form, true)) : await w.edit(id!, computeFields(original, form, false));
    if (!res.ok) {
      setSaving(false);
      setError(`${t.eFailed}: ${res.message}`);
      return;
    }
    tab.setModified(false);
    close();
    // bd, not the form, decides the new id: open what it actually made.
    if (creating) b.openIssue(res.id);
  };

  const rows = data.state.tree?.issues ?? [];
  const people = useMemo(() => peopleOf(rows), [rows]);
  const projectLabels = useMemo(() => (index ? Array.from(index.labelSlots.keys()).sort() : []), [index]);
  const types = typeChoices(Object.keys(data.state.tree?.counts.byType ?? {}), original.issue_type);
  const statuses = statusChoices(Object.keys(data.state.tree?.counts.byStatus ?? {}), original.status);
  const slot = (l: string) => index?.labelSlots.get(l) ?? 0;

  const two = width >= TWO_COLUMNS_PX;
  const field = (key: string, label: string, control: ReactNode, wide = false, z = 1) => (
    <View key={key} style={{ width: wide || !two ? "100%" : "48.5%", zIndex: z }}>
      <FieldLabel pal={pal} text={label} />
      {control}
    </View>
  );
  const area = (key: "description" | "design" | "acceptance_criteria" | "notes", label: string) =>
    field(
      key,
      label,
      <TextInput
        {...MONO_DOM}
        testID={`beads-ef-${key}`}
        multiline
        value={form[key]}
        onChangeText={(v) => set(key, v)}
        spellCheck={false}
        style={[inputStyle(pal, true), { height: 128, fontFamily: MONO, fontSize: FONT.md - 0.5 }]}
      />,
      true,
    );

  const priItems = (closeMenu: () => void): MenuItem[] => {
    const out: MenuItem[] = [];
    if (original.priority == null) out.push({ key: "unset", label: t.eUnset, selected: form.priority == null, onPick: () => { closeMenu(); set("priority", null); } });
    for (let p = 0; p <= 4; p++) {
      out.push({
        key: String(p),
        label: `P${p} — ${priorityLabel(t, p)}`,
        icon: <PriIcon pal={pal} priority={p} />,
        selected: form.priority === p,
        testID: `beads-ef-priority-${p}`,
        onPick: () => {
          closeMenu();
          set("priority", p);
        },
      });
    }
    return out;
  };

  const sub = creating ? (target.mode === "create" && target.parent ? t.cUnder(target.parent) : "") : original.title;
  const fields: ReactNode[] = [
    field(
      "title",
      t.eTitle,
      <TextInput
        testID="beads-ef-title"
        value={form.title}
        autoFocus
        selectTextOnFocus={!creating}
        onChangeText={(v) => set("title", v)}
        onSubmitEditing={() => void save()}
        style={inputStyle(pal)}
      />,
      true,
    ),
    field(
      "type",
      t.eType,
      <FormSelect
        pal={pal}
        testID="beads-ef-type"
        value={form.issue_type}
        label={typeLabel(t, form.issue_type)}
        icon={<TypeGlyph pal={pal} type={form.issue_type} />}
        items={(closeMenu) =>
          types.map((ty) => ({
            key: ty, label: typeLabel(t, ty), icon: <TypeGlyph pal={pal} type={ty} />, selected: ty === form.issue_type, testID: `beads-ef-type-${ty}`,
            onPick: () => { closeMenu(); set("issue_type", ty); },
          }))
        }
      />,
      false,
      30,
    ),
  ];
  // `bd create` has no --status: a new issue is open by definition.
  if (!creating) {
    fields.push(
      field(
        "status",
        t.eStatus,
        <FormSelect
          pal={pal}
          testID="beads-ef-status"
          value={form.status}
          label={statusLabel(t, form.status)}
          icon={<StatusDot pal={pal} status={form.status} />}
          items={(closeMenu) =>
            statuses.map((s) => ({
              key: s, label: statusLabel(t, s), icon: <StatusDot pal={pal} status={s} />, selected: s === form.status, testID: `beads-ef-status-${s}`,
              onPick: () => { closeMenu(); set("status", s); },
            }))
          }
        />,
        false,
        29,
      ),
    );
  }
  fields.push(
    field(
      "priority",
      t.ePriority,
      <FormSelect
        pal={pal}
        testID="beads-ef-priority"
        value={String(form.priority ?? "")}
        label={form.priority == null ? t.eUnset : `P${form.priority} — ${priorityLabel(t, form.priority)}`}
        icon={form.priority == null ? null : <PriIcon pal={pal} priority={form.priority} />}
        items={priItems}
      />,
      false,
      28,
    ),
    field(
      "assignee",
      t.eAssignee,
      <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
        <View style={{ flex: 1 }}>
          <Combo
            pal={pal}
            testID="beads-ef-assignee"
            value={form.assignee}
            onChange={(v) => set("assignee", v)}
            suggestions={(n) => suggest(people, n).map((p) => ({ value: p, label: p }))}
          />
        </View>
        {/* Only fills the field: Save is what writes it. */}
        {me && me !== form.assignee.trim() ? <Btn pal={pal} testID="beads-ef-assign-me" label={t.assignToMe} onPress={() => set("assignee", me)} /> : null}
      </View>,
      false,
      27,
    ),
    field(
      "parent",
      t.eParent,
      <Combo
        pal={pal}
        testID="beads-ef-parent"
        value={form.parent}
        placeholder={t.eNoParent}
        onChange={(v) => set("parent", v)}
        suggestions={(n) => parentChoices(rows, id, n).map((r) => ({ value: r.id, label: `${r.id} — ${r.title}` }))}
      />,
      false,
      26,
    ),
    field("external", t.eExternal, <TextInput testID="beads-ef-external" value={form.external_ref} onChangeText={(v) => set("external_ref", v)} style={inputStyle(pal)} />, false, 1),
    field(
      "labels",
      t.eLabels,
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
        {form.labels
          .slice()
          .sort()
          .map((l) => (
            <Pressable
              key={l}
              testID={`beads-ef-label-x-${l}`}
              ref={titled(t.eRemoveLabel(l)) as never}
              accessibilityRole="button"
              accessibilityLabel={t.eRemoveLabel(l)}
              onPress={() => set("labels", form.labels.filter((x) => x !== l))}
              style={{ flexDirection: "row", alignItems: "center", gap: 3 }}
            >
              <LabelChip pal={pal} big slot={slot(l)} text={l} />
              <Text style={{ color: pal.muted, fontSize: FONT.control, fontWeight: "700" }}>✕</Text>
            </Pressable>
          ))}
        <Combo
          pal={pal}
          testID="beads-ef-label-input"
          inputWidth={180}
          value={labelDraft}
          placeholder={t.eAddLabel}
          emptyText={t.noMatches}
          onChange={setLabelDraft}
          onPick={(v) => {
            set("labels", addLabel(form.labels, v));
            setLabelDraft("");
          }}
          onSubmit={() => {
            set("labels", addLabel(form.labels, labelDraft));
            setLabelDraft("");
          }}
          suggestions={(n) => suggest(projectLabels, n, form.labels).map((l) => ({ value: l, label: "", icon: <LabelChip pal={pal} slot={slot(l)} text={l} /> }))}
        />
        <Btn
          pal={pal}
          testID="beads-ef-label-add"
          label={t.eAdd}
          onPress={() => {
            set("labels", addLabel(form.labels, labelDraft));
            setLabelDraft("");
          }}
        />
      </View>,
      true,
      25,
    ),
  );
  // Only meaningful once the status heads to closed: bd close records it.
  if (!creating && form.status === "closed") {
    fields.push(field("reason", t.eCloseReason, <TextInput testID="beads-ef-reason" value={form.close_reason} onChangeText={(v) => set("close_reason", v)} style={inputStyle(pal)} />, true));
  }
  fields.push(area("description", t.fDescription), area("design", t.fDesign), area("acceptance_criteria", t.fCriteria), area("notes", t.fNotes));

  return (
    <Modal open title={creating ? t.cHead : t.eHead(id!)} onOpenChange={(o) => (o ? undefined : requestClose())}>
      {/* Our own scroller, so the buttons stay put under it (reference .cbd-modal-foot). */}
      <Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }} style={{ flexShrink: 1, minHeight: 0 }}>
        <View testID="beads-editor" style={{ flexShrink: 1, minHeight: 0 }}>
          <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ padding: 20, gap: 12 }} keyboardShouldPersistTaps="handled">
            <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))} style={{ gap: 12 }}>
              {sub ? (
                <Text {...MONO_DOM} numberOfLines={1} style={{ fontFamily: MONO, fontSize: FONT.control, color: pal.muted, marginTop: -6 }}>
                  {sub}
                </Text>
              ) : null}
              <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: "3%" as never, rowGap: 12 }}>{fields}</View>
              {error ? <ErrorBox pal={pal} message={error} testID="beads-ef-error" /> : null}
            </View>
          </ScrollView>
          <View
            style={{
              flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: pal.border,
              ...(confirming ? { backgroundColor: mix(pal.warning, 10, pal.card) } : null),
              ...(Platform.OS === "web" ? null : { paddingBottom: 28 }),
            }}
          >
            {confirming ? (
              <>
                <Text testID="beads-ef-discard-q" style={{ flex: 1, color: pal.ink, fontSize: FONT.md }}>{t.eDiscard}</Text>
                <Btn pal={pal} testID="beads-ef-keep" label={t.eDiscardNo} onPress={() => setConfirming(false)} />
                <Btn pal={pal} testID="beads-ef-discard" label={t.eDiscardYes} onPress={close} style={{ borderColor: mix(pal.critical, 45, pal.border) }} />
              </>
            ) : (
              <>
                <View style={{ flex: 1 }} />
                <Btn pal={pal} testID="beads-ef-cancel" label={t.eCancel} disabled={saving} onPress={requestClose} />
                <SaveBtn
                  pal={pal}
                  testID="beads-ef-save"
                  label={saving ? (creating ? t.cCreating : t.eSaving) : creating ? t.cCreate : t.eSave}
                  disabled={saving || !dirty}
                  onPress={() => void save()}
                />
              </>
            )}
          </View>
        </View>
      </Modal.Content>
    </Modal>
  );
}
