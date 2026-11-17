/**
 * Tree / board / charts — the toolbar's view switch (reference viewSwitch,
 * setView). The choice is the tab's (store `view`); leaving board or charts
 * for the tree is all it does, the filters and search carry across.
 */

import { useBeads } from "./beads.tsx";
import { Seg } from "./seg.tsx";
import { useStore, type View } from "./store.tsx";

export function ViewSwitch() {
  const { pal, t } = useBeads();
  const { ui, dispatch } = useStore();
  return (
    <Seg<View>
      pal={pal}
      testID="beads-view-switch"
      aria={`${t.viewTree} / ${t.viewBoard} / ${t.viewCharts}`}
      value={ui.view}
      onChange={(view) => dispatch({ type: "view", view })}
      options={[
        { value: "tree", icon: "ListTree", tip: t.viewTreeTip, aria: t.viewTree, testID: "beads-view-tree" },
        { value: "board", icon: "SquareKanban", tip: t.viewBoardTip, aria: t.viewBoard, testID: "beads-view-board" },
        { value: "charts", icon: "ChartPie", tip: t.viewChartsTip, aria: t.viewCharts, testID: "beads-view-charts" },
      ]}
    />
  );
}
