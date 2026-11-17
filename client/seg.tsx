/**
 * A segmented control (the reference's .cbd-seg): buttons joined in one
 * outlined strip, the chosen one in the accent. Used by the view switch, the
 * charts tabs and the period / step pickers.
 *
 * As a tablist (`role="tablist"`) ArrowLeft / ArrowRight walk the options on
 * web and move the focus with them, as a tablist is expected to.
 */

import { Icon } from "@getpaseo/plugin/client/ui";
import { useRef, type ReactElement } from "react";
import { Platform, Pressable, Text, View, type ViewStyle } from "react-native";
import { FONT, mix, type Palette } from "./theme.ts";
import { titled } from "./ui.tsx";

export interface SegOption<V> {
  value: V;
  /** Text on the button; omit for an icon-only one. */
  label?: string;
  /** Lucide icon name. */
  icon?: string;
  /** Tooltip (web) and, for icon-only options, the accessible name. */
  tip?: string;
  /** Accessible name when it differs from the label. */
  aria?: string;
  testID?: string;
}

interface Focusable {
  focus?: () => void;
}

export interface SegProps<V> {
  pal: Palette;
  options: readonly SegOption<V>[];
  value: V;
  onChange: (v: V) => void;
  /** "tablist" makes the strip a tab list (arrow keys, aria-selected); "group" a toggle group. */
  role?: "tablist" | "group";
  aria?: string;
  testID?: string;
  style?: ViewStyle;
}

/** One strip of joined buttons, exactly one of them chosen. */
export function Seg<V>({ pal, options, value, onChange, role = "group", aria, testID, style }: SegProps<V>): ReactElement {
  const refs = useRef<(Focusable | null)[]>([]);
  const at = options.findIndex((o) => o.value === value);
  const keys =
    Platform.OS === "web" && role === "tablist"
      ? {
        onKeyDown: (e: { key: string; preventDefault: () => void }) => {
          const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
          if (!step || !options.length) return;
          e.preventDefault();
          const next = (Math.max(0, at) + step + options.length) % options.length;
          onChange(options[next]!.value);
          refs.current[next]?.focus?.();
        },
      }
      : {};
  return (
    <View
      testID={testID}
      accessibilityRole={role === "tablist" ? "tablist" : undefined}
      accessibilityLabel={aria}
      style={[{ flexDirection: "row", borderWidth: 1, borderColor: pal.border, borderRadius: 8, overflow: "hidden", alignSelf: "flex-start" }, style]}
      {...(keys as object)}
    >
      {options.map((o, i) => {
        const on = i === at;
        const ink = on ? pal.link : pal.ink2;
        return (
          <Pressable
            key={String(o.value)}
            ref={(node) => {
              refs.current[i] = node as unknown as Focusable | null;
              const set = titled(o.tip);
              if (set) set(node);
            }}
            testID={o.testID}
            accessibilityRole={role === "tablist" ? "tab" : "button"}
            accessibilityLabel={o.aria ?? o.label ?? o.tip}
            accessibilityState={role === "tablist" ? { selected: on } : { selected: on }}
            onPress={() => {
              if (!on) onChange(o.value);
            }}
            style={(st) => ({
              height: 28,
              minWidth: o.label ? undefined : 32,
              paddingHorizontal: o.label ? 10 : 0,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              borderLeftWidth: i ? 1 : 0,
              borderColor: pal.border,
              backgroundColor: on ? mix(pal.link, pal.dark ? 16 : 10, pal.card) : (st as { hovered?: boolean }).hovered ? pal.hover : pal.card,
            })}
          >
            {o.icon ? <Icon name={o.icon} size={15} color={ink} /> : null}
            {o.label ? (
              <Text numberOfLines={1} style={{ color: ink, fontSize: FONT.control }}>
                {o.label}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
