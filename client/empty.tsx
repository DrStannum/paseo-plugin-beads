/**
 * The tree's empty states (reference renderEmptyTree): loading, nothing
 * matches the filters, and every "nothing to show because something is
 * wrong" code, each with a Retry.
 */

import { Text, View } from "react-native";
import type { Failure } from "../shared/types.ts";
import { useBeads } from "./beads.tsx";
import type { Strings } from "./i18n/strings.ts";
import { FONT } from "./theme.ts";
import { Btn } from "./ui.tsx";

/** Heading and hint for a failure code. */
export function emptyText(t: Strings, empty: Failure): [string, string] {
  const code = empty.code;
  if (code === "no_project") return [t.emptyNoProject, t.emptyNoProjectHint];
  if (code === "unknown_workspace") return [t.emptyNoWorkspace, t.emptyNoWorkspaceHint];
  if (code === "no_beads" || code === "not_found" || code === "not_a_directory") return [t.emptyNoBeads, t.emptyNoBeadsHint];
  if (code === "not_initialized" || code === "no_data") return [t.emptyNotInit, t.emptyNotInitHint];
  if (code === "no_bd") return [t.emptyNoBd, t.emptyNoBdHint];
  return [t.emptyError, empty.message || code || ""];
}

export function EmptyState({ kind }: { kind: "loading" | "filtered" | "failure" | "none" }) {
  const { pal, t, data } = useBeads();
  let head = t.loading;
  let hint = "";
  if (kind === "filtered") {
    head = t.emptyNothing;
    hint = t.emptyNothingHint;
  } else if (kind === "failure" && data.state.empty) {
    [head, hint] = emptyText(t, data.state.empty);
  } else if (kind === "none") {
    head = t.emptyNoBeads;
    hint = t.emptyNoBeadsHint;
  }
  return (
    <View testID={`beads-empty-${kind}`} style={{ alignSelf: "center", alignItems: "center", maxWidth: 420, padding: 28, gap: 6, marginVertical: 24 }}>
      <Text style={{ color: pal.ink, fontSize: 15, fontWeight: "600", textAlign: "center" }}>{head}</Text>
      {hint ? <Text style={{ color: pal.muted, fontSize: FONT.md, textAlign: "center", lineHeight: 19 }}>{hint}</Text> : null}
      {kind === "failure" ? (
        <Btn pal={pal} label={t.retryLoad} testID="beads-empty-retry" style={{ marginTop: 10 }} onPress={() => void data.load("manual")} />
      ) : null}
    </View>
  );
}
