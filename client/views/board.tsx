/**
 * The board view (reference renderBoard / boardColumn / boardCard and the
 * drag code): the rows the tree would show, one lane per status, sorted by
 * the tree's comparator. Pressing a card selects it, and the panel opens the
 * card beside the board — or, in a narrow tab, in the board's place with a
 * way back to it (client/panel.tsx).
 *
 * Changing a status from here:
 * - web, bd mode: drag a card into another lane. Pointer events on the DOM
 *   node react-native-web renders; past DRAG_SLOP a ghost follows the
 *   pointer, the lane under it lights up, a drop writes the status through
 *   beads.edit (the shared changeStatus of client/writes.tsx), Escape cancels.
 * - native, bd mode: there is no pointer to drag with — a long press opens a
 *   "Move to" menu of the other lanes.
 * - jsonl mode: nothing to write to; the card's tooltip says so.
 */

import { Modal } from "@getpaseo/plugin/client/ui";
import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Platform, Pressable, ScrollView, Text, View } from "react-native";
import { BOARD_PAGE, CARD_TID, LANE_TID, buildLanes, dropTarget, fromTestId, lanePage, pastSlop, type Lane } from "../../shared/board.ts";
import { compareBy } from "../../shared/tree.ts";
import type { TreeRow } from "../../shared/types.ts";
import { useBeads } from "../beads.tsx";
import { FLASH_MS } from "../data.ts";
import { priorityTitle, statusLabel, typeLabel } from "../format.ts";
import type { Strings } from "../i18n/strings.ts";
import { useStore } from "../store.tsx";
import { FONT, MONO, MONO_DOM, mix, type Palette } from "../theme.ts";
import { Btn, LabelChip, Mark, PriIcon, StatusDot, TypeGlyph, titled } from "../ui.tsx";
import { useWrites } from "../writes.tsx";

/** Lane width: a phone fits one lane and a hint of the next (reference CSS). */
const LANE_W = 280;
const LANE_W_NARROW = 220;

// ── the status write ──────────────────────────────────────────────────

interface StatusWrite {
  /** The issue whose status is being written. */
  busy: string | null;
  /** The last refused write, shown on that issue's card. */
  error: { id: string; message: string } | null;
  change(id: string, status: string): void;
}

/**
 * The status write is the panel's one changeStatus (client/writes.tsx, the
 * reference's shared state.statusBusy / statusError): one write at a time,
 * and "changing…" or a refusal shows on the board card and on the open
 * issue card together.
 */
function useStatusWrite(): StatusWrite {
  const { quick, changeStatus } = useWrites();
  return { busy: quick.statusBusy, error: quick.statusError, change: changeStatus };
}

// ── a card ────────────────────────────────────────────────────────────

interface CardProps {
  row: TreeRow;
  kids: number;
  slot: number;
  pal: Palette;
  t: Strings;
  selected?: boolean;
  flash?: boolean;
  busy?: boolean;
  error?: string | null;
  /** The original of a card being dragged: faded in its lane. */
  dragging?: boolean;
  canWrite: boolean;
  onPress?: (id: string) => void;
  onLongPress?: (row: TreeRow) => void;
}

