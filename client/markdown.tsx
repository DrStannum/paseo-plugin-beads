import { openExternalUrl, type PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { Fragment, type ReactNode } from "react";
import { Linking, Platform, Text, View, type TextStyle } from "react-native";
import { parseMarkdown, splitIssueKeys, type Block, type Inline } from "../shared/markdown.ts";

type Theme = PluginWorkspacePanelProps["theme"];

export interface MarkdownProps {
  source: string | null | undefined;
  theme: Theme;
  /** Real ids of the open project: a key spelled out in text becomes a link. */
  isIssueKey?: (id: string) => boolean;
  onOpenIssue?: (id: string) => void;
  /** Link ink; the host accent by default (it can be a low-contrast hue). */
  linkColor?: string;
}

const MONO = Platform.select({ ios: "Menlo", android: "monospace", default: "ui-monospace, SFMono-Regular, Menlo, monospace" });
/** Paseo web forces its UI font on nodes without data-pmono (see MONO_DOM in theme.ts). */
const MONO_DOM = (Platform.OS === "web" ? { dataSet: { pmono: "" } } : {}) as object;

/** Only schemes that leave the app safely navigate; relative paths have nowhere to go here. */
function open(href: string) {
  if (/^https?:\/\//i.test(href)) void openExternalUrl(href);
  else if (/^mailto:/i.test(href)) void Linking.openURL(href).catch(() => {});
}

function navigable(href: string) {
  return /^(https?:\/\/|mailto:)/i.test(href);
}

/**
 * Issue text rendered as markdown. The parser yields nodes, never markup, so
 * every character of the source is drawn as text (invariant 3).
 */
export function Markdown({ source, theme, isIssueKey, onOpenIssue, linkColor }: MarkdownProps) {
  const blocks = parseMarkdown(source);
  if (!blocks.length) return null;
  const c = theme.colors;
  const base: TextStyle = { color: c.foreground, fontSize: 13, lineHeight: 19 };
  const linkStyle: TextStyle = { color: linkColor ?? c.accent, textDecorationLine: "underline" };

  function inline(nodes: Inline[], keyed: boolean, key = ""): ReactNode[] {
    return nodes.map((n, i) => {
      const k = `${key}${i}`;
      switch (n.t) {
        case "text":
          if (!keyed || !isIssueKey || !onOpenIssue) return <Fragment key={k}>{n.v}</Fragment>;
          return (
            <Fragment key={k}>
              {splitIssueKeys(n.v, isIssueKey).map((part, j) =>
                "key" in part ? (
                  <Text key={j} accessibilityRole="link" style={linkStyle} onPress={() => onOpenIssue(part.key)}>
                    {part.key}
                  </Text>
                ) : (
                  <Fragment key={j}>{part.text}</Fragment>
                ),
              )}
            </Fragment>
          );
        case "code":
          return (
            <Text {...MONO_DOM} key={k} style={{ fontFamily: MONO, fontSize: 12, backgroundColor: c.surface2 }}>
              {n.v}
            </Text>
          );
        case "strong":
          return <Text key={k} style={{ fontWeight: "700" }}>{inline(n.c, keyed, `${k}.`)}</Text>;
        case "em":
          return <Text key={k} style={{ fontStyle: "italic" }}>{inline(n.c, keyed, `${k}.`)}</Text>;
        case "del":
          return <Text key={k} style={{ textDecorationLine: "line-through" }}>{inline(n.c, keyed, `${k}.`)}</Text>;
        case "link":
          // A key inside a link's label is the link's own text, not a second target.
          return navigable(n.href) ? (
            <Text key={k} accessibilityRole="link" style={linkStyle} onPress={() => open(n.href)}>
              {inline(n.c, false, `${k}.`)}
            </Text>
          ) : (
            <Text key={k} style={{ textDecorationLine: "underline" }}>{inline(n.c, false, `${k}.`)}</Text>
          );
        case "image":
          return <Text key={k} style={{ color: c.foregroundMuted }}>{`🖼 ${n.alt || "image"}`}</Text>;
        case "br":
          return <Fragment key={k}>{"\n"}</Fragment>;
      }
    });
  }

  function block(b: Block, k: string, depth = 0): ReactNode {
    switch (b.t) {
      case "h": {
        const size = b.level <= 3 ? 16 : b.level === 4 ? 14 : 13;
        return <Text key={k} style={[base, { fontSize: size, fontWeight: "700", marginTop: 4 }]}>{inline(b.c, true)}</Text>;
      }
      case "p":
        return <Text key={k} style={base}>{inline(b.c, true)}</Text>;
      case "pre":
        return (
          <View key={k} style={{ backgroundColor: c.surface1, borderRadius: 6, padding: 8, borderWidth: 1, borderColor: c.border }}>
            <Text {...MONO_DOM} style={[base, { fontFamily: MONO, fontSize: 12 }]}>{b.v}</Text>
          </View>
        );
      case "hr":
        return <View key={k} style={{ height: 1, backgroundColor: c.border, marginVertical: 4 }} />;
      case "quote":
        return (
          <View key={k} style={{ borderLeftWidth: 3, borderLeftColor: c.border, paddingLeft: 10, gap: 6 }}>
            {b.c.map((x, i) => block(x, `${k}.${i}`))}
          </View>
        );
      case "table":
        return (
          <View key={k} style={{ borderWidth: 1, borderColor: c.border, borderRadius: 4 }}>
            {[b.head, ...b.rows].map((row, r) => (
              <View key={r} style={{ flexDirection: "row", borderTopWidth: r ? 1 : 0, borderTopColor: c.border, backgroundColor: r ? undefined : c.surface1 }}>
                {row.map((cell, i) => (
                  <Text key={i} style={[base, { flex: 1, padding: 6, fontWeight: r ? "400" : "600" }]}>
                    {inline(cell, true)}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        );
      case "list":
        return (
          <View key={k} style={{ gap: 2 }}>
            {b.items.map((item, i) => (
              <View key={i}>
                <View style={{ flexDirection: "row", gap: 6 }}>
                  <Text style={[base, { color: c.foregroundMuted, minWidth: 14 }]}>{b.ordered ? `${i + 1}.` : depth ? "◦" : "•"}</Text>
                  <Text style={[base, { flex: 1 }]}>
                    {item.box === null ? null : <Text style={{ color: item.box ? c.statusSuccess : c.foregroundMuted }}>{item.box ? "☑ " : "☐ "}</Text>}
                    {inline(item.c, true)}
                  </Text>
                </View>
                {item.sub.length ? <View style={{ paddingLeft: 20 }}>{item.sub.map((x, j) => block(x, `${k}.${i}.${j}`, depth + 1))}</View> : null}
              </View>
            ))}
          </View>
        );
    }
  }

  return <View style={{ gap: 8 }}>{blocks.map((b, i) => block(b, String(i)))}</View>;
}
