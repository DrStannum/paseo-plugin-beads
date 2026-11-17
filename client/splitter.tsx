/**
 * The grab handle between the tree and the card (reference .cbd-resizer):
 * drag to resize the card pane, double-click to go back to the default
 * split. Web only — pointer events on the DOM node react-native-web renders;
 * on native the panes keep a fixed share and this renders nothing.
 */

import { useEffect, useRef, useState } from "react";
import { Platform, View } from "react-native";
import type { Palette } from "./theme.ts";
import { titled } from "./ui.tsx";

/** What this file uses of a DOM element / pointer event (no DOM lib in this project). */
interface DomPointerEvent {
  clientX: number;
  pointerId: number;
  preventDefault(): void;
}
interface DomNode {
  addEventListener(type: string, fn: (e: DomPointerEvent) => void): void;
  removeEventListener(type: string, fn: (e: DomPointerEvent) => void): void;
  setPointerCapture?(id: number): void;
  releasePointerCapture?(id: number): void;
}

/** The handle's own width; the hairline sits in its middle. */
export const SPLITTER_W = 22;

export function Splitter({ pal, width, onDrag, onDone, onReset, title }: {
  pal: Palette;
  /** The card pane's width when the drag starts. */
  width: number;
  /** Live width while dragging (not yet clamped). */
  onDrag: (width: number) => void;
  onDone: () => void;
  onReset: () => void;
  title: string;
}) {
  const ref = useRef<unknown>(null);
  const [hot, setHot] = useState(false);
  const [dragging, setDragging] = useState(false);
  const live = useRef({ width, onDrag, onDone, onReset });
  live.current = { width, onDrag, onDone, onReset };

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const node = ref.current as DomNode | null;
    if (!node || typeof node.addEventListener !== "function") return;
    let startX = 0;
    let startW = 0;
    let active: number | null = null;
    const move = (e: DomPointerEvent) => {
      if (active === null) return;
      live.current.onDrag(startW - (e.clientX - startX));
    };
    const up = (e: DomPointerEvent) => {
      if (active === null) return;
      node.releasePointerCapture?.(e.pointerId);
      active = null;
      setDragging(false);
      live.current.onDone();
    };
    const down = (e: DomPointerEvent) => {
      e.preventDefault();
      node.setPointerCapture?.(e.pointerId);
      active = e.pointerId;
      startX = e.clientX;
      startW = live.current.width;
      setDragging(true);
    };
    const dbl = () => live.current.onReset();
    const enter = () => setHot(true);
    const leave = () => setHot(false);
    node.addEventListener("pointerdown", down);
    node.addEventListener("pointermove", move);
    node.addEventListener("pointerup", up);
    node.addEventListener("pointercancel", up);
    node.addEventListener("dblclick", dbl);
    node.addEventListener("pointerenter", enter);
    node.addEventListener("pointerleave", leave);
    return () => {
      node.removeEventListener("pointerdown", down);
      node.removeEventListener("pointermove", move);
      node.removeEventListener("pointerup", up);
      node.removeEventListener("pointercancel", up);
      node.removeEventListener("dblclick", dbl);
      node.removeEventListener("pointerenter", enter);
      node.removeEventListener("pointerleave", leave);
    };
  }, []);

  if (Platform.OS !== "web") return <View style={{ width: SPLITTER_W }} />;
  const on = hot || dragging;
  const setRef = (node: unknown) => {
    ref.current = node;
    titled(title)?.(node);
  };
  return (
    <View
      ref={setRef as never}
      testID="beads-splitter"
      accessibilityRole={"separator" as never}
      style={{ width: SPLITTER_W, alignItems: "center", justifyContent: "center", cursor: "col-resize", userSelect: "none", touchAction: "none" } as object}
    >
      <View style={{ width: 2, height: on ? 88 : 44, borderRadius: 2, backgroundColor: on ? pal.link : pal.border }} />
    </View>
  );
}
