/**
 * The board view's place in the panel. The board itself (a lane per status,
 * cards, drag to change status) is its own task (pbd-759.8); until then the
 * switch is complete and this says what is not there yet.
 */

import type { ReactElement } from "react";
import { Text, View } from "react-native";
import { useBeads } from "../beads.tsx";
import { FONT } from "../theme.ts";

export function BoardView(): ReactElement {
  const { pal, t } = useBeads();
  return (
    <View testID="beads-board" style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28 }}>
      <Text style={{ color: pal.muted, fontSize: FONT.md, textAlign: "center" }}>{t.boardSoon}</Text>
    </View>
  );
}