/** What a card draws; the ghost draws the same. */
function CardBody({ row, kids, slot, pal, t, busy, error }: CardProps) {
  const closed = row.status === "closed";
  const blockers = (row.blockers ?? []).length;
  const labels = row.labels ?? [];
  const first = labels[0];
  const hasFoot = Boolean(first || row.assignee || kids || row.comment_count);
  return (
    <>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, minWidth: 0 }}>
        {row.priority != null ? (
          <View ref={titled(priorityTitle(t, row.priority)) as never}>
            <PriIcon pal={pal} priority={row.priority} />
          </View>
        ) : null}
        <View ref={titled(typeLabel(t, row.issue_type)) as never}>
          <TypeGlyph pal={pal} type={row.issue_type} />
        </View>
        <Text {...MONO_DOM} numberOfLines={1} style={{ flex: 1, fontFamily: MONO, fontSize: FONT.id, color: pal.muted, opacity: closed ? 0.55 : 1 }}>
          {row.id}
        </Text>
        {row.ready ? (
          <Mark pal={pal} kind="ready" label={t.ready} title={t.readyTip} />
        ) : blockers && !closed ? (
          <Mark pal={pal} kind="blocked" label={t.blocked} title={t.blockedTip(blockers)} />
        ) : null}
      </View>
      <Text style={{ fontSize: FONT.rowTitle + 0.5, lineHeight: 18, color: pal.ink, opacity: closed ? 0.55 : 1 }}>{row.title}</Text>
      {hasFoot ? (
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 5, minWidth: 0 }}>
          {first ? <LabelChip pal={pal} slot={slot} text={labels.length > 1 ? `${first} +${labels.length - 1}` : first} title={labels.join(", ")} /> : null}
          {row.assignee ? (
            <Text ref={titled(row.assignee) as never} numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: FONT.status, color: pal.muted }}>
              {row.assignee}
            </Text>
          ) : null}
          {kids ? (
            <Text ref={titled(t.children(kids)) as never} style={{ fontSize: FONT.status - 0.5, color: pal.muted }}>
              {`▸${kids}`}
            </Text>
          ) : null}
          {row.comment_count ? (
            <Text ref={titled(t.comments(row.comment_count)) as never} style={{ fontSize: FONT.status, color: pal.muted }}>
              {`💬${row.comment_count}`}
            </Text>
          ) : null}
        </View>
      ) : null}
      {busy ? <Text style={{ fontSize: FONT.mark, color: pal.muted }}>{t.stChanging}</Text> : null}
      {error ? <Text style={{ fontSize: FONT.mark + 0.5, color: pal.critical }}>{error}</Text> : null}
    </>
  );
}

const cardBox = (pal: Palette) => ({
  flexDirection: "column" as const,
  gap: 5,
  paddingVertical: 8,
  paddingHorizontal: 9,
  borderRadius: 8,
  borderWidth: 1,
  backgroundColor: pal.card,
  borderColor: pal.border,
});

/**
 * Whether the last input was a key: the focus ring is for keyboard focus only
 * (the reference's :focus-visible) — a pressed or grabbed card is not ringed.
 */
const focus = { keyboard: false };

const BoardCard = memo(function BoardCard(props: CardProps) {
  const { row, pal, t, selected, flash, busy, dragging, canWrite, onPress, onLongPress } = props;
  const web = Platform.OS === "web";
  return (
    <Pressable
      ref={titled(canWrite ? t.boardDrag : t.boardDragJsonl) as never}
      testID={CARD_TID + row.id}
      accessibilityRole="button"
      accessibilityLabel={t.boardCard(row.id, row.title)}
      accessibilityHint={!web && canWrite ? t.boardMoveHint : undefined}
      accessibilityState={{ selected: Boolean(selected), busy: Boolean(busy) }}
      onPress={() => onPress?.(row.id)}
      onLongPress={!web && canWrite && onLongPress ? () => onLongPress(row) : undefined}
      style={(st) => {
        const s = st as { hovered?: boolean; focused?: boolean };
        return [
          cardBox(pal),
          { userSelect: "none", cursor: busy ? "progress" : "pointer" } as object,
          selected
            ? { backgroundColor: pal.sel, borderColor: mix(pal.link, 45, pal.border) }
            : flash
              ? { backgroundColor: pal.flash }
              : s.hovered
                ? { borderColor: mix(pal.ink, 22, pal.border) }
                : null,
          // Our own ring, keyboard only; the browser's would also ring a grabbed card.
          (s.focused && focus.keyboard
            ? { outlineStyle: "solid", outlineWidth: 2, outlineColor: pal.link, outlineOffset: -1 }
            : { outlineStyle: "none" }) as object,
          dragging ? { opacity: 0.4 } : busy ? { opacity: 0.6 } : null,
        ];
      }}
    >
      <CardBody {...props} />
    </Pressable>
  );
});

// ── a lane ────────────────────────────────────────────────────────────

interface LaneProps {
  lane: Lane;
  page: number;
  width: number;
  height: number;
  over: boolean;
  pal: Palette;
  t: Strings;
  card: (row: TreeRow) => ReactElement;
  onMore: (status: string, page: number) => void;
}

