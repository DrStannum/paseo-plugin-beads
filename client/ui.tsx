/**
 * Small building blocks the panel's parts share: buttons, the type glyph,
 * priority icon, status dot, readiness mark, label chip, a dropdown menu,
 * and native tooltips on web.
 */

import { Icon } from "@getpaseo/plugin/client/ui";
import { useState, type ReactNode } from "react";
import { Platform, Pressable, Text, View, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { typeGlyph } from "../shared/tree.ts";
import { FONT, MONO, alpha, mix, type Palette } from "./theme.ts";

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
    <Text numberOfLines={numberOfLines} style={[{ fontFamily: MONO }, style]}>
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
        <View
          style={{
            position: "absolute", top: 34, ...(align === "left" ? { left: 0 } : { right: 0 }), minWidth: 110, paddingVertical: 4, borderRadius: 8,
            borderWidth: 1, borderColor: pal.border, backgroundColor: pal.card, zIndex: 50,
            shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 6,
          }}
        >
          {options.map((o) => (
            <Pressable
              key={String(o.value)}
              accessibilityRole="menuitem"
              onPress={() => {
                setOpen(false);
                if (o.value !== value) onChange(o.value);
              }}
              style={(st) => ({
                paddingHorizontal: 12, paddingVertical: 6, flexDirection: "row", gap: 8, alignItems: "center",
                backgroundColor: (st as { hovered?: boolean }).hovered ? pal.hover : "transparent",
              })}
            >
              <Text style={{ color: o.value === value ? pal.link : pal.ink2, fontSize: FONT.control, flex: 1 }}>{o.label}</Text>
              {o.value === value ? <Text style={{ color: pal.link, fontSize: FONT.control }}>✓</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
