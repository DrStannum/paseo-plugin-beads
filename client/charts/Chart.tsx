/**
 * Draws a Scene (shared/charts/scene.ts).
 *
 * - **web**: a live DOM <svg> through JSX intrinsics (react-dom renders them;
 *   verified in Paseo web 0.15.4), with the reference tab's wrapPlot readout:
 *   hovering a mark that carries a tip shows it in a tooltip over the plot,
 *   the other `dim` marks step back to 45 %, a `hit` strip washes faintly.
 *   Marks with an `id` are buttons: focusable, Enter/Space or a click calls
 *   onPressMark.
 * - **native** (iOS/Android): there is no react-native-svg in the host, so
 *   the same scene goes out as static markup (sceneToSvgMarkup) through the
 *   host's <Icon icon={{svg}}/>. That box is square: the markup pads its
 *   viewBox to a square around the scene and the square is cropped back to
 *   the scene's height by a clipping View. No hover, no press — the numbers
 *   are on the legend, tiles and tables around the chart.
 *
 * The scene is built at the width the chart actually got (pass a function of
 * the width), so one unit is one pixel and the text is never stretched; below
 * MIN_PLOT_W it is built at that floor and scaled down.
 */

import { Icon } from "@getpaseo/plugin/client/ui";
import { useMemo, useState, type ReactElement } from "react";
import { Platform, Text, View, type LayoutChangeEvent } from "react-native";
import { MIN_PLOT_W, sceneToSvgMarkup, type Mark, type Scene } from "../../shared/charts/scene.ts";
import { colorResolver, type ChartColors } from "./palette.ts";

export interface ChartProps {
  /** The scene, or how to build it for a width in pixels (measured). */
  scene: Scene | ((width: number) => Scene);
  colors: ChartColors;
  /** A fixed width; otherwise the chart fills its parent and measures it. */
  width?: number;
  /** The narrowest the scene is built at before it is scaled down. Default MIN_PLOT_W; 0 for sparklines. */
  minWidth?: number;
  /** A mark with an `id` was pressed (web: click, Enter, Space). */
  onPressMark?: (id: string, mark: Mark) => void;
}

/** The scene for a width, with the width it was built at. */
function useScene(scene: ChartProps["scene"], width: number, minWidth: number): Scene | null {
  return useMemo(() => {
    if (typeof scene !== "function") return scene;
    if (width <= 0) return null;
    return scene(Math.max(minWidth, Math.round(width)));
  }, [scene, width, minWidth]);
}

export function Chart(props: ChartProps): ReactElement {
  const { colors } = props;
  const fixed = props.width ?? (typeof props.scene === "function" ? 0 : props.scene.width);
  const measure = typeof props.scene === "function" && props.width == null;
  const [measured, setMeasured] = useState(0);
  const boxW = measure ? measured : fixed;
  const scene = useScene(props.scene, boxW, props.minWidth ?? MIN_PLOT_W);
  const onLayout = measure
    ? (e: LayoutChangeEvent) => {
      const w = Math.round(e.nativeEvent.layout.width);
      if (w && w !== measured) setMeasured(w);
    }
    : undefined;
  const k = scene && boxW ? boxW / scene.width : 1;
  const h = scene ? scene.height * k : 0;
  return (
    <View
      onLayout={onLayout}
      style={{ width: measure ? "100%" : boxW, height: h || undefined, minHeight: h ? undefined : 1 }}
      accessibilityRole="image"
      accessibilityLabel={scene?.aria}
    >
      {scene && boxW ? (
        Platform.OS === "web"
          ? <WebPlot scene={scene} colors={colors} width={boxW} height={h} onPressMark={props.onPressMark} />
          : <NativePlot scene={scene} colors={colors} width={boxW} height={h} />
      ) : null}
    </View>
  );
}

// ── native: static markup through the host's Icon ────────────────────

function NativePlot({ scene, colors, width, height }: { scene: Scene; colors: ChartColors; width: number; height: number }) {
  const markup = useMemo(() => sceneToSvgMarkup(scene, colorResolver(colors), { square: true }), [scene, colors]);
  if (!markup.fits) {
    return <Text style={{ color: colors.muted, fontSize: 11 }}>{scene.aria}</Text>;
  }
  const k = width / scene.width;
  return (
    <View style={{ width, height, overflow: "hidden" }}>
      <View style={{ position: "absolute", left: -markup.offsetX * k, top: -markup.offsetY * k }}>
        <Icon icon={{ svg: markup.svg }} size={markup.width * k} color={colors.ink} />
      </View>
    </View>
  );
}

// ── web: DOM svg with the readout ────────────────────────────────────

interface Box { cx: number; top: number }

/** Where a mark's readout points: its horizontal middle and its top, in scene units. */
function anchorOf(m: Mark): Box {
  switch (m.kind) {
    case "rect": return { cx: m.x + m.w / 2, top: m.y };
    case "circle": return { cx: m.cx, top: m.cy - m.r };
    case "line": return { cx: (m.x1 + m.x2) / 2, top: Math.min(m.y1, m.y2) };
    case "text": return { cx: m.x, top: m.y - (m.size ?? 10) };
    case "path": return { cx: 0, top: 0 };
  }
}