function LaneView({ lane, page, width, height, over, pal, t, card, onMore }: LaneProps) {
  const n = lane.rows.length;
  const name = statusLabel(t, lane.status);
  return (
    <View
      testID={LANE_TID + lane.status}
      accessibilityLabel={t.boardColumn(name, n)}
      style={{
        width, height, flexDirection: "column", borderRadius: 10, borderWidth: 1,
        backgroundColor: over ? pal.sel : pal.raised,
        borderColor: over ? pal.link : pal.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: pal.border }}>
        <StatusDot pal={pal} status={lane.status} />
        <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: FONT.control, color: pal.ink2 }}>
          {name}
        </Text>
        <View style={{ marginLeft: "auto", borderWidth: 1, borderColor: pal.border, backgroundColor: pal.card, borderRadius: 999, paddingHorizontal: 6 }}>
          <Text testID={`beads-lanecount-${lane.status}`} style={{ fontSize: FONT.mark, color: pal.muted, fontVariant: ["tabular-nums"] }}>
            {String(n)}
          </Text>
        </View>
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 8, gap: 8 }}>
        {n ? lane.rows.slice(0, page).map(card) : (
          <Text style={{ color: pal.muted, fontSize: FONT.control, textAlign: "center", paddingVertical: 10 }}>{t.boardEmptyCol}</Text>
        )}
      </ScrollView>
      {n > page ? (
        // A footer under the scrolling cards, set off by a rule so the last card is not read as cut by the button.
        <View style={{ padding: 8, borderTopWidth: 1, borderTopColor: pal.border }}>
          <Btn pal={pal} label={t.boardMore(n - page)} testID={`beads-lanemore-${lane.status}`} onPress={() => onMore(lane.status, page + BOARD_PAGE)} />
        </View>
      ) : null}
    </View>
  );
}

// ── the drag (web) ────────────────────────────────────────────────────

/** What this file uses of the DOM (no DOM lib in this project). */
interface DomRect {
  left: number;
  top: number;
  width: number;
}
interface DomEl {
  closest?(sel: string): DomEl | null;
  getAttribute?(name: string): string | null;
  getBoundingClientRect?(): DomRect;
  addEventListener(type: string, fn: (e: any) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (e: any) => void, capture?: boolean): void;
}
interface DomPointer {
  button: number;
  pointerId: number;
  clientX: number;
  clientY: number;
  target: DomEl | null;
  preventDefault(): void;
}
interface DomGlobals {
  window: DomEl;
  document: { elementFromPoint(x: number, y: number): DomEl | null };
}
const dom = () => globalThis as unknown as DomGlobals;

interface Drag {
  id: string;
  from: string;
  /** Where inside the card it was grabbed, so the ghost does not jump. */
  offX: number;
  offY: number;
  width: number;
}

/** The copy of the card that follows the pointer; it moves without re-rendering the board. */
function Ghost({ drag, row, kids, slot, pal, t, mover }: { drag: Drag; row: TreeRow; kids: number; slot: number; pal: Palette; t: Strings; mover: { current: ((x: number, y: number) => void) | null } }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    mover.current = (x, y) => setPos({ x, y });
    return () => {
      mover.current = null;
    };
  }, [mover]);
  if (!pos) return null;
  return (
    <View
      testID="beads-board-ghost"
      pointerEvents="none"
      style={[
        cardBox(pal),
        {
          position: "absolute", left: pos.x - drag.offX, top: pos.y - drag.offY, width: drag.width, zIndex: 200, opacity: 0.95,
          transform: [{ rotate: "1.5deg" }], boxShadow: "0 12px 28px rgba(0,0,0,0.28)",
        } as object,
      ]}
    >
      <CardBody row={row} kids={kids} slot={slot} pal={pal} t={t} canWrite />
    </View>
  );
}

// ── the board ─────────────────────────────────────────────────────────

