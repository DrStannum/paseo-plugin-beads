/**
 * The panel's data layer: the issue tree and the cards of one workspace, kept
 * in react-query's cache — the plugin installation's QueryClient, shared by
 * every tab, explorer copy and workspace of the host (keys start with
 * ["beads", hostId, workspaceId] all the same).
 *
 * Port of the reference's loading code (cloudcli-plugin-beads, dist/index.js:
 * loadTree/runTree, checkRevision, schedule, projectCache, loadCard,
 * revalidateOpenCards):
 *
 * - The tree is fetched once and stays fresh until a cheap beads.revision,
 *   polled on the reader's interval, says it moved; only then is the tree
 *   asked again, with `have` and `deltas`, so a moved project answers with
 *   the rows that changed and an unchanged one in a few bytes.
 * - One poller per workspace (client/poller.ts), however many copies of the
 *   panel are mounted (hidden tabs stay mounted and would each poll); the
 *   last copy to unmount stops it.
 * - Failed rounds back off: base · 2^failures, capped at max(base, 5 min).
 * - Last good wins: a failed refresh never wipes the rows on screen. It sets
 *   `loadIssue` (the stale bar) instead; the empty state is only for a
 *   workspace that never loaded.
 * - Coming back is instant: the last tree per workspace stays in the cache
 *   between mounts (CACHE_PROJECTS workspaces, never evicting one still
 *   shown); a remount draws it and fetches nothing, and a poller that starts
 *   over held data checks the revision at once.
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
  BUSY_RETRY_MS, CACHE_PROJECTS, CARD_GC_MS, EMPTY, SOFT, TREE_GC_MS,
  cardKey, isRefreshing, runCard, runTree, treeKey, type CardState, type LoadReason, type TreeState,
} from "./load.ts";
import { createPollers, type PollHandle, type PollSource } from "./poller.ts";

export * from "./load.ts";

// ── workspaces kept in memory ─────────────────────────────────────────

const recent: string[] = [];

/** The revision pollers, one per workspace shown (module-wide = per plugin installation). */
const pollers = createPollers<ExportStatus | null>({
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  background: () => AppState.currentState === "background",
  onForeground: (fn) => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") fn();
    });
    return () => sub.remove();
  },
});
const pollKey = (hostId: string, workspaceId: string) => JSON.stringify([hostId, workspaceId]);

/**
 * Keep the last CACHE_PROJECTS workspaces' data; drop the oldest beyond that
 * — never one a mounted panel (a hidden tab, too) still shows.
 */
function touchWorkspace(qc: QueryClient, hostId: string, workspaceId: string) {
  const id = pollKey(hostId, workspaceId);
  const at = recent.indexOf(id);
  if (at >= 0) recent.splice(at, 1);
  recent.push(id);
  for (let i = 0; recent.length > CACHE_PROJECTS && i < recent.length; ) {
    if (pollers.live(recent[i]!)) {
      i++;
      continue;
    }
    const [h, w] = JSON.parse(recent.splice(i, 1)[0]!) as [string, string];
    qc.removeQueries({ queryKey: ["beads", h, w] });
  }
}

// ── the tree ──────────────────────────────────────────────────────────

export interface BeadsData {
  state: TreeState;
  /** True until the first answer (or the cached one) is in. */
  loading: boolean;
  /** Rows are on screen and newer ones are on their way (isRefreshing). */
  refreshing: boolean;
  /** Fetch the tree now (Refresh, Retry, after a write). */
  load(reason?: LoadReason): Promise<void>;
  /**
   * One revision check now, outside the interval (the export watcher polls
   * this fast while a background job runs). Answers the job's status, or
   * null if the check failed or the panel is gone.
   */
  checkNow(): Promise<ExportStatus | null>;
}

/**
 * The tree of one workspace. Every copy of the panel reads the same cache
 * entry (the installation's QueryClient) and joins the same revision poller
 * (`pollers`); the data counts as fresh until the poll sees the revision move,
 * so mounting another copy asks the daemon nothing.
 */
