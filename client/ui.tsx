/**
 * Small building blocks the panel's parts share: buttons, the type glyph,
 * priority icon, status dot, readiness mark, label chip, a dropdown menu,
 * and native tooltips on web.
 */

import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { typeGlyph } from "../shared/tree.ts";
import { FONT, MONO, MONO_DOM, alpha, mix, type Palette } from "./theme.ts";

/** What a web host node offers for a tooltip (no DOM lib in this project). */
interface TitledNode {
  setAttribute?: (name: string, value: string) => void;
  removeAttribute?: (name: string) => void;
}

/**
 * A ref that sets the element's native `title` on web, where react-native-web
 * renders host components as DOM nodes and drops a `title` prop. A no-op on
 * native, which has no hover.
 */
export function titled(text: string | null | undefined) {
  if (Platform.OS !== "web") return undefined;
  return (node: unknown) => {
    const n = node as TitledNode | null;
    if (!n || typeof n.setAttribute !== "function") return;
    if (text) n.setAttribute("title", text);
    else n.removeAttribute?.("title");
  };
}

export interface BtnProps {
  pal: Palette;
  label?: string;
  /** Lucide icon name. */
  icon?: string;
  onPress?: () => void;
  disabled?: boolean;
  /** Toggle state: accent ink and border. */
  pressed?: boolean;
  title?: string;
  testID?: string;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/** The reference's .cbd-btn: 30 px tall, radius 8, a hairline border. */
export function Btn({ pal, label, icon, onPress, disabled, pressed, title, testID, small, style, children }: BtnProps) {
  const h = small ? 22 : 30;
  const ink = pressed ? pal.link : pal.ink2;
  return (
    <Pressable
      ref={titled(title) as never}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title ?? label}
      accessibilityState={{ disabled: Boolean(disabled), selected: pressed }}
      disabled={disabled}
      onPress={onPress}
      style={(st) => {
        const hovered = (st as { hovered?: boolean }).hovered;
        return [
          {
            height: h,
            minWidth: h,
            paddingHorizontal: label ? (small ? 8 : 10) : 0,
            borderRadius: small ? 6 : 8,
            borderWidth: 1,
            borderColor: pressed ? mix(pal.link, 45, pal.border) : pal.border,
            backgroundColor: hovered && !disabled ? pal.hover : pal.card,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            opacity: disabled ? 0.45 : 1,
          } as ViewStyle,
          style,
        ];
      }}
    >
      {icon ? <Icon name={icon} size={small ? 12 : 14} color={ink} /> : null}
      {label ? (
        <Text numberOfLines={1} style={{ color: ink, fontSize: small ? FONT.mark + 0.5 : FONT.control }}>
          {label}
        </Text>
      ) : null}
      {children}
    </Pressable>
  );
}

/** The 18×18 type letter: hue for epic/bug/feature, muted for the rest. */
export function TypeGlyph({ pal, type, size = 18 }: { pal: Palette; type: string; size?: number }) {
  return (
    <View
      style={{
        width: size, height: size, borderRadius: 5, backgroundColor: pal.type(type),
        alignItems: "center", justifyContent: "center", flexShrink: 0,
      }}
    >
      <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700", lineHeight: 12 }}>{typeGlyph(type)}</Text>
    </View>
  );
}

/** P0..P4 as chevrons, Tracker-style. */
const PRI_ICONS = ["ChevronsUp", "ChevronUp", "Equal", "ChevronDown", "ChevronsDown"];

export function PriIcon({ pal, priority, size = 14 }: { pal: Palette; priority: number | null; size?: number }) {
  if (priority == null || priority < 0 || priority > 4) return <View style={{ width: size, height: size }} />;
  return <Icon name={PRI_ICONS[priority]!} size={size} color={pal.pri(priority)} />;
}

/** Status dot: open is a ring, the rest are filled. */
export function StatusDot({ pal, status, size = 8 }: { pal: Palette; status: string; size?: number }) {
  const open = status === "open";
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2, flexShrink: 0,
        backgroundColor: pal.status(status),
        borderWidth: open ? 1.5 : 0, borderColor: pal.ink2,
      }}
    />
  );
}

