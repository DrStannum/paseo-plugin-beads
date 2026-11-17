/**
 * The issue card (reference paintCard and its helpers): history and close,
 * the key (copyable) beside the title, type / status / priority / readiness,
 * the properties, the four text blocks as markdown with issue keys as links,
 * the linked-issue tables, and the comment thread.
 *
 * What writes plugs in through CardSlots (client/write-controls.tsx):
 * `headerActions` (new sub-issue, edit), `statusControl` (the status menu),
 * `assigneeAction` ("Assign to me"), `notices` (a refused quick edit),
 * `commentBox`; `onLabelPress` is label → filter.
 */

import { copyText, Icon, ScrollView } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { REL_COLUMNS, REL_COLUMNS_DEFAULT, nextSort, toggleValue, relChildTree, relFlat, statusBreakdown, type ColumnDef, type RelEntry, type RelItem, type RelList } from "../shared/tree.ts";
import type { Card } from "../shared/types.ts";
import { useBeads } from "./beads.tsx";
import { useCard } from "./data.ts";
import { columnLabel, fmtDate, fmtDateShort, priorityLabel, priorityTitle, statusLabel, stringOf, typeLabel } from "./format.ts";
import { Markdown } from "./markdown.tsx";
import { useStore } from "./store.tsx";
import { FONT, MONO, MONO_DOM, mix, type Palette } from "./theme.ts";
import { Backdrop, Btn, Chevron, LabelChip, Mark, PriIcon, StatusDot, TypeGlyph, titled } from "./ui.tsx";

export interface CardSlots {
  /** Buttons between the history arrows and Close (new sub-issue, edit, pin). */
  headerActions?: (card: Card | null) => ReactNode;
  /** Replaces the read-only status label (the status menu). */
  statusControl?: (card: Card) => ReactNode;
  /** Under the comment thread (the add-comment box). */
  commentBox?: (card: Card) => ReactNode;
  /** Beside the assignee ("Assign to me"); null when it does not apply. */
  assigneeAction?: (card: Card) => ReactNode;
  /** Under the headline: why the last status / assignee change was refused. */
  notices?: (card: Card) => ReactNode;
  /** A label chip was pressed (toggle a label filter). Without it chips are plain. */
  onLabelPress?: (label: string) => void;
}

/** How long the "copied" note stays on the key. */
const COPIED_MS = 1400;

function SectionHead({ pal, children, onPress, testID, expanded, flat }: { pal: Palette; children: ReactNode; onPress?: () => void; testID?: string; expanded?: boolean; flat?: boolean }) {
  // `flat`: the caller draws the rule (a heading with a button beside it).
  const style = flat
    ? { flexDirection: "row" as const, alignItems: "center" as const, gap: 6, flex: 1, minWidth: 0, alignSelf: "stretch" as const }
    : {
        flexDirection: "row" as const, alignItems: "center" as const, gap: 6, marginBottom: 6, paddingBottom: 4,
        borderBottomWidth: 1, borderBottomColor: pal.grid,
      };
  if (!onPress) return <View style={style}>{children}</View>;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityState={{ expanded }} onPress={onPress} style={style}>
      {children}
    </Pressable>
  );
}

function SecLabel({ pal, text }: { pal: Palette; text: string }) {
  return <Text style={{ fontSize: FONT.secHead, textTransform: "uppercase", letterSpacing: 0.6, color: pal.muted }}>{text}</Text>;
}

/**
 * One card pane. `focus` is the card pinned in the left pane of two-card
 * mode (reference paintCard isFocus): no history arrows there (history
 * belongs to the pane you navigate in), and its pin button unpins. On a
 * narrow screen (`compact`) there is one pane, so no pin at all.
 */