const groupOf = (m: Mark, i: number) => m.group ?? `#${i}`;

function WebPlot({ scene, colors, width, height, onPressMark }: {
  scene: Scene; colors: ChartColors; width: number; height: number; onPressMark?: ChartProps["onPressMark"];
}) {
  const color = useMemo(() => colorResolver(colors), [colors]);
  const [hot, setHot] = useState<number | null>(null);
  const [tipSize, setTipSize] = useState({ w: 0, h: 0 });
  const k = width / scene.width;
  const hotMark = hot != null ? scene.marks[hot] : undefined;
  const hotGroup = hotMark && hot != null ? groupOf(hotMark, hot) : null;

  const els = scene.marks.map((m, i) => {
    const interactive = Boolean(m.tip) || Boolean(m.id);
    let opacity = m.opacity ?? 1;
    if (hotGroup != null && m.dim && groupOf(m, i) !== hotGroup) opacity *= 0.45;
    const handlers = interactive
      ? {
        onMouseEnter: () => setHot(i),
        onMouseLeave: () => setHot((h) => (h === i ? null : h)),
      }
      : {};
    const press = m.id && onPressMark
      ? {
        tabIndex: 0,
        role: "button",
        "aria-label": m.label ?? m.tip ?? m.id,
        onClick: () => onPressMark(m.id!, m),
        onKeyDown: (e: { key: string; preventDefault: () => void }) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onPressMark(m.id!, m);
          }
        },
        onFocus: () => setHot(i),
        onBlur: () => setHot((h) => (h === i ? null : h)),
        style: { cursor: "pointer", transition: "opacity 90ms linear", outline: "none" },
      }
      : m.dim ? { style: { transition: "opacity 90ms linear" } } : {};
    switch (m.kind) {
      case "rect":
        if (m.hit) {
          return (
            <rect key={i} x={m.x} y={m.y} width={Math.max(0, m.w)} height={Math.max(0, m.h)}
              fill={colors.ink} fillOpacity={hot === i ? 0.07 : 0} {...handlers} {...press} />
          );
        }
        return (
          <rect key={i} x={m.x} y={m.y} width={Math.max(0, m.w)} height={Math.max(0, m.h)} rx={m.rx}
            fill={color(m.fill)} opacity={opacity} {...handlers} {...press} />
        );
      case "path":
        return (
          <path key={i} d={m.d} fill={m.fill ? color(m.fill) : "none"} stroke={m.stroke ? color(m.stroke) : undefined}
            strokeWidth={m.stroke ? m.strokeWidth ?? 1 : undefined} strokeDasharray={m.dash}
            strokeLinejoin="round" strokeLinecap="round" opacity={opacity} pointerEvents={interactive ? undefined : "none"}
            {...handlers} {...press} />
        );
      case "line":
        return (
          <line key={i} x1={m.x1} y1={m.y1} x2={m.x2} y2={m.y2} stroke={color(m.stroke)} strokeWidth={m.strokeWidth ?? 1}
            strokeDasharray={m.dash} opacity={opacity} pointerEvents="none" />
        );
      case "circle":
        return <circle key={i} cx={m.cx} cy={m.cy} r={m.r} fill={color(m.fill)} opacity={opacity} pointerEvents={interactive ? undefined : "none"} {...handlers} {...press} />;
      case "text":
        return (
          <text key={i} x={m.x} y={m.y} fontSize={m.size ?? 10} fontWeight={m.weight} textAnchor={m.anchor ?? "start"}
            fill={color(m.fill ?? "muted")} opacity={opacity} pointerEvents="none" style={{ userSelect: "none" }}>
            {m.text}
          </text>
        );
    }
  });

  // The readout: over the hot mark, kept inside the plot.
  let tip: ReactElement | null = null;
  if (hotMark && hotMark.tip) {
    const a = anchorOf(hotMark);
    const half = tipSize.w / 2;
    const left = Math.max(2, Math.min(width - tipSize.w - 2, a.cx * k - half));
    const top = Math.max(0, a.top * k - tipSize.h - 8);
    tip = (
      <View
        pointerEvents="none"
        onLayout={(e) => {
          const { width: w, height: h } = e.nativeEvent.layout;
          if (Math.abs(w - tipSize.w) > 0.5 || Math.abs(h - tipSize.h) > 0.5) setTipSize({ w, h });
        }}
        style={{
          position: "absolute", left, top, zIndex: 5, maxWidth: Math.max(160, width * 0.6),
          backgroundColor: colors.tipBg, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
          opacity: tipSize.w ? 1 : 0,
          shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
        }}
      >
        <Text style={{ color: colors.tipFg, fontSize: 11, lineHeight: 15, textAlign: "center" }}>{hotMark.tip}</Text>
      </View>
    );
  }

  return (
    <View style={{ width, height, position: "relative" }}>
      <svg
        viewBox={`0 0 ${scene.width} ${scene.height}`}
        width={width}
        height={height}
        role="img"
        aria-label={scene.aria}
        style={{ display: "block", overflow: "visible" }}
        onMouseLeave={() => setHot(null)}
      >
        {els}
      </svg>
      {tip}
    </View>
  );
}
