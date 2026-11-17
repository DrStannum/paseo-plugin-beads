/**
 * Everything the panel writes, in one place: the edits behind the status
 * menu, "Assign to me", the edit / create form and the comment box, plus the
 * export / sync job those writes set off and the editor that is open.
 *
 * A write's answer carries the fresh card: it goes straight into the card
 * cache (reference rememberCard), then the tree is fetched again — a status,
 * a parent or a new issue moves rows. Writes may answer `issue: null,
 * reloading: true` (the server's reload overran its budget): the card is then
 * refetched instead. After every write the export the server queued is
 * watched with a fast poll, so the badge reports it and the panel adopts the
 * revision the export produced instead of refetching the same data.
 */

import type { PluginTab } from "@getpaseo/plugin/client";
import { useRpc } from "@getpaseo/plugin/client";
import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { commentRpc, createRpc, editRpc, exportRpc, syncRpc } from "../shared/rpc.ts";
import type { Card, CreateFields, EditFields } from "../shared/types.ts";
import { useBeads } from "./beads.tsx";
import { cardKey, type CardState } from "./data.ts";
import { EXPORT_DONE_MS, EXPORT_WATCH_MS, EXPORT_WATCH_TICKS, TRACK_INIT, badgeOf, observed, requested, type ExportBadge } from "./export-state.ts";
import { useBeadsSettings } from "./settings.tsx";

export type WriteResult = { ok: true; id: string } | { ok: false; message: string };

/** The form that is open: an existing issue, or a new one (optionally under a parent). */
export type EditorTarget = { mode: "edit"; card: Card } | { mode: "create"; parent: string | null } | null;

export interface Writes {
  edit(id: string, fields: EditFields): Promise<WriteResult>;
  create(fields: CreateFields): Promise<WriteResult>;
  /** Signed with the name from the settings, if one is set. */
  comment(id: string, text: string): Promise<WriteResult>;
  /** One-field edits straight from the card (reference changeStatus / assignToMe). */
  changeStatus(id: string, status: string): void;
  assignToMe(id: string): void;
  /** The issue whose status / assignee is being written, and the last refusal. */
  quick: QuickState;
  sync(): void;
  exportAgain(): void;
  badge: ExportBadge;
  editor: EditorTarget;
  openEditor(target: EditorTarget): void;
  /** The panel's tab: the form marks it modified while it holds unsaved input. */
  tab: PluginTab;
}

export interface QuickState {
  statusBusy: string | null;
  assignBusy: string | null;
  statusError: { id: string; message: string } | null;
  assignError: { id: string; message: string } | null;
}

const QUICK_INIT: QuickState = { statusBusy: null, assignBusy: null, statusError: null, assignError: null };

const WritesContext = createContext<Writes | null>(null);

function failureText(res: any): string {
  if (!res) return "request failed";
  return String(res.message || res.code || "request failed");
}

