/**
 * The panel's data layer: the issue tree and the cards of one workspace, kept
 * in react-query's cache (shared by every plugin, so every key starts with
 * ["beads", hostId, workspaceId]).
 *
 * Port of the reference's loading code (cloudcli-plugin-beads, dist/index.js:
 * loadTree/runTree, checkRevision, schedule, projectCache, loadCard,
 * revalidateOpenCards):
 *
 * - The tree is fetched once, then a cheap beads.revision is polled on the
 *   reader's interval; only a moved revision fetches the tree again, and then
 *   with `have`, so an unchanged project answers in a few bytes.
 * - Failed rounds back off: base · 2^failures, capped at max(base, 5 min).
 * - Last good wins: a failed refresh never wipes the rows on screen. It sets
 *   `loadIssue` (the stale bar) instead; the empty state is only for a
 *   workspace that never loaded.
 * - Coming back is instant: the last tree per workspace stays in the cache
 *   between mounts (CACHE_PROJECTS workspaces), and a remount revalidates it
 *   in the background with `have`.
 * - Cards are cached by id with the revision they were read at, shown at once
 *   when seen before, and refetched in the background when the tree moves.
 *
 * The query functions never throw for an expected failure: they return the
 * state to draw, so react-query never swaps the last good data for an error.
 */

import { useRpc } from "@getpaseo/plugin/client";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import { issueRpc, revisionRpc, searchRpc, treeRpc } from "../shared/rpc.ts";
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN, hitsFor, type SearchHits } from "../shared/tree.ts";
import type { ExportStatus } from "../shared/types.ts";
import {
  BUSY_RETRY_MS, CACHE_PROJECTS, CARD_GC_MS, EMPTY, POLL_BACKOFF_MAX_MS, SOFT, TREE_GC_MS,
  cardKey, runCard, runTree, treeKey, type CardState, type LoadReason, type TreeState,
} from "./load.ts";

export * from "./load.ts";

// ── workspaces kept in memory ─────────────────────────────────────────

const recent: string[] = [];

/** Keep the last CACHE_PROJECTS workspaces' data; drop the oldest beyond that. */
function touchWorkspace(qc: QueryClient, hostId: string, workspaceId: string) {
  const id = JSON.stringify([hostId, workspaceId]);
  const at = recent.indexOf(id);
  if (at >= 0) recent.splice(at, 1);
  recent.push(id);
  while (recent.length > CACHE_PROJECTS) {
    const [h, w] = JSON.parse(recent.shift()!) as [string, string];
    qc.removeQueries({ queryKey: ["beads", h, w] });
  }
}

// ── the tree ──────────────────────────────────────────────────────────

export interface BeadsData {
  state: TreeState;
  /** True until the first answer (or the cached one) is in. */
  loading: boolean;
  /** Fetch the tree now (Refresh, Retry, after a write). */
  load(reason?: LoadReason): Promise<void>;
}

/**
 * The tree of one workspace, polled on `pollMs`. Every timer it starts is
 * cleared on unmount — a leaked one wedges the plugin's reload.
 */
export function useBeadsTree(hostId: string, workspaceId: string, pollMs: number): BeadsData {
  const qc = useQueryClient();
  const treeCall = useRpc(treeRpc);
  const revCall = useRpc(revisionRpc);
  const key = useMemo(() => treeKey(hostId, workspaceId), [hostId, workspaceId]);

  useEffect(() => touchWorkspace(qc, hostId, workspaceId), [qc, hostId, workspaceId]);

  const fetchOpts = useCallback(
    (reason: LoadReason) => ({
      queryKey: key,
      queryFn: () => runTree(qc.getQueryData<TreeState>(key), reason, workspaceId, treeCall),
      staleTime: 0,
      gcTime: TREE_GC_MS,
      retry: false as const,
    }),
    [qc, key, workspaceId, treeCall],
  );

  const query = useQuery({
    queryKey: key,
    queryFn: () => {
      const prev = qc.getQueryData<TreeState>(key);
      return runTree(prev, prev?.tree ? "revalidate" : "project", workspaceId, treeCall);
    },
    staleTime: 0,
    gcTime: TREE_GC_MS,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    structuralSharing: false,
  });

  /** At most one request at a time: a hard reason waits for the one in flight, then asks again. */
  const load = useCallback(
    async (reason: LoadReason = "manual") => {
      if (qc.isFetching({ queryKey: key, exact: true })) {
        await qc.fetchQuery(fetchOpts(reason)).catch(() => undefined);
        if (SOFT.indexOf(reason) >= 0) return;
      }
      await qc.fetchQuery(fetchOpts(reason)).catch(() => undefined);
    },
    [qc, key, fetchOpts],
  );

  const loadRef = useRef(load);
  loadRef.current = load;

  // The revision poll: a chain of timeouts, so each wait can differ (backoff).
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const current = () => qc.getQueryData<TreeState>(key);
    const patch = (fn: (s: TreeState) => TreeState) => qc.setQueryData<TreeState>(key, (s) => (s ? fn(s) : s));

    async function check() {
      const s = current();
      if (!s) return;
      let res: any;
      try {
        res = await revCall({ workspaceId });
      } catch {
        res = null;
      }
      if (disposed) return;
      if (!res || !res.ok) {
        patch((x) => ({ ...x, failures: Math.min(x.failures + 1, 16) }));
        return;
      }
      patch((x) => (x.export === res.export ? x : { ...x, export: res.export }));
      const held = current();
      if (!held) return;
      let fetched = false;
      if (res.revision && res.revision !== held.revision) {
        const exp: ExportStatus | undefined = res.export;
        if (exp && exp.revision === res.revision && exp.supersededFrom === held.revision && held.tree) {
          // Our own export rewrote the file: same data under a new revision.
          adoptRevision(qc, hostId, workspaceId, held.revision!, res.revision);
        } else {
          fetched = true;
          await loadRef.current("poll");
        }
      } else if (held.loadIssue && !res.loadError) {
        fetched = true;
        await loadRef.current("poll");
      } else if (res.loadError) {
        patch((x) => ({ ...x, failures: Math.min(x.failures + 1, 16) }));
      } else if (held.failures) {
        patch((x) => ({ ...x, failures: 0 }));
      }
      if (disposed) return;
      if (res.loadError && !fetched) {
        patch((x) => (x.tree ? { ...x, loadIssue: { kind: "backend", code: res.loadError.code, message: res.loadError.message } } : x));
      }
    }

    function arm() {
      if (disposed) return;
      const f = current()?.failures ?? 0;
      const wait = f ? Math.min(pollMs * 2 ** f, Math.max(pollMs, POLL_BACKOFF_MAX_MS)) : pollMs;
      timer = setTimeout(tick, wait);
    }

    async function tick() {
      timer = null;
      if (AppState.currentState !== "background") await check();
      if (!disposed && !timer) arm();
    }

    arm();
    // Back in front: look now rather than at the end of the interval.
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active" || disposed) return;
      if (timer) clearTimeout(timer);
      void tick();
    });
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      sub.remove();
    };
  }, [qc, key, hostId, workspaceId, pollMs, revCall]);

  const state = query.data ?? EMPTY;

  // `busy`: the server keeps loading bd in the background; ask again shortly.
  useEffect(() => {
    if (!state.busy) return;
    const t = setTimeout(() => void loadRef.current("revalidate"), BUSY_RETRY_MS);
    return () => clearTimeout(t);
  }, [state]);

  const loading = !query.data || (!state.tree && !state.empty);
  return useMemo(() => ({ state, loading, load }), [state, loading, load]);
}