export function CardPane({ id, compact, slots, focus = false }: { id: string | null; compact: boolean; slots: CardSlots; focus?: boolean }) {
  const b = useBeads();
  const { pal, t, data } = b;
  const { ui, dispatch } = useStore();
  const { data: cached, loading } = useCard(b.hostId, b.workspaceId, id, data.state.revision);
  const twoCards = Boolean(ui.focusId);

  if (!id) {
    return (
      <View testID="beads-card-empty" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 6 }}>
        <Text style={{ color: pal.ink, fontSize: 15, fontWeight: "600" }}>{twoCards ? t.pickRelated : t.pickIssue}</Text>
        <Text style={{ color: pal.muted, fontSize: FONT.md, textAlign: "center", maxWidth: 360 }}>{twoCards ? t.pickRelatedHint : t.pickIssueHint}</Text>
      </View>
    );
  }

  const card = cached?.card && cached.card.id === id ? cached.card : null;
  const row = b.index?.byId.get(id);
  return (
    <View testID={focus ? "beads-card-focus" : "beads-card"} style={{ flex: 1, minWidth: 0 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: pal.border }}>
        {focus ? null : (
          <>
            <Btn pal={pal} icon="ChevronLeft" title={t.back} testID="beads-card-back" disabled={ui.historyPos <= 0} onPress={() => dispatch({ type: "back" })} />
            <Btn pal={pal} icon="ChevronRight" title={t.forward} testID="beads-card-forward" disabled={ui.historyPos >= ui.history.length - 1} onPress={() => dispatch({ type: "forward" })} />
          </>
        )}
        <View style={{ flex: 1 }} />
        {card && cached?.note ? (
          <View
            ref={titled(cached.note.message || cached.note.code ? `${t.cardStaleTip}\n\n${cached.note.message || cached.note.code}` : t.cardStaleTip) as never}
            style={{ borderWidth: 1, borderColor: mix(pal.warning, 40, pal.border), borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 }}
          >
            <Text style={{ fontSize: FONT.status, color: pal.muted }}>{t.cardStale}</Text>
          </View>
        ) : null}
        {slots.headerActions?.(card)}
        {compact ? null : (
          <Btn
            pal={pal}
            icon={focus ? "Minimize2" : "Maximize2"}
            title={focus ? t.unpin : t.pin}
            testID={focus ? "beads-card-unpin" : "beads-card-pin"}
            pressed={focus}
            onPress={() => dispatch(focus ? { type: "unpin" } : { type: "pin", id })}
          />
        )}
        {/* One close for the whole thing: both cards go, the tree comes back. */}
        <Btn pal={pal} icon="X" title={twoCards ? t.closeAll : t.close} testID={focus ? "beads-card-focus-close" : "beads-card-close"} onPress={() => dispatch({ type: "closeAll" })} />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: compact ? 14 : 16, paddingTop: 14, paddingBottom: 28 }}>
        {card ? (
          <CardBody card={card} slots={slots} />
        ) : (
          <View style={{ gap: 8 }}>
            <Text style={{ color: pal.ink, fontSize: FONT.cardTitle, fontWeight: "600" }}>{row ? row.title : id}</Text>
            <Text style={{ color: pal.muted, fontSize: FONT.md }}>{loading || !cached?.failed ? t.loading : t.cardFailed}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function CopyKey({ id }: { id: string }) {
  const { pal, t } = useBeads();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return (
    <Pressable
      testID="beads-card-key"
      ref={titled(t.copyId) as never}
      accessibilityRole="button"
      accessibilityLabel={t.copyId}
      onPress={() => {
        copyText(id).then(
          () => {
            setCopied(true);
            if (timer.current) clearTimeout(timer.current);
            timer.current = setTimeout(() => setCopied(false), COPIED_MS);
          },
          () => undefined,
        );
      }}
      style={(st) => ({
        flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: pal.border, borderRadius: 7,
        paddingHorizontal: 8, paddingVertical: 2, marginTop: 1, flexShrink: 0,
        backgroundColor: (st as { hovered?: boolean }).hovered ? pal.hover : pal.raised,
      })}
    >
      <Text {...MONO_DOM} style={{ fontFamily: MONO, fontSize: FONT.id + 0.5, color: pal.ink2 }}>{copied ? `${id} · ${t.copied}` : id}</Text>
      <Text style={{ fontSize: 10, color: pal.muted }}>⧉</Text>
    </Pressable>
  );
}

function CardBody({ card, slots }: { card: Card; slots: CardSlots }) {
  const b = useBeads();
  const { pal, t } = b;
  const { ui, dispatch } = useStore();
  const blockers = (card.blockers ?? []).length;

  const meta: [string, ReactNode][] = [];
  const text = (v: string | null | undefined) => (v ? <Text style={{ color: pal.ink2, fontSize: FONT.meta }}>{v}</Text> : null);
  const push = (label: string, node: ReactNode) => {
    if (node) meta.push([label, node]);
  };
  push(t.mOwner, text(card.owner));
  // The row stays even with nobody assigned when "Assign to me" is on offer —
  // that is exactly when it is most useful.
  const assignAction = slots.assigneeAction?.(card) ?? null;
  if (card.assignee || assignAction) {
    meta.push([
      t.mAssignee,
      <View key="a" style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
        {text(card.assignee)}
        {assignAction}
      </View>,
    ]);
  }
  if (card.labels.length) {
    meta.push([
      t.mLabels,
      <View key="l" style={{ flexDirection: "row", flexWrap: "wrap", gap: 5 }}>
        {card.labels.map((label) => (
          <LabelChip
            key={label}
            pal={pal}
            big
            slot={b.index?.labelSlots.get(label) ?? 0}
            text={label}
            title={`${t.fLabel}: ${label}`}
            onPress={slots.onLabelPress ? () => slots.onLabelPress!(label) : undefined}
          />
        ))}
      </View>,
    ]);
  }
  push(t.mExternal, text(card.external_ref));
  push(t.mSpec, text(card.spec_id));
  push(t.mCreated, text([fmtDate(card.created_at, t.locale), card.created_by ? t.mBy(card.created_by) : null].filter(Boolean).join(" ")));
  push(t.mUpdated, text(fmtDate(card.updated_at, t.locale)));
  push(t.mStarted, text(fmtDate(card.started_at, t.locale)));
  push(t.mClosed, text(fmtDate(card.closed_at, t.locale)));
  push(t.mCloseReason, text(card.close_reason));
  push(t.mDefer, text(fmtDate(card.defer_until, t.locale)));
  const labelW = Math.min(170, Math.max(...meta.map(([l]) => l.length), 4) * 7.4 + 10);

  const md = (source: string | null) => <Markdown source={source} theme={b.theme} isIssueKey={b.isIssueKey} onOpenIssue={b.openIssue} linkColor={pal.link} />;
  const textBlock = (label: string, source: string | null) =>
    source ? (
      <View key={label} style={{ marginTop: 18 }}>
        <SectionHead pal={pal}>
          <SecLabel pal={pal} text={label} />
        </SectionHead>
        {md(source)}
      </View>
    ) : null;

  const rel = card.relations;
  const relSort = ui.relSort;
  const expanded = new Set(ui.relExpanded);
  const flat = (items: readonly RelItem[]) => relFlat(b.index, items, relSort);

  const comments = card.comments ?? [];
  const canComment = card.mode === "bd" && card.commentsAvailable !== false;
  const sorted = comments
    .map((c, i) => ({ c, i }))
    .sort((x, y) => (String(x.c.created_at ?? "").localeCompare(String(y.c.created_at ?? "")) || x.i - y.i) * ui.commentSort)
    .map((x) => x.c);

  return (
    <View>
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
        <CopyKey id={card.id} />
        <Text testID="beads-card-title" style={{ flex: 1, color: pal.ink, fontSize: FONT.cardTitle, fontWeight: "600", lineHeight: 22 }}>
          {card.title}
        </Text>
      </View>
      {/* Above the properties: the status menu opens over them. */}
      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12, zIndex: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
          <TypeGlyph pal={pal} type={card.issue_type} />
          <Text style={{ fontSize: FONT.meta, color: pal.ink2 }}>{typeLabel(t, card.issue_type)}</Text>
        </View>
        {slots.statusControl ? (
          slots.statusControl(card)
        ) : (
          <View
            ref={titled(card.mode === "jsonl" ? t.editJsonl : null) as never}
            style={{ flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderColor: pal.border, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 }}
          >
            <StatusDot pal={pal} status={card.status} />
            <Text style={{ fontSize: FONT.meta, color: pal.ink2 }}>{statusLabel(t, card.status)}</Text>
          </View>
        )}
        {card.priority != null ? (
          <View ref={titled(priorityTitle(t, card.priority)) as never} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <PriIcon pal={pal} priority={card.priority} />
            <Text style={{ fontSize: FONT.meta, color: pal.ink2 }}>{`P${card.priority} ${priorityLabel(t, card.priority)}`}</Text>
          </View>
        ) : null}
        {card.ready ? (
          <Mark pal={pal} kind="ready" label={t.ready} title={t.readyTip} />
        ) : blockers && card.status !== "closed" ? (
          <Mark pal={pal} kind="blocked" label={t.blocked} title={t.blockedTip(blockers)} />
        ) : null}
      </View>

      {slots.notices?.(card)}

      {meta.length ? (
        <View style={{ gap: 5, marginBottom: 4 }}>
          {meta.map(([label, node]) => (
            <View key={label} style={{ flexDirection: "row", gap: 14, alignItems: "flex-start" }}>
              <Text style={{ width: labelW, color: pal.muted, fontSize: FONT.meta }}>{label}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>{node}</View>
            </View>
          ))}
        </View>
      ) : null}

      {textBlock(t.fDescription, card.description)}
      {textBlock(t.fDesign, card.design)}
      {textBlock(t.fCriteria, card.acceptance_criteria)}
      {textBlock(t.fNotes, card.notes)}

      <RelBlock issueId={card.id} section="parent" label={t.rParent} list={rel.parent ? flat([rel.parent]) : null} progress={false} />
      <RelBlock issueId={card.id} section="children" label={t.rChildren} list={rel.children.length ? relChildTree(b.index, card.id, rel.children, relSort, expanded) : null} />
      <RelBlock issueId={card.id} section="blockedBy" label={t.rBlockedBy} list={rel.blockedBy.length ? flat(rel.blockedBy) : null} />
      <RelBlock issueId={card.id} section="blocking" label={t.rBlocking} list={rel.blocking.length ? flat(rel.blocking) : null} />
      <RelBlock issueId={card.id} section="discoveredFrom" label={t.rDiscoveredFrom} list={rel.discoveredFrom.length ? flat(rel.discoveredFrom) : null} />
      <RelBlock issueId={card.id} section="discovered" label={t.rDiscovered} list={rel.discovered.length ? flat(rel.discovered) : null} />
      <RelBlock issueId={card.id} section="other" label={t.rOther} list={rel.other.length ? flat(rel.other) : null} />

      {card.comment_count || comments.length || canComment ? (
        <View style={{ marginTop: 18 }} testID="beads-comments">
          <SectionHead pal={pal}>
            <SecLabel pal={pal} text={t.fComments} />
            {comments.length ? <Text style={{ fontSize: FONT.secHead, color: pal.muted }}>{comments.length}</Text> : null}
            <View style={{ flex: 1 }} />
            {comments.length > 1 ? (
              <Btn
                pal={pal}
                small
                testID="beads-comment-sort"
                label={ui.commentSort === 1 ? "↑" : "↓"}
                title={`${t.cmSort}: ${ui.commentSort === 1 ? t.cmOldest : t.cmNewest}`}
                onPress={() => dispatch({ type: "commentSort", dir: ui.commentSort === 1 ? -1 : 1 })}
              />
            ) : null}
          </SectionHead>
          {comments.length ? (
            sorted.map((c, i) => (
              <View key={c.id ?? `c${i}`} style={{ borderTopWidth: i ? 1 : 0, borderTopColor: pal.grid, paddingTop: i ? 8 : 2, paddingBottom: 6, gap: 3 }}>
                <Text style={{ fontSize: FONT.status, color: pal.muted }}>
                  <Text style={{ color: pal.ink2, fontWeight: "600" }}>{c.author || "—"}</Text>
                  {c.created_at ? ` · ${fmtDate(c.created_at, t.locale)}` : ""}
                </Text>
                {md(c.text || "")}
              </View>
            ))
          ) : (
            <Text style={{ fontSize: FONT.md, color: pal.muted }}>
              {card.comment_count && !card.commentsAvailable ? t.fCommentsJsonl(card.comment_count) : t.noComments}
            </Text>
          )}
          {slots.commentBox?.(card)}
        </View>
      ) : null}
    </View>
  );
}

const REL_GAP = 6;
const REL_TWISTY = 18;

function relTrackWidth(cols: ColumnDef[]): number {
  let w = REL_TWISTY + REL_GAP + 6;
  for (const c of cols) w += (c.flex ? 120 : c.width ?? 0) + REL_GAP;
  return w;
}

/**
 * One block of linked issues: collapsible heading with a count, a status
 * bar over the set, a sortable header and the rows — children as a tree.
 */
function RelBlock({ issueId, section, label, list, progress = true }: { issueId: string; section: string; label: string; list: RelList | null; progress?: boolean }) {
  const { pal, t, openIssue } = useBeads();
  const { ui, dispatch } = useStore();
  const [width, setWidth] = useState(0);
  const [picker, setPicker] = useState(false);
  if (!list || !list.all.length) return null;
  const key = `${issueId}:${section}`;
  const collapsed = ui.collapsedSections.indexOf(key) >= 0;
  const cols = REL_COLUMNS.filter((c) => c.always || ui.relColumns.indexOf(c.key) >= 0);
  const minW = relTrackWidth(cols);
  const track = Math.max(width, minW);
  return (
    <View style={{ marginTop: 18, zIndex: picker ? 40 : 1 }} testID={`beads-rel-${section}`}>
      <View style={{ flexDirection: "row", alignItems: "center", zIndex: 2, marginBottom: 6, paddingBottom: 2, borderBottomWidth: 1, borderBottomColor: pal.grid, minHeight: 24 }}>
        <SectionHead pal={pal} flat testID={`beads-relhead-${section}`} expanded={!collapsed} onPress={() => dispatch({ type: "toggleSection", key })}>
          <Chevron pal={pal} open={!collapsed} />
          <SecLabel pal={pal} text={label} />
          <Text style={{ fontSize: FONT.secHead, color: pal.muted }}>{list.all.length}</Text>
        </SectionHead>
        {collapsed ? null : <RelColumnPicker section={section} open={picker} onOpen={setPicker} />}
      </View>
      {collapsed ? null : (
        <View onLayout={(e) => setWidth(Math.round(e.nativeEvent.layout.width))}>
          {progress && list.all.length > 1 ? <ProgressBar entries={list.all} subtree={list.all.length !== list.rows.length} /> : null}
          {width > 0 ? (
            <ScrollView horizontal contentContainerStyle={{ width: track }} showsHorizontalScrollIndicator={minW > width}>
              <View style={{ width: track }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: REL_GAP, paddingLeft: REL_TWISTY + REL_GAP, paddingRight: 6, paddingBottom: 4, borderBottomWidth: 1, borderBottomColor: pal.grid }}>
                  {cols.map((col) => {
                    const active = ui.relSort.key === col.key;
                    const name = columnLabel(t, col.key);
                    return (
                      <Pressable
                        key={col.key}
                        ref={titled(`${t.sortBy(name)} — ${active && ui.relSort.dir === 1 ? t.sortDesc : t.sortAsc}`) as never}
                        onPress={() => dispatch({ type: "relSort", sort: nextSort(ui.relSort, col.key, false)! })}
                        style={[{ flexDirection: "row", alignItems: "center", gap: 3 }, col.flex ? { flex: 1, minWidth: 90 } : { width: col.width }, col.num ? { justifyContent: "flex-end" } : null]}
                      >
                        <Text numberOfLines={1} style={{ fontSize: FONT.th - 0.5, color: active ? pal.link : pal.muted }}>
                          {col.short ? stringOf(t, col.short) : name}
                        </Text>
                        {active ? <Text style={{ fontSize: 8, color: pal.link }}>{ui.relSort.dir === 1 ? "▲" : "▼"}</Text> : null}
                      </Pressable>
                    );
                  })}
                </View>
                {list.rows.map((node) => (
                  <RelRow key={`${node.id}:${node.depth}`} node={node} cols={cols} onOpen={openIssue} onToggle={(id) => dispatch({ type: "toggleRelExpanded", id })} />
                ))}
              </View>
            </ScrollView>
          ) : null}
        </View>
      )}
    </View>
  );
}

/**
 * Which columns the linked-issue lists show (reference relColumnPicker): one
 * setting for every list, `title` always on; hiding the sort column falls
 * back to the id order (the store does that).
 */
function RelColumnPicker({ section, open, onOpen }: { section: string; open: boolean; onOpen: (open: boolean) => void }) {
  const { pal, t } = useBeads();
  const { ui, dispatch } = useStore();
  return (
    <View style={{ position: "relative", marginLeft: 6 }}>
      <Pressable
        testID={`beads-relcols-${section}`}
        ref={titled(t.relCols) as never}
        accessibilityRole="button"
        accessibilityLabel={t.relCols}
        accessibilityState={{ expanded: open }}
        onPress={() => onOpen(!open)}
        style={(st) => ({
          width: 24, height: 22, borderRadius: 6, alignItems: "center", justifyContent: "center", borderWidth: 1,
          borderColor: open ? mix(pal.link, 45, pal.border) : "transparent",
          backgroundColor: (st as { hovered?: boolean }).hovered || open ? pal.hover : "transparent",
        })}
      >
        <Icon name="SlidersHorizontal" size={13} color={open ? pal.link : pal.muted} />
      </Pressable>
      {open ? <Backdrop onClose={() => onOpen(false)} /> : null}
      {open ? (
        <View
          testID={`beads-relcols-panel-${section}`}
          style={{
            position: "absolute", top: 28, right: 0, zIndex: 50, width: 220, padding: 8, borderRadius: 10,
            borderWidth: 1, borderColor: pal.border, backgroundColor: pal.card, gap: 2,
            shadowColor: "#000", shadowOpacity: 0.22, shadowRadius: 15, shadowOffset: { width: 0, height: 10 }, elevation: 8,
          }}
        >
          <Text style={{ fontSize: FONT.th, color: pal.muted, textTransform: "uppercase", letterSpacing: 0.5, paddingHorizontal: 5, paddingBottom: 4 }}>{t.relColsHead}</Text>
          {REL_COLUMNS.map((col) => {
            const on = Boolean(col.always) || ui.relColumns.indexOf(col.key) >= 0;
            return (
              <Pressable
                key={col.key}
                testID={`beads-relcol-${col.key}`}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on, disabled: Boolean(col.always) }}
                disabled={col.always}
                onPress={() => dispatch({ type: "relColumns", columns: toggleValue(ui.relColumns, col.key) })}
                style={(st) => ({
                  flexDirection: "row", alignItems: "center", gap: 7, paddingVertical: 4, paddingHorizontal: 5, borderRadius: 6,
                  backgroundColor: on ? pal.sel : (st as { hovered?: boolean }).hovered ? pal.hover : "transparent",
                  opacity: col.always ? 0.6 : 1,
                })}
              >
                <Text style={{ color: on ? pal.link : pal.muted, fontSize: FONT.control }}>{on ? "☑" : "☐"}</Text>
                <Text style={{ color: on ? pal.ink : pal.ink2, fontSize: FONT.control }}>{columnLabel(t, col.key)}</Text>
              </Pressable>
            );
          })}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 6 }}>
            <Btn pal={pal} small testID={`beads-relcols-reset-${section}`} label={t.resetColumns} onPress={() => dispatch({ type: "relColumns", columns: REL_COLUMNS_DEFAULT.slice() })} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function RelRow({ node, cols, onOpen, onToggle }: { node: RelEntry; cols: ColumnDef[]; onOpen: (id: string) => void; onToggle: (id: string) => void }) {
  const { pal, t, index } = useBeads();
  const closed = node.status === "closed";
  const cell = (col: ColumnDef) => {
    const w = col.width;
    switch (col.key) {
      case "priority":
        return (
          <View key="p" style={{ width: w, alignItems: "center" }}>
            {node.priority != null ? <PriIcon pal={pal} priority={node.priority} /> : null}
          </View>
        );
      case "type":
        return (
          <View key="t" ref={titled(typeLabel(t, node.issue_type)) as never} style={{ width: w }}>
            <TypeGlyph pal={pal} type={node.issue_type} />
          </View>
        );
      case "id":
        return (
          <Text {...MONO_DOM} key="i" numberOfLines={1} style={{ width: w, fontFamily: MONO, fontSize: FONT.id, color: pal.muted, opacity: closed ? 0.55 : 1 }}>
            {node.id}
          </Text>
        );
      case "title":
        return (
          <Text key="ti" ref={titled(node.title) as never} numberOfLines={1} style={{ flex: 1, minWidth: 90, fontSize: FONT.rel, color: node.missing ? pal.muted : pal.ink2, opacity: closed ? 0.55 : 1 }}>
            {node.missing ? t.relMissing : node.title}
          </Text>
        );
      case "labels": {
        const first = node.labels[0];
        return (
          <View key="l" style={{ width: w, flexDirection: "row", overflow: "hidden" }}>
            {first ? <LabelChip pal={pal} slot={index?.labelSlots.get(first) ?? 0} text={node.labels.length > 1 ? `${first} +${node.labels.length - 1}` : first} title={node.labels.join(", ")} /> : null}
          </View>
        );
      }
      case "status":
        return (
          <View key="s" style={{ width: w, flexDirection: "row", alignItems: "center", gap: 5, overflow: "hidden" }}>
            {node.missing ? null : <StatusDot pal={pal} status={node.status} />}
            <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: FONT.status, color: pal.ink2 }}>
              {node.missing ? "" : statusLabel(t, node.status)}
            </Text>
          </View>
        );
      case "assignee":
        return (
          <Text key="a" numberOfLines={1} style={{ width: w, fontSize: FONT.status, color: pal.muted }}>
            {node.assignee ?? ""}
          </Text>
        );
      default:
        return (
          <Text key="u" ref={titled(fmtDate(node.updated_at, t.locale)) as never} numberOfLines={1} style={{ width: w, textAlign: "right", fontSize: FONT.status, color: pal.muted }}>
            {fmtDateShort(node.updated_at, t.locale)}
          </Text>
        );
    }
  };
  const other = node.linkType && ["blocks", "parent-child", "discovered-from"].indexOf(node.linkType) < 0 ? node.linkType : null;
  return (
    <Pressable
      testID={`beads-relrow-${node.id}`}
      disabled={node.missing}
      onPress={() => onOpen(node.id)}
      style={(st) => ({
        flexDirection: "row", alignItems: "center", gap: REL_GAP, paddingVertical: 3, paddingRight: 6,
        paddingLeft: node.depth * 14, borderRadius: 6,
        backgroundColor: (st as { hovered?: boolean }).hovered && !node.missing ? pal.hover : "transparent",
      })}
    >
      <Pressable
        disabled={!node.kids}
        onPress={() => onToggle(node.id)}
        hitSlop={4}
        style={{ width: REL_TWISTY, height: REL_TWISTY, alignItems: "center", justifyContent: "center", opacity: node.kids ? 1 : 0 }}
      >
        <Chevron pal={pal} open={node.open} />
      </Pressable>
      {cols.map(cell)}
      {other ? <Text style={{ fontSize: FONT.mark, color: pal.muted }}>{other}</Text> : null}
    </Pressable>
  );
}