/** "ready" / "blocked" pill. */
export function Mark({ pal, kind, label, title, style }: { pal: Palette; kind: "ready" | "blocked"; label: string; title?: string; style?: StyleProp<ViewStyle> }) {
  const c = kind === "ready" ? pal.good : pal.critical;
  return (
    <View
      ref={titled(title) as never}
      style={[{ borderWidth: 1, borderColor: alpha(c, 45), borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, alignItems: "center" }, style]}
    >
      <Text numberOfLines={1} style={{ color: c, fontSize: FONT.mark }}>
        {label}
      </Text>
    </View>
  );
}

/** A label: hue carries identity, the text stays ink. */
export function LabelChip({ pal, slot, text, title, big, onPress }: { pal: Palette; slot: number; text: string; title?: string; big?: boolean; onPress?: () => void }) {
  const hue = slot ? pal.label(slot) : pal.ink;
  const style: ViewStyle = {
    backgroundColor: mix(hue, 14, pal.card),
    borderColor: alpha(hue, 32),
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: big ? 7 : 5,
    paddingVertical: big ? 2 : 0,
    maxWidth: big ? undefined : 120,
    flexShrink: 1,
  };
  const label = (
    <Text numberOfLines={1} style={{ color: pal.ink2, fontSize: big ? FONT.label + 1 : FONT.label }}>
      {text}
    </Text>
  );
  if (onPress) {
    return (
      <Pressable ref={titled(title) as never} onPress={onPress} style={style} accessibilityRole="button">
        {label}
      </Pressable>
    );
  }
  return (
    <View ref={titled(title) as never} style={style}>
      {label}
    </View>
  );
}

/** A twisty chevron: points right, down when open. */
export function Chevron({ pal, open, size = 12, color }: { pal: Palette; open: boolean; size?: number; color?: string }) {
  return <Icon name={open ? "ChevronDown" : "ChevronRight"} size={size} color={color ?? pal.muted} />;
}

export function Mono({ style, children, numberOfLines }: { style?: StyleProp<TextStyle>; children: ReactNode; numberOfLines?: number }) {
  return (
    <Text {...MONO_DOM} numberOfLines={numberOfLines} style={[{ fontFamily: MONO }, style]}>
      {children}
    </Text>
  );
}

/**
 * Closes a floating menu on a click anywhere else (reference: the document
 * click handler of floatMenu / labelPicker). Web only — a fixed, transparent
 * layer under the menu; render it right before the menu, inside the same
 * raised container. Native has no stray pointer to catch.
 */
export function Backdrop({ onClose }: { onClose: () => void }) {
  if (Platform.OS !== "web") return null;
  return (
    <Pressable
      accessible={false}
      onPress={onClose}
      style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, cursor: "default" } as object}
    />
  );
}

/** What the key handlers use of a DOM keyboard event (no DOM lib in this project). */
export interface DomKeyEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

interface DomWindow {
  addEventListener(type: string, fn: (e: DomKeyEvent) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (e: DomKeyEvent) => void, capture?: boolean): void;
}

/**
 * While `active`, see every key press first (web only: a capture listener on
 * the window). Return true from the handler to take the press — it then
 * stops there, so an Escape that closes a menu inside the edit form does not
 * also close the form (reference floatMenu).
 */
export function useWebKeys(active: boolean, handler: (e: DomKeyEvent) => boolean) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!active || Platform.OS !== "web") return;
    const win = globalThis as unknown as DomWindow;
    if (typeof win.addEventListener !== "function") return;
    const fn = (e: DomKeyEvent) => {
      if (ref.current(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    win.addEventListener("keydown", fn, true);
    return () => win.removeEventListener("keydown", fn, true);
  }, [active]);
}

export interface MenuItem {
  key: string;
  label: string;
  /** Drawn before the label (a status dot, a type glyph, a priority icon). */
  icon?: ReactNode;
  /** The current value: ✓ and accent ink. */
  selected?: boolean;
  testID?: string;
  onPick: () => void;
}

/** Tallest a floating list grows before it scrolls. */
export const MENU_MAX_H = 280;