export function useBeadsTree(hostId: string, workspaceId: string, pollMs: number): BeadsData {
  const qc = useQueryClient();
  const treeCall = useRpc(treeRpc);
  const revCall = useRpc(revisionRpc);
  const key = useMemo(() => treeKey(hostId, workspaceId), [hostId, workspaceId]);

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
    // Fresh until the revision poll says otherwise: a remount or a second
    // copy draws the cached tree and fetches nothing.
    staleTime: Infinity,
    refetchOnMount: false,
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
  const revRef = useRef(revCall);
  revRef.current = revCall;
  const pollRef = useRef(pollMs);
  pollRef.current = pollMs;
  const handle = useRef<PollHandle<ExportStatus | null> | null>(null);
  const checkNow = useCallback(() => (handle.current ? handle.current.checkNow() : Promise.resolve(null)), []);

  // Join the workspace's poller; the last copy to leave stops it.
  useEffect(() => {
    const source = treeSource(qc, hostId, workspaceId, (input) => revRef.current(input), (reason) => loadRef.current(reason));
    // Nobody polled while no panel showed it: what we hold may be old, look now.
    const held = Boolean(qc.getQueryData<TreeState>(key)?.tree);
    const h = pollers.acquire(pollKey(hostId, workspaceId), pollRef.current, source, { now: held });
    handle.current = h;
    return () => {
      if (handle.current === h) handle.current = null;
      h.release();
    };
  }, [qc, key, hostId, workspaceId]);
  useEffect(() => handle.current?.setPollMs(pollMs), [pollMs]);

  // After the poller: this workspace is live, so it is never the one evicted.
  useEffect(() => touchWorkspace(qc, hostId, workspaceId), [qc, hostId, workspaceId]);

  const state = query.data ?? EMPTY;

  // `busy`: the server keeps loading bd in the background; ask again shortly
  // (one retry per workspace, however many copies saw it).
  useEffect(() => {
    if (state.busy) handle.current?.retry(BUSY_RETRY_MS, () => void loadRef.current("revalidate"));
  }, [state]);

  // A tree fetched in this mount (none was cached) may be the server's disk
  // copy of an older revision: look at the revision now, not an interval later.
  const hadTree = useRef(Boolean(state.tree));
  useEffect(() => {
    if (!state.tree || hadTree.current) return;
    hadTree.current = true;
    handle.current?.wake();
  }, [state.tree]);

  const loading = !query.data || (!state.tree && !state.empty);
  // isFetching is the query's, so every copy of the panel sees the same.
  const refreshing = isRefreshing(state, query.isFetching);
  return useMemo(() => ({ state, loading, refreshing, load, checkNow }), [state, loading, refreshing, load, checkNow]);
}

/**
 * One round of the revision poll for a workspace: the export status into the
 * cache, a moved revision fetches the tree (with `have`), our own export only
 * relabels what we hold, failures feed the backoff.
 */
function treeSource(
  qc: QueryClient,
  hostId: string,
  workspaceId: string,
  revCall: (input: { workspaceId: string }) => Promise<unknown>,
  load: (reason: LoadReason) => Promise<void>,
): PollSource<ExportStatus | null> {
  const key = treeKey(hostId, workspaceId);
  const current = () => qc.getQueryData<TreeState>(key);
  const patch = (fn: (s: TreeState) => TreeState) => qc.setQueryData<TreeState>(key, (s) => (s ? fn(s) : s));
  return {
    failures: () => current()?.failures ?? 0,
    async check(live) {
      const s = current();
      if (!s) return null;
      let res: any;
      try {
        res = await revCall({ workspaceId });
      } catch {
        res = null;
      }
      if (!live()) return null;
      if (!res || !res.ok) {
        patch((x) => ({ ...x, failures: Math.min(x.failures + 1, 16) }));
        return null;
      }
      patch((x) => (x.export === res.export ? x : { ...x, export: res.export }));
      const held = current();
      if (!held) return res.export ?? null;
      let fetched = false;
      if (res.revision && res.revision !== held.revision) {
        const exp: ExportStatus | undefined = res.export;
        if (exp && exp.revision === res.revision && exp.supersededFrom === held.revision && held.tree) {
          // Our own export rewrote the file: same data under a new revision.
          adoptRevision(qc, hostId, workspaceId, held.revision!, res.revision);
        } else {
          fetched = true;
          // The rows held are behind now: every copy shows "Refreshing…" until the tree is in.
          patch((x) => (x.behind === held.revision ? x : { ...x, behind: held.revision }));
          await load("poll");
        }
      } else if (held.loadIssue && !res.loadError) {
        fetched = true;
        await load("poll");
      } else if (res.loadError) {
        patch((x) => ({ ...x, failures: Math.min(x.failures + 1, 16) }));
      } else if (held.failures) {
        patch((x) => ({ ...x, failures: 0 }));
      }
      if (!live()) return null;
      if (res.loadError && !fetched) {
        patch((x) => (x.tree ? { ...x, loadIssue: { kind: "backend", code: res.loadError.code, message: res.loadError.message } } : x));
      }
      return res.export ?? null;
    },
  };
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
