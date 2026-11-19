/**
 * The tree's empty states (reference renderEmptyTree): loading, nothing
 * matches the filters, and every "nothing to show because something is
 * wrong" code, each with a Retry. EmptyBox is the look alone, which the
 * explorer shares.
 */

import { Text, View } from "react-native";
import type { Failure } from "../shared/types.ts";
import { useBeads } from "./beads.tsx";
import type { Strings } from "./i18n/strings.ts";
import { FONT, MONO, MONO_DOM, mix, type Palette } from "./theme.ts";
import { Btn } from "./ui.tsx";

/**
 * A short human phrase for the failure codes a person can act on, or null for
 * the rest (the "may be out of date" strip then shows the server's message).
 */
export function failureHead(t: Strings, code: string | undefined): string | null {
  if (code === "no_project") return t.emptyNoProject;
  if (code === "unknown_workspace") return t.emptyNoWorkspace;
  if (code === "no_beads" || code === "not_found" || code === "not_a_directory") return t.emptyNoBeads;
  if (code === "not_initialized" || code === "no_data") return t.emptyNotInit;
  if (code === "no_bd") return t.emptyNoBd;
  if (code === "timeout") return t.loadStaleTimeout;
  return null;
}

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
    <EmptyBox
      pal={pal}
      testID={`beads-empty-${kind}`}
      head={head}
      hint={hint}
      action={kind === "failure" ? { label: t.retryLoad, testID: "beads-empty-retry", onPress: () => void data.load("manual") } : null}
    />
  );
}

/**
 * The look of an empty state, without the panel's context: the tab's tree
 * (EmptyState) and the explorer (client/explorer.tsx) draw the same one.
 * `compact` — a narrow column: less padding, smaller heading.
 */
export function EmptyBox({ pal, head, hint, action, testID, compact }: {
  pal: Palette;
  head: string;
  hint?: string;
  action?: { label: string; onPress: () => void; testID?: string } | null;
  testID?: string;
  compact?: boolean;
}) {
  return (
    <View testID={testID} style={{ alignSelf: "center", alignItems: "center", maxWidth: 420, padding: compact ? 14 : 28, gap: 6, marginVertical: compact ? 12 : 24 }}>
      <Text style={{ color: pal.ink, fontSize: compact ? 14 : 15, fontWeight: "600", textAlign: "center" }}>{head}</Text>
      {hint ? (
        <Text style={{ color: pal.muted, fontSize: FONT.md, textAlign: "center", lineHeight: 19 }}>
          {/* `bd init` in a hint is a command: drawn as code, not with its backticks. */}
          {hint.split("`").map((part, i) =>
            i % 2 ? (
              <Text key={i} {...MONO_DOM} style={{ fontFamily: MONO, color: pal.ink2, backgroundColor: mix(pal.ink, 8, pal.card) }}>{` ${part} `}</Text>
            ) : (
              part
            ),
          )}
        </Text>
      ) : null}
      {action ? <Btn pal={pal} label={action.label} testID={action.testID} style={{ marginTop: 10 }} onPress={action.onPress} /> : null}
    </View>
  );
}
