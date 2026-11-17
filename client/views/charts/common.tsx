/**
 * Pieces every charts reading shares: the colors for the host theme, the
 * "closed are hidden" strip with its switch (reference appendClosedWarning),
 * a plain warning strip, the empty line, the footnotes under a reading, the
 * pace card (reference paceCard / drawPace) and the drill-down heading.
 */

import { Children, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Text, View } from "react-native";
import {
  lastStepIsRunning, lineScene, rollingMean, smoothingWindow, tipWhen, type Frame, type Step,
} from "../../../shared/charts/index.ts";
import { useBeads } from "../../beads.tsx";
import { Chart, ChartCard, chartColors, type ChartColors } from "../../charts/index.ts";
import { useStore } from "../../store.tsx";
import { FONT, mix } from "../../theme.ts";
import { Btn } from "../../ui.tsx";

/** The chart palette for the host theme, memoised. */
export function useChartColors(): ChartColors {
  const { theme } = useBeads();
  return useMemo(() => chartColors(theme.colors), [theme.colors]);
}

/** A warning strip: text, and optionally an action on its right. */
export function WarnStrip({ text, action, testID }: { text: string; action?: ReactNode; testID?: string }): ReactElement {
  const { pal } = useBeads();
  return (
    <View
      testID={testID}
      style={{
        flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 6, paddingLeft: 12, paddingRight: 6,
        borderRadius: 8, borderWidth: 1, borderColor: mix(pal.warning, 40, pal.border), backgroundColor: mix(pal.warning, 10, pal.card),
      }}
    >
      <Text style={{ flex: 1, minWidth: 0, color: pal.ink2, fontSize: FONT.stat, lineHeight: 17 }}>{text}</Text>
      {action}
    </View>
  );
}

/**
 * With "show closed" off nothing can count as done — said outright, with the
 * switch to hand, because a chart of nothing but waiting reads as broken.
 */
export function ClosedWarning(): ReactElement | null {
  const { pal, t } = useBeads();
  const { ui, dispatch } = useStore();
  if (ui.showClosed) return null;
  return (
    <WarnStrip
      testID="beads-charts-closed-warning"
      text={t.flowClosedHidden}
      action={<Btn pal={pal} small label={t.showClosed} testID="beads-charts-show-closed" onPress={() => dispatch({ type: "showClosed", on: true })} />}
    />
  );
}

/** A reading with nothing to draw says why, in one line. */
export function ChartsEmpty({ text, testID }: { text: string; testID?: string }): ReactElement {
  const { pal } = useBeads();
  return (
    <Text testID={testID ?? "beads-charts-empty"} style={{ color: pal.muted, fontSize: FONT.md, paddingVertical: 18, textAlign: "center" }}>
      {text}
    </Text>
  );
}

/** A footnote under a reading (dropped steps, undated issues, the authors' note). */
export function Foot({ children }: { children: string }): ReactElement {
  const { pal } = useBeads();
  return <Text style={{ color: pal.muted, fontSize: FONT.stat, lineHeight: 17 }}>{children}</Text>;
}

export interface PaceLine {
  name: string;
  /** Raw counts per step; the line draws their rolling mean, the readout the counts. */
  values: readonly number[];
  color: string;
}

/**
 * The pace: work per step, smoothed into a trend. No figures in the key —
 * the axis is an average per step, the period's totals are whole counts, and
 * the two side by side invite a wrong reading.
 */
export function PaceCard({ frames, step, lines, title, colors }: {
  frames: readonly Frame[]; step: Step; lines: readonly PaceLine[]; title?: string; colors: ChartColors;
}): ReactElement {
  const { t } = useBeads();
  const win = smoothingWindow(step);
  const starts = frames.map((f) => f.start);
  const running = lastStepIsRunning(frames, step);
  return (
    <ChartCard
      title={title ?? t.tempoTitle}
      aside={t.tempoSmoothed(win, step)}
      colors={colors}
      legend={lines.map((l) => ({ label: l.name, color: l.color }))}
    >
      <Chart
        colors={colors}
        scene={(width) => lineScene({
          starts, step, width, locale: t.locale, aria: t.tempoAria(starts.length), height: 180,
          running, runningLabel: t.tempoRunning,
          series: lines.map((l) => ({ values: rollingMean(l.values, win), color: l.color })),
          tip: (i) => t.tempoTip(
            tipWhen(starts[i]!, step, t.locale),
            lines.map((l) => t.tempoTipPart(l.name, l.values[i] ?? 0)).join(" · "),
          ),
        })}
      />
    </ChartCard>
  );
}

/** The drill-down's heading: the way back, and whose page this is. */
export function DrillHead({ back, name, muted, onBack, testID }: { back: string; name: string; muted?: boolean; onBack: () => void; testID?: string }): ReactElement {
  const { pal } = useBeads();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <Btn pal={pal} label={back} testID={testID} onPress={onBack} />
      <Text
        numberOfLines={1}
        style={{ color: muted ? pal.muted : pal.ink, fontStyle: muted ? "italic" : "normal", fontSize: 16, fontWeight: "600", flexShrink: 1 }}
      >
        {name}
      </Text>
    </View>
  );
}

/**
 * Cards in columns at least 260 px wide, as many as fit, every column the
 * same width — the last row keeps the grid rather than stretching
 * (reference .cbd-charts-grid: repeat(auto-fill, minmax(260px, 1fr))).
 */
export function CardGrid({ children, min = 260, gap = 14 }: { children: ReactNode; min?: number; gap?: number }): ReactElement {
  const [width, setWidth] = useState(0);
  const cols = width ? Math.max(1, Math.floor((width + gap) / (min + gap))) : 1;
  const cell = width ? (width - gap * (cols - 1)) / cols : 0;
  return (
    <View
      onLayout={(e) => setWidth(Math.floor(e.nativeEvent.layout.width))}
      style={{ flexDirection: "row", flexWrap: "wrap", gap, alignItems: "flex-start" }}
    >
      {width
        ? Children.toArray(children).map((child, i) => (
          <View key={i} style={{ width: cell, minWidth: 0 }}>{child}</View>
        ))
        : null}
    </View>
  );
}