/**
 * The floating list of a menu (reference .cbd-menu + floatMenu): drawn in
 * place under its button, at most MENU_MAX_H tall and scrolling beyond that;
 * on web Escape closes it and the arrows walk it, Enter picks.
 */
export function Menu({ pal, items, onClose, top = 34, align = "left", minWidth = 160, testID, empty }: {
  pal: Palette;
  items: readonly MenuItem[];
  onClose: () => void;
  top?: number;
  align?: "left" | "right" | "stretch";
  minWidth?: number;
  testID?: string;
  /** Shown when there is nothing to list. */
  empty?: string;
}) {
  const [active, setActive] = useState(-1);
  useWebKeys(true, (e) => {
    if (e.key === "Escape") {
      onClose();
      return true;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!items.length) return true;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => (a < 0 ? (step > 0 ? 0 : items.length - 1) : (a + step + items.length) % items.length));
      return true;
    }
    if (e.key === "Enter" && active >= 0 && items[active]) {
      items[active]!.onPick();
      return true;
    }
    return false;
  });
  const place = align === "stretch" ? { left: 0, right: 0 } : align === "left" ? { left: 0 } : { right: 0 };
  return (
    <View
      testID={testID}
      accessibilityRole="menu"
      style={{
        position: "absolute", top, ...place, minWidth: align === "stretch" ? undefined : minWidth, maxHeight: MENU_MAX_H,
        paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: pal.border, backgroundColor: pal.card, zIndex: 60,
        shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
      }}
    >
      <ScrollView style={{ maxHeight: MENU_MAX_H - 10, flexGrow: 0 }} keyboardShouldPersistTaps="handled">
        {items.length ? (
          items.map((o, i) => (
            <Pressable
              key={o.key}
              testID={o.testID}
              accessibilityRole="menuitem"
              accessibilityState={{ selected: Boolean(o.selected) }}
              onPress={o.onPick}
              onHoverIn={() => setActive(i)}
              style={(st) => ({
                paddingHorizontal: 10, paddingVertical: 6, marginHorizontal: 4, borderRadius: 6, flexDirection: "row", gap: 8, alignItems: "center",
                backgroundColor: o.selected ? pal.sel : (st as { hovered?: boolean }).hovered || i === active ? pal.hover : "transparent",
              })}
            >
              {o.icon}
              <Text numberOfLines={1} style={{ color: o.selected ? pal.ink : pal.ink2, fontSize: FONT.control + 0.5, flex: 1 }}>{o.label}</Text>
              {o.selected ? <Text style={{ color: pal.link, fontSize: FONT.control }}>✓</Text> : null}
            </Pressable>
          ))
        ) : (
          <Text style={{ color: pal.muted, fontSize: FONT.control, paddingHorizontal: 12, paddingVertical: 6 }}>{empty ?? ""}</Text>
        )}
      </ScrollView>
    </View>
  );
}

export interface MenuOption<V> {
  value: V;
  label: string;
}

/**
 * A button that opens a small list under itself (the reference's iconSelect /
 * floatMenu). Drawn in place with a high zIndex — the panel has no popover API.
 */
export function Dropdown<V>({ pal, value, options, onChange, title, testID, align = "right" }: { pal: Palette; value: V; options: readonly MenuOption<V>[]; onChange: (v: V) => void; title?: string; testID?: string; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <View style={{ position: "relative", zIndex: open ? 50 : 1 }}>
      <Btn pal={pal} label={`${current?.label ?? ""} ▾`} title={title} testID={testID} onPress={() => setOpen(!open)} pressed={open} />
      {open ? <Backdrop onClose={() => setOpen(false)} /> : null}
      {open ? (
        <Menu
          pal={pal}
          align={align}
          minWidth={110}
          testID={testID ? `${testID}-menu` : undefined}
          onClose={() => setOpen(false)}
          items={options.map((o) => ({
            key: String(o.value),
            label: o.label,
            selected: o.value === value,
            testID: testID ? `${testID}-opt-${String(o.value)}` : undefined,
            onPick: () => {
              setOpen(false);
              if (o.value !== value) onChange(o.value);
            },
          }))}
        />
      ) : null}
    </View>
  );
}