/** Statuses of a block's issues as a bar, plus the numbers behind it. */
function ProgressBar({ entries, subtree }: { entries: RelEntry[]; subtree: boolean }) {
  const { pal, t } = useBeads();
  const parts = statusBreakdown(entries);
  const total = entries.length;
  const done = parts.find((p) => p.status === "closed")?.n ?? 0;
  const segColor = (s: string) =>
    s === "open" ? mix(pal.ink2, 70, pal.card) : s === "closed" ? mix(pal.muted, 55, pal.card) : pal.status(s);
  return (
    <View ref={titled(subtree ? t.relSubtree : null) as never} style={{ marginTop: 2, marginBottom: 8 }}>
      <View style={{ flexDirection: "row", height: 6, borderRadius: 999, overflow: "hidden", backgroundColor: mix(pal.ink, 8, pal.card) }}>
        {parts.map((p) => (
          <View key={p.status} style={{ width: `${(p.n / total) * 100}%`, backgroundColor: segColor(p.status) }} />
        ))}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 10, rowGap: 4, marginTop: 5 }}>
        <Text style={{ fontSize: FONT.status, color: pal.ink2, fontWeight: "600" }}>{t.relProgress(done, total)}</Text>
        {parts.map((p) => (
          <View key={p.status} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <StatusDot pal={pal} status={p.status} />
            <Text style={{ fontSize: FONT.status, color: pal.muted }}>
              <Text style={{ color: pal.ink2, fontWeight: "600" }}>{p.n}</Text> {statusLabel(t, p.status)}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}
