/**
 * The explorer's own view of beads (panel "beads-explorer", Paseo's right
 * sidebar, 240–~400 px wide): not a smaller copy of the tab but the reader's
 * work at a glance — their issues in progress and ready to pick up, counts,
 * a quick search. Picking an issue opens it in the Beads tab
 * (client/intent.ts, requestOpen); the explorer never takes an intent itself.
 *
 * The rows come from the same cache entry and the same revision poller as
 * the tab's (client/data.ts, useBeadsTree): with the tab already loaded,
 * opening the explorer asks the daemon for nothing. The pure part — whose,
 * which section, the search, the counts, the remembered state — is
 * shared/explorer.ts.
 */

import type { PluginTab, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { useTabState, useWorkspace } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { z } from "zod";
import { EXPLORER_DEFAULT, EXPLORER_PAGE, ExplorerStateSchema, SECTIONS, explorerView, type ExplorerState, type Section } from "../shared/explorer.ts";
import type { TreeRow } from "../shared/types.ts";
import { useBeadsTree, useSearch } from "./data.ts";
import { EmptyBox, emptyText } from "./empty.tsx";
import { NO_OUTLINE, inputStyle } from "./filters.tsx";
import { baseName, priorityTitle, typeLabel } from "./format.ts";
import { useStrings } from "./i18n/messages.ts";
import type { Strings } from "./i18n/strings.ts";
import { requestOpen } from "./intent.ts";
import { useBeadsSettings } from "./settings.tsx";
import { createTabSaver, type TabSaver } from "./tab-saver.ts";
import { FONT, MONO, MONO_DOM, mix, paletteOf, type Palette } from "./theme.ts";
import { Btn, Chevron, PriIcon, TypeGlyph, titled } from "./ui.tsx";

/** `openSettings` opens the plugin's page in Paseo's Settings (index.client.tsx passes it). */
export function BeadsExplorer(props: PluginWorkspacePanelProps & { openSettings?: () => void }) {
  const { workspaceId, openSettings } = props;
  const t = useStrings();
  const pal = paletteOf(props.theme);
  const settings = useBeadsSettings();
  const data = useBeadsTree(props.host.id, workspaceId, settings.pollMs);
  const [st, setSt] = useExplorerState(props.tab);
  const me = settings.currentUser.trim();
  const tree = data.state.tree;
  const rows = tree?.issues ?? null;
  // The server's full-text search, as in the tab — only once there is a list to search.
  const found = useSearch(workspaceId, me && rows ? st.query : "", data.state.revision);
  const view = useMemo(() => (rows ? explorerView(rows, { me, query: st.query, hits: found.ids }) : null), [rows, me, st.query, found.ids]);
  const [pages, setPages] = useState<Record<Section, number>>({ doing: 1, ready: 1 });
  const directory = useWorkspace(workspaceId, (w) => w.directory);
  const project = baseName(tree?.root ?? data.state.empty?.project ?? directory);

  const openTab = useCallback(
    (issueId?: string) => {
      try {
        requestOpen(workspaceId, issueId ? { issueId } : {});
      } catch (e) {
        console.warn("[beads] could not open the tab:", (e as Error)?.message ?? e);
      }
    },
    [workspaceId],
  );

  let body: React.ReactNode;
  if (!tree) {
    if (data.state.empty) {
      const [head, hint] = emptyText(t, data.state.empty);
      body = <EmptyBox compact pal={pal} testID="beads-explorer-empty-failure" head={head} hint={hint} action={{ label: t.retryLoad, testID: "beads-explorer-retry", onPress: () => void data.load("manual") }} />;
    } else body = <EmptyBox compact pal={pal} testID="beads-explorer-empty-loading" head={t.loading} />;
  } else if (!settings.ready) {
    body = <EmptyBox compact pal={pal} testID="beads-explorer-empty-loading" head={t.loading} />;
  } else if (!me) {
    body = (
      <EmptyBox
        compact
        pal={pal}
        testID="beads-explorer-empty-noname"
        head={t.exNoName}
        hint={t.exNoNameHint}
        action={openSettings ? { label: t.exOpenSettings, testID: "beads-explorer-settings", onPress: openSettings } : null}
      />
    );
  } else if (!tree.issues.length) {
    body = <EmptyBox compact pal={pal} testID="beads-explorer-empty-none" head={t.emptyNoBeads} hint={t.emptyNoBeadsHint} />;
  } else if (view && !view.counts.doing && !view.counts.ready) {
    body = <EmptyBox compact pal={pal} testID="beads-explorer-empty-mine" head={t.exNothing} hint={t.exNothingHint(me)} />;
  } else if (view) {
    const none = !view.sections.doing.length && !view.sections.ready.length;
    body = none ? (
      <EmptyBox compact pal={pal} testID="beads-explorer-empty-search" head={t.exNoMatch} />
    ) : (
      SECTIONS.map((s) => (
        <SectionBlock
          key={s}
          pal={pal}
          t={t}
          section={s}
          rows={view.sections[s]}
          folded={st.collapsed.indexOf(s) >= 0}
          limit={pages[s] * EXPLORER_PAGE}
          onFold={() => setSt({ ...st, collapsed: st.collapsed.indexOf(s) >= 0 ? st.collapsed.filter((x) => x !== s) : [...st.collapsed, s] })}
          onMore={() => setPages((p) => ({ ...p, [s]: p[s] + 1 }))}
          onOpen={openTab}
        />
      ))
    );
  }

  const listed = Boolean(tree && settings.ready && me && view && (view.counts.doing || view.counts.ready));
  return (
    <View testID="beads-explorer" style={{ flex: 1, minHeight: 0, backgroundColor: pal.bg }}>
      <View style={{ paddingHorizontal: 12, paddingTop: 10, paddingBottom: 8, gap: 8 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8, flex: 1, minWidth: 0 }}>
            <Text style={{ color: pal.ink, fontSize: 15, fontWeight: "700" }}>{t.title}</Text>
            {project ? (
              <Text ref={titled(tree?.root ?? directory) as never} numberOfLines={1} style={{ color: pal.muted, fontSize: FONT.control, flexShrink: 1 }}>
                {project}
              </Text>
            ) : null}
          </View>
          <Btn pal={pal} small icon="ExternalLink" title={t.exOpenTab} testID="beads-explorer-open-tab" onPress={() => openTab()} />
        </View>
        {me && tree ? (
          <Pressable
            ref={titled(openSettings ? t.openSettings : null) as never}
            testID="beads-explorer-me"
            disabled={!openSettings}
            onPress={openSettings ?? undefined}
            accessibilityRole={openSettings ? "link" : undefined}
          >
            <Text numberOfLines={1} style={{ color: pal.muted, fontSize: FONT.status }}>
              {t.exMine(me)}
            </Text>
          </Pressable>
        ) : null}
        {listed && view ? <Counts pal={pal} t={t} counts={view.counts} /> : null}
        {data.state.loadIssue && tree ? (
          <Pressable testID="beads-explorer-stale" ref={titled(t.loadStaleTip) as never} onPress={() => void data.load("manual")} accessibilityRole="button">
            <Text style={{ color: pal.warning, fontSize: FONT.status }}>
              {t.loadStaleTitle} · {t.retryLoad}
            </Text>
          </Pressable>
        ) : null}
        {listed ? (
          <TextInput
            testID="beads-explorer-search"
            value={st.query}
            onChangeText={(query) => setSt({ ...st, query })}
            placeholder={t.exSearch}
            placeholderTextColor={pal.muted}
            accessibilityLabel={t.exSearch}
            autoCapitalize="none"
            autoCorrect={false}
            style={[inputStyle(pal), NO_OUTLINE]}
          />
        ) : null}
      </View>
      <ScrollView style={{ flex: 1, minHeight: 0 }} contentContainerStyle={{ paddingHorizontal: 6, paddingBottom: 12 }}>
        {body}
      </ScrollView>
    </View>
  );
}

/** The reader's three numbers: in progress, ready, open at all. */
function Counts({ pal, t, counts }: { pal: Palette; t: Strings; counts: { doing: number; ready: number; open: number } }) {
  const tile = (key: string, n: number, label: string, color: string, tip?: string) => (
    <View
      key={key}
      testID={`beads-explorer-count-${key}`}
      ref={titled(tip) as never}
      style={{ flex: 1, minWidth: 0, borderWidth: 1, borderColor: pal.border, borderRadius: 8, paddingVertical: 5, paddingHorizontal: 7 }}
    >
      <Text style={{ color, fontSize: 16, fontWeight: "700" }}>{n}</Text>
      {/* A 240 px explorer may not fit "in progress" on one line: it wraps rather than cuts. */}
      <Text numberOfLines={2} style={{ color: pal.muted, fontSize: FONT.mark }}>
        {label}
      </Text>
    </View>
  );
  return (
    <View style={{ flexDirection: "row", gap: 6 }}>
      {tile("doing", counts.doing, t.exCountDoing, pal.good)}
      {tile("ready", counts.ready, t.exCountReady, pal.link)}
      {tile("open", counts.open, t.exCountOpen, pal.ink, t.exCountOpenTip)}
    </View>
  );
}

function SectionBlock({ pal, t, section, rows, folded, limit, onFold, onMore, onOpen }: {
  pal: Palette;
  t: Strings;
  section: Section;
  rows: readonly TreeRow[];
  folded: boolean;
  limit: number;
  onFold: () => void;
  onMore: () => void;
  onOpen: (id: string) => void;
}) {
  const shown = folded ? [] : rows.slice(0, limit);
  const rest = folded ? 0 : rows.length - shown.length;
  return (
    <View testID={`beads-explorer-section-${section}`} style={{ marginTop: 4 }}>
      <Pressable
        testID={`beads-explorer-fold-${section}`}
        onPress={onFold}
        accessibilityRole="button"
        accessibilityState={{ expanded: !folded }}
        style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 6, paddingVertical: 6 }}
      >
        <Chevron pal={pal} open={!folded} />
        <Text style={{ color: pal.ink2, fontSize: FONT.secHead, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" }}>
          {section === "doing" ? t.exDoing : t.exReady}
        </Text>
        <Text style={{ color: pal.muted, fontSize: FONT.secHead }}>{rows.length}</Text>
      </Pressable>
      {!folded && !rows.length ? <Text style={{ color: pal.muted, fontSize: FONT.status, paddingHorizontal: 24, paddingBottom: 6 }}>{t.exSectionEmpty}</Text> : null}
      {shown.map((row) => (
        <IssueRow key={row.id} pal={pal} t={t} row={row} onOpen={onOpen} />
      ))}
      {rest > 0 ? <Btn pal={pal} small label={t.boardMore(rest)} testID={`beads-explorer-more-${section}`} style={{ alignSelf: "flex-start", marginLeft: 6, marginTop: 4 }} onPress={onMore} /> : null}
    </View>
  );
}

/** Two lines: the title, then the id and the priority. */
function IssueRow({ pal, t, row, onOpen }: { pal: Palette; t: Strings; row: TreeRow; onOpen: (id: string) => void }) {
  return (
    <Pressable
      ref={titled(`${row.title}\n${t.exOpenIssue}`) as never}
      testID={`beads-explorer-row-${row.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${row.id} ${row.title}`}
      onPress={() => onOpen(row.id)}
      style={(s) => ({
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 8,
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: (s as { hovered?: boolean }).hovered ? pal.hover : "transparent",
      })}
    >
      <View ref={titled(typeLabel(t, row.issue_type)) as never} style={{ paddingTop: 1 }}>
        <TypeGlyph pal={pal} type={row.issue_type} size={16} />
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text numberOfLines={1} style={{ color: pal.ink, fontSize: FONT.rowTitle }}>
          {row.title}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text {...MONO_DOM} numberOfLines={1} style={{ fontFamily: MONO, fontSize: FONT.id, color: pal.muted, flexShrink: 1 }}>
            {row.id}
          </Text>
          {row.priority != null ? (
            <View ref={titled(priorityTitle(t, row.priority)) as never} style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
              <PriIcon pal={pal} priority={row.priority} size={12} />
              <Text style={{ color: mix(pal.muted, 80, pal.bg), fontSize: FONT.mark }}>P{row.priority}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

/**
 * The explorer's tab state (shared/explorer.ts), written a moment after it
 * stops changing (client/tab-saver.ts) and at once when the panel goes away.
 */
function useExplorerState(tab: PluginTab): [ExplorerState, (next: ExplorerState) => void] {
  const [saved, save] = useTabState(tab, ExplorerStateSchema as unknown as z.ZodType<ExplorerState>, EXPLORER_DEFAULT);
  const [st, setSt] = useState<ExplorerState>(saved);
  const saveRef = useRef(save);
  saveRef.current = save;
  const saver = useRef<TabSaver | null>(null);
  if (!saver.current) saver.current = createTabSaver((json) => saveRef.current(JSON.parse(json) as ExplorerState));
  const json = JSON.stringify(st);
  saver.current.seed(json);
  useEffect(() => {
    saver.current!.push(json);
  }, [json]);
  useEffect(() => () => saver.current!.flush(), []);
  return [st, setSt];
}