export function WritesProvider({ tab, children }: { tab: PluginTab; children: ReactNode }) {
  const { hostId, workspaceId, data, t } = useBeads();
  const settings = useBeadsSettings();
  const qc = useQueryClient();
  const editCall = useRpc(editRpc);
  const createCall = useRpc(createRpc);
  const commentCall = useRpc(commentRpc);
  const exportCall = useRpc(exportRpc);
  const syncCall = useRpc(syncRpc);
  const [editor, setEditor] = useState<EditorTarget>(null);

  // ── the export / sync job ──────────────────────────────────────────
  const [track, setTrack] = useState(TRACK_INIT);
  const [, repaint] = useState(0);
  const exportStatus = data.state.export;
  useEffect(() => setTrack((t) => observed(t, exportStatus, Date.now())), [exportStatus]);
  // The "done" confirmation goes away by itself.
  useEffect(() => {
    if (!track.doneAt) return;
    const left = track.doneAt + EXPORT_DONE_MS + 50 - Date.now();
    if (left <= 0) return;
    const timer = setTimeout(() => repaint((n) => n + 1), left);
    return () => clearTimeout(timer);
  }, [track.doneAt]);

  const checkNow = data.checkNow;
  const watching = useRef<ReturnType<typeof setInterval> | null>(null);
  const trackRef = useRef(track);
  trackRef.current = track;
  /** Poll fast while a job runs: the normal interval is minutes, the job takes seconds. */
  const watch = useCallback(() => {
    if (watching.current) return;
    let ticks = 0;
    watching.current = setInterval(() => {
      void checkNow().then((status) => {
        if (!watching.current) return;
        ticks++;
        const busy = Boolean(status && (status.running || status.pending)) || trackRef.current.wanted;
        if ((!busy && ticks > 1) || ticks > EXPORT_WATCH_TICKS) {
          clearInterval(watching.current);
          watching.current = null;
        }
      });
    }, EXPORT_WATCH_MS);
  }, [checkNow]);
  useEffect(() => () => {
    if (watching.current) clearInterval(watching.current);
    watching.current = null;
  }, []);

  const startJob = useCallback(
    (kind: "sync" | "export") => {
      setTrack((t) => requested(t, kind === "sync"));
      const call = kind === "sync" ? syncCall : exportCall;
      // Whatever the call says, the watcher reports what the backend ends up doing.
      void call({ workspaceId }).catch(() => undefined).then(() => watch());
    },
    [syncCall, exportCall, workspaceId, watch],
  );

  // ── writes ─────────────────────────────────────────────────────────
  const landed = useCallback(
    async (id: string, res: any) => {
      const key = cardKey(hostId, workspaceId, id);
      if (res.issue) {
        const note = res.stale ? { code: res.stale.code, message: res.stale.message } : null;
        qc.setQueryData<CardState>(key, { card: res.issue, revision: res.revision, note, failed: false });
      } else {
        void qc.invalidateQueries({ queryKey: key, exact: true });
      }
      await data.load("save");
      watch();
    },
    [qc, hostId, workspaceId, data, watch],
  );

  const run = useCallback(
    async (id: string | null, call: () => Promise<any>): Promise<WriteResult> => {
      let res: any;
      try {
        res = await call();
      } catch (err) {
        return { ok: false, message: err && typeof err === "object" && "message" in err ? String((err as Error).message) : String(err) };
      }
      if (!res || !res.ok) return { ok: false, message: failureText(res) };
      const target = id ?? String(res.id);
      await landed(target, res);
      return { ok: true, id: target };
    },
    [landed],
  );

  const edit = useCallback((id: string, fields: EditFields) => run(id, () => editCall({ workspaceId, id, fields: fields as Record<string, unknown> })), [run, editCall, workspaceId]);
  const create = useCallback((fields: CreateFields) => run(null, () => createCall({ workspaceId, fields: fields as unknown as Record<string, unknown> })), [run, createCall, workspaceId]);
  const author = settings.currentUser.trim();
  const comment = useCallback(
    (id: string, text: string) => run(id, () => commentCall(author ? { workspaceId, id, text, author } : { workspaceId, id, text })),
    [run, commentCall, workspaceId, author],
  );

  // ── one-field edits from the card ──────────────────────────────────
  const [quick, setQuick] = useState<QuickState>(QUICK_INIT);
  const quickRef = useRef(quick);
  quickRef.current = quick;
  const changeStatus = useCallback(
    (id: string, status: string) => {
      if (quickRef.current.statusBusy) return;
      setQuick((q) => ({ ...q, statusBusy: id, statusError: null }));
      void edit(id, { status }).then((r) =>
        setQuick((q) => ({ ...q, statusBusy: null, statusError: r.ok ? null : { id, message: `${t.stFailed}: ${r.message}` } })),
      );
    },
    [edit, t],
  );
  const me = author;
  const assignToMe = useCallback(
    (id: string) => {
      if (quickRef.current.assignBusy || !me) return;
      setQuick((q) => ({ ...q, assignBusy: id, assignError: null }));
      void edit(id, { assignee: me }).then((r) =>
        setQuick((q) => ({ ...q, assignBusy: null, assignError: r.ok ? null : { id, message: `${t.assignFailed}: ${r.message}` } })),
      );
    },
    [edit, t, me],
  );

  const badge = badgeOf(track, Date.now());
  const value = useMemo<Writes>(
    () => ({
      edit, create, comment, badge, editor, tab, changeStatus, assignToMe, quick,
      sync: () => startJob("sync"),
      exportAgain: () => startJob("export"),
      openEditor: setEditor,
    }),
    // badge is a fresh object each render; compare what it says.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [edit, create, comment, JSON.stringify(badge), editor, tab, startJob, changeStatus, assignToMe, quick],
  );
  return <WritesContext.Provider value={value}>{children}</WritesContext.Provider>;
}

export function useWrites(): Writes {
  const w = useContext(WritesContext);
  if (!w) throw new Error("useWrites outside WritesProvider");
  return w;
}