export function BoardView({ passes, compact }: { passes: (row: TreeRow) => boolean; compact: boolean }) {
  const { pal, t, data, index, select } = useBeads();
  const { ui } = useStore();
  const write = useStatusWrite();
  const canWrite = data.state.tree?.mode === "bd";
  const web = Platform.OS === "web";

  const lanes = useMemo(() => {
    if (!index) return [];
    const kidsOf = (id: string) => (index.kids.get(id) ?? []).length;
    const cmp = compareBy(ui.sort, kidsOf);
    return buildLanes(index.rows, passes, ui.showClosed, cmp);
  }, [index, passes, ui.showClosed, ui.sort]);

  /** "N more" is a per-visit decision: a fresh board starts at one page again. */
  const [pages, setPages] = useState<Record<string, number>>({});
  const onMore = useCallback((status: string, page: number) => setPages((p) => ({ ...p, [status]: page })), []);

  const [height, setHeight] = useState(0);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<TreeRow | null>(null);
  const mover = useRef<((x: number, y: number) => void) | null>(null);
  /** True from the moment a drag passes the slop until the next press: the click after a drop opens nothing. */
  const dragMoved = useRef(false);

  // Rows a poll changed glow for FLASH_MS; one timer re-renders when the next one expires.
  const flashed = data.state.flashed;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const at = Date.now();
    let next = Infinity;
    for (const id of Object.keys(flashed)) {
      const end = flashed[id]! + FLASH_MS;
      if (end > at && end < next) next = end;
    }
    if (next === Infinity) return;
    const timer = setTimeout(() => setNow(Date.now()), next - at + 20);
    return () => clearTimeout(timer);
  }, [flashed, now]);

  const onPress = useCallback(
    (id: string) => {
      if (dragMoved.current) return;
      select(id);
    },
    [select],
  );
  const onLongPress = useCallback((row: TreeRow) => setMenu(row), []);

  // The drag reads the latest of these without re-binding its listeners.
  const live = useRef({ index, canWrite, busy: write.busy, change: write.change });
  live.current = { index, canWrite, busy: write.busy, change: write.change };
  const root = useRef<unknown>(null);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = root.current as DomEl | null;
    if (!node || typeof node.addEventListener !== "function") return;
    const win = dom().window;
    let cur: { id: string; from: string; pointerId: number; startX: number; startY: number; offX: number; offY: number; width: number; started: boolean; over: string | null } | null = null;
    let rootBox: DomRect = { left: 0, top: 0, width: 0 };

    const laneAt = (x: number, y: number): string | null => {
      const el = dom().document.elementFromPoint(x, y);
      const lane = el?.closest?.(`[data-testid^="${LANE_TID}"]`);
      return fromTestId(LANE_TID, lane?.getAttribute?.("data-testid"));
    };
    const stop = () => {
      win.removeEventListener("pointermove", move);
      win.removeEventListener("pointerup", up);
      win.removeEventListener("pointercancel", cancel);
      win.removeEventListener("keydown", key, true);
      const had = cur?.started;
      cur = null;
      if (had) {
        setDrag(null);
        setOver(null);
      }
    };
    const cancel = () => stop();
    const move = (e: DomPointer) => {
      if (!cur || e.pointerId !== cur.pointerId) return;
      if (!cur.started) {
        if (!pastSlop(e.clientX - cur.startX, e.clientY - cur.startY)) return;
        cur.started = true;
        dragMoved.current = true;
        rootBox = node.getBoundingClientRect?.() ?? rootBox;
        setDrag({ id: cur.id, from: cur.from, offX: cur.offX, offY: cur.offY, width: cur.width });
      }
      e.preventDefault();
      mover.current?.(e.clientX - rootBox.left, e.clientY - rootBox.top);
      const lane = laneAt(e.clientX, e.clientY);
      if (lane !== cur.over) {
        cur.over = lane;
        setOver(lane);
      }
    };
    const up = (e: DomPointer) => {
      if (!cur || e.pointerId !== cur.pointerId) return;
      const { id, from, over: to, started } = cur;
      stop();
      // Dropped where it already was, or outside the board: nothing happened.
      const target = started ? dropTarget(from, to) : null;
      if (target) live.current.change(id, target);
    };
    const key = (e: { key: string; preventDefault(): void; stopPropagation(): void }) => {
      if (e.key !== "Escape" || !cur) return;
      e.preventDefault();
      e.stopPropagation();
      stop();
    };
    const down = (e: DomPointer) => {
      dragMoved.current = false;
      focus.keyboard = false;
      if (e.button !== 0) return;
      const card = e.target?.closest?.(`[data-testid^="${CARD_TID}"]`);
      const id = fromTestId(CARD_TID, card?.getAttribute?.("data-testid"));
      if (!card || !id) return;
      // One write at a time, and only where a write is possible at all; the tooltip says why.
      const l = live.current;
      if (!l.canWrite || l.busy) return;
      const row = l.index?.byId.get(id);
      if (!row) return;
      stop();
      const box = card.getBoundingClientRect?.() ?? { left: e.clientX, top: e.clientY, width: LANE_W - 18 };
      cur = {
        id, from: row.status, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY,
        offX: e.clientX - box.left, offY: e.clientY - box.top, width: box.width, started: false, over: null,
      };
      win.addEventListener("pointermove", move);
      win.addEventListener("pointerup", up);
      win.addEventListener("pointercancel", cancel);
      win.addEventListener("keydown", key, true);
    };
    const anyKey = (e: { key: string }) => {
      if (e.key === "Tab" || e.key.indexOf("Arrow") === 0) focus.keyboard = true;
    };
    node.addEventListener("pointerdown", down);
    win.addEventListener("keydown", anyKey, true);
    return () => {
      node.removeEventListener("pointerdown", down);
      win.removeEventListener("keydown", anyKey, true);
      stop();
    };
  }, []);

  const slotOf = (label: string | undefined) => (label ? index?.labelSlots.get(label) ?? 0 : 0);
  const kidsOf = (id: string) => (index?.kids.get(id) ?? []).length;
  const card = (row: TreeRow) => (
    <BoardCard
      key={row.id}
      row={row}
      kids={kidsOf(row.id)}
      slot={slotOf((row.labels ?? [])[0])}
      pal={pal}
      t={t}
      selected={ui.selectedId === row.id}
      flash={flashed[row.id] != null && now - flashed[row.id]! < FLASH_MS}
      busy={write.busy === row.id}
      error={write.error && write.error.id === row.id ? write.error.message : null}
      dragging={drag?.id === row.id}
      canWrite={canWrite}
      onPress={onPress}
      onLongPress={onLongPress}
    />
  );

  const laneW = compact ? LANE_W_NARROW : LANE_W;
  const pad = compact ? { paddingTop: 6, paddingHorizontal: 8, paddingBottom: 8 } : { paddingTop: 8, paddingHorizontal: 10, paddingBottom: 10 };
  const laneH = Math.max(0, height - pad.paddingTop - pad.paddingBottom);
  const dragRow = drag ? index?.byId.get(drag.id) : null;

  return (
    <View
      ref={root as never}
      testID="beads-board"
      style={{ flex: 1, minWidth: 0, position: "relative" }}
      onLayout={(e) => {
        // A hidden board (its tab in the background, or a card in its place in a
        // narrow tab — display: none) lays out at 0: keep the last height, or the
        // lanes unmount and come back scrolled to the start.
        const h = Math.round(e.nativeEvent.layout.height);
        if (h > 0) setHeight(h);
      }}
    >
      {height > 0 ? (
        <ScrollView horizontal style={{ flex: 1 }} contentContainerStyle={{ gap: compact ? 8 : 10, ...pad }}>
          {lanes.map((lane) => (
            <LaneView
              key={lane.status}
              lane={lane}
              page={lanePage(pages, lane.status)}
              width={laneW}
              height={laneH}
              over={over === lane.status}
              pal={pal}
              t={t}
              card={card}
              onMore={onMore}
            />
          ))}
        </ScrollView>
      ) : null}
      {web && drag && dragRow ? (
        <Ghost drag={drag} row={dragRow} kids={kidsOf(dragRow.id)} slot={slotOf((dragRow.labels ?? [])[0])} pal={pal} t={t} mover={mover} />
      ) : null}
      {menu ? (
        <Modal title={t.boardMoveTo(menu.id)} open onOpenChange={(open) => !open && setMenu(null)}>
          <View style={{ paddingVertical: 4 }}>
            {lanes
              .filter((l) => l.status !== menu.status)
              .map((l) => (
                <Pressable
                  key={l.status}
                  testID={`beads-move-${l.status}`}
                  accessibilityRole="menuitem"
                  onPress={() => {
                    setMenu(null);
                    write.change(menu.id, l.status);
                  }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 10, paddingHorizontal: 12 }}
                >
                  <StatusDot pal={pal} status={l.status} />
                  <Text style={{ color: pal.ink, fontSize: FONT.meta }}>{statusLabel(t, l.status)}</Text>
                </Pressable>
              ))}
          </View>
        </Modal>
      ) : null}
    </View>
  );
}