/** Move to a revision holding the same data: the tree and the cards read at `from` move with it. */
function adoptRevision(qc: QueryClient, hostId: string, workspaceId: string, from: string, to: string) {
  qc.setQueryData<TreeState>(treeKey(hostId, workspaceId), (s) =>
    s ? { ...s, revision: to, tree: s.tree ? { ...s.tree, revision: to } : s.tree } : s,
  );
  for (const [k, v] of qc.getQueriesData<CardState>({ queryKey: ["beads", hostId, workspaceId, "card"] })) {
    if (v && v.revision === from) qc.setQueryData<CardState>(k, { ...v, revision: to });
  }
}

// ── cards ─────────────────────────────────────────────────────────────

/**
 * A card: cached copy at once, a fetch only when it is missing or older than
 * the tree (`treeRevision`).
 */
export function useCard(hostId: string, workspaceId: string, id: string | null, treeRevision: string | null) {
  const qc = useQueryClient();
  const issueCall = useRpc(issueRpc);
  const key = useMemo(() => cardKey(hostId, workspaceId, id ?? ""), [hostId, workspaceId, id]);
  const query = useQuery({
    queryKey: key,
    enabled: Boolean(id),
    queryFn: () => runCard(qc.getQueryData<CardState>(key), workspaceId, id!, issueCall),
    staleTime: Infinity,
    gcTime: CARD_GC_MS,
    retry: (n, err) => Boolean((err as { busy?: boolean })?.busy) && n < 5,
    retryDelay: BUSY_RETRY_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    structuralSharing: false,
  });
  const data = query.data;
  const fetching = query.isFetching;
  const refetch = query.refetch;
  // The tree moved past the copy we hold: revalidate in the background — once
  // per tree revision, so a reload that keeps failing is not retried in a loop.
  const tried = useRef<string | null>(null);
  useEffect(() => {
    if (!id || !data || fetching || !treeRevision) return;
    const mark = `${id}@${treeRevision}`;
    if (data.revision !== treeRevision && tried.current !== mark) {
      tried.current = mark;
      void refetch();
    }
  }, [id, data, fetching, treeRevision, refetch]);
  const reload = useCallback(() => void refetch(), [refetch]);
  return { data: id ? data ?? null : null, loading: Boolean(id) && !data, reload };
}

// ── full-text search ──────────────────────────────────────────────────

/**
 * The server's full-text answer for the quick search (reference
 * scheduleSearch): asked from SEARCH_MIN characters on, after
 * SEARCH_DEBOUNCE_MS of quiet, and again when the tree's revision moves.
 * Hits count only for the query they answer (hitsFor), so the previous
 * query's rows never flash by while the next one is in flight.
 */
export function useSearch(workspaceId: string, query: string, revision: string | null): { ids: ReadonlySet<string> | null; searching: boolean } {
  const searchCall = useRpc(searchRpc);
  const callRef = useRef(searchCall);
  callRef.current = searchCall;
  const [hits, setHits] = useState<SearchHits | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const q = query.trim();
  useEffect(() => {
    if (q.length < SEARCH_MIN) {
      setPending(null);
      return;
    }
    let live = true;
    setPending(q);
    const timer = setTimeout(() => {
      callRef.current({ workspaceId, q }).then(
        (res: any) => {
          if (!live) return;
          setHits(res && res.ok ? { q, ids: new Set<string>(res.ids) } : null);
          setPending(null);
        },
        () => {
          if (!live) return;
          setHits(null);
          setPending(null);
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [workspaceId, q, revision]);
  return { ids: hitsFor(hits, q), searching: pending === q && q.length >= SEARCH_MIN };
}
