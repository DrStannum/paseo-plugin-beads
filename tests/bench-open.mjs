// @ts-check
/**
 * How long the panel takes to show rows in the real Paseo web app, and how
 * much it asks the daemon for on the way — the user's side of the numbers in
 * tests/bench-large.ts. On a LARGE SYNTHETIC fixture (tests/fixture/build.mjs,
 * `many` + `rich`), never on a real project.
 *
 *   npm run bench:open                         # 4000 issues, 3 runs, built and removed
 *   npm run bench:open -- --n 2000             # another size
 *   npm run bench:open -- --runs 5             # more runs (the table shows medians)
 *   npm run bench:open -- --keep               # leave the fixture for another run
 *   npm run bench:open -- --dir <fixture dir>  # reuse one left by --keep (here or by bench)
 *
 * Each run reloads the plugin (`paseo plugin reload beads`: the server's
 * memory is empty, its disk snapshot is not) and boots the app in a fresh
 * browser context (the client's cache is empty), then, on one page:
 *   a  cold      Command Center "Open Beads" → first row; the server answers
 *                from its disk snapshot (see a0)
 *   b  warm      close the tab, "Open Beads" again (the client's cache is warm) → first row
 *   c  duplicate a second Beads tab from the pane's "+" menu (shared cache) → first row in it
 *   d  switch    to another tab of the workspace and back → the row is visible again
 *   f  charts    the view switch to Charts → the charts body is drawn
 *   h  delta     `bd update` of one issue outside the panel, then the page goes
 *                to the background and back (the poll's foreground check) →
 *                until the tree answer (a delta) has arrived
 *   r  reload    `paseo plugin reload beads` with the tab open → first row of the remounted panel;
 *                "r net" takes away the reload itself (the CLI until the daemon reports the
 *                plugin running); the panel may start loading before that, so it is a floor
 * a0 is a run of `a` alone before the others, while the project has no disk
 * snapshot yet (a fresh fixture, or one the last run unregistered: archiving
 * the workspace drops it): the cold start with a full `bd list`. It runs
 * only when there is no snapshot, and is not part of the medians.
 * Times are measured inside the page, from the pointerdown of the click (or
 * the start of the reload, or the foreground event) to the first animation
 * frame where the element is on screen; the watcher is armed before the click
 * and runs from its pointerdown, so a busy main thread does not delay the
 * measurement itself. RPCs are read from the page's WebSocket frames (CDP): per
 * scenario, the beads.* requests sent from the action until 1 s of quiet,
 * the round trip of the slowest tree call ("tree ms": sent → answer in, at
 * the page's socket) and the bytes of the answers (a tree answer is full,
 * delta or unchanged); `e` lists the answer sizes themselves.
 *
 * Paseo's daemon is shared: the only thing done to it is the plugin reload;
 * the fixture is registered for the run and unregistered after it (see
 * tests/lib/paseo-web.mjs, which also pins the plugin's settings). The page
 * opens only the fixture's workspace, our panel and a Diff tab in it.
 * Building the 4000-issue fixture takes bd about 2.5 min; a run about 1.5 min.
 */

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cacheFileFor } from '../server/beads/disk.ts';
import { closeBrowser, withPanel, withWorkspace } from './lib/paseo-web.mjs';
import { buildFixture } from './fixture/build.mjs';

const argv = process.argv.slice(2);
const opt = (/** @type {string} */ name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
const N = Number(opt('--n') ?? 4000);
const RUNS = Number(opt('--runs') ?? 3);
const KEEP = argv.includes('--keep');

const ROW = '[data-testid^="beads-row-"]';
const MAIN = '[data-testid="workspace-pane-main"]';
const BEADS_TAB = `${MAIN} [data-testid="workspace-tab-plugin_workspace_5_beads_5_beads"]`;
/** Longest wait for one scenario: a cold bd list on a big fixture plus busy retries. */
const WAIT_MS = 180_000;
/** The issue `h` edits from outside (every fixture size has it). */
const EDIT_KEY = 'demo-x0005';
const BD_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', BD_NON_INTERACTIVE: '1' };

const say = (/** @type {string} */ msg) => console.error(`[bench-open] ${msg}`);
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** `paseo plugin reload beads`, then wait until the daemon reports it running. Returns ms. */
async function reloadPlugin() {
  const t0 = Date.now();
  await new Promise((resolve, reject) => {
    const child = spawn('paseo', ['plugin', 'reload', 'beads'], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (b) => { err += b; });
    child.on('close', (code) => (code === 0 ? resolve(undefined) : reject(new Error(`plugin reload: ${code} ${err.trim()}`))));
  });
  for (let i = 0; i < 100; i++) {
    const [p] = JSON.parse(execFileSync('paseo', ['plugin', 'ls', 'beads', '--json'], { encoding: 'utf8' }));
    if (p?.status === 'running') return Date.now() - t0;
    await sleep(100);
  }
  throw new Error('beads did not come back after the reload');
}

// ---------------------------------------------------------------------------
// RPC capture: the page's WebSocket frames over CDP

/**
 * @typedef {{ at: number, method: string, sentBytes: number, answer?: { bytes: number, kind: string, at: number } }} Rpc
 */

/** Record every beads.* request of the page and the size and kind of its answer. */
async function captureRpcs(/** @type {any} */ page) {
  /** @type {Rpc[]} */
  const log = [];
  /** @type {Map<string, Rpc>} */
  const byId = new Map();
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.webSocketFrameSent', (/** @type {any} */ ev) => {
    const s = /** @type {string} */ (ev.response.payloadData);
    if (!s.includes('"plugin.rpc.invoke.request"') || !s.includes('"pluginId":"beads"')) return;
    const id = s.match(/"requestId":"([^"]+)"/)?.[1];
    const method = s.match(/"method":"([^"]+)"/)?.[1] ?? '?';
    const rpc = { at: Date.now(), method, sentBytes: Buffer.byteLength(s) };
    log.push(rpc);
    if (id) byId.set(id, rpc);
  });
  cdp.on('Network.webSocketFrameReceived', (/** @type {any} */ ev) => {
    const s = /** @type {string} */ (ev.response.payloadData);
    if (!s.includes('"plugin.rpc.invoke.response"')) return;
    const id = s.match(/"requestId":"([^"]+)"/)?.[1];
    const rpc = id ? byId.get(id) : undefined;
    if (!rpc) return;
    byId.delete(/** @type {string} */ (id));
    const head = s.slice(0, 400);
    // A delta's head comes first in the answer, its rows after; issue text is
    // JSON-escaped, so `"delta":true` cannot come from inside a row.
    const kind = /"unchanged":true/.test(head) ? 'unchanged'
      : /"ok":false/.test(head) ? (head.match(/"code":"([^"]+)"/)?.[1] ?? 'error')
        : /"unchanged":false/.test(head) ? (/"delta":true/.test(head) ? 'delta' : 'full') : 'ok';
    rpc.answer = { bytes: Buffer.byteLength(s), kind, at: Date.now() };
  });
  return {
    /** Requests sent from `since` on. */
    since: (/** @type {number} */ since) => log.filter((r) => r.at >= since),
    /** Wait until every request is answered and none was sent for `quietMs`. */
    async settle(quietMs = 1000, timeoutMs = WAIT_MS) {
      const end = Date.now() + timeoutMs;
      while (Date.now() < end) {
        const last = log.length ? log[log.length - 1].at : 0;
        if (byId.size === 0 && Date.now() - last >= quietMs) return;
        await sleep(100);
      }
      say(`RPCs did not settle: ${byId.size} unanswered`);
    },
  };
}

/** @param {Rpc[]} rpcs */
function summarize(rpcs) {
  const of = (/** @type {string} */ m) => rpcs.filter((r) => r.method === m);
  const tree = of('beads.tree');
  return {
    tree: tree.length,
    treeKinds: tree.map((r) => r.answer?.kind ?? 'none').join(','),
    treeMs: Math.max(0, ...tree.map((r) => (r.answer ? r.answer.at - r.at : 0))),
    revision: of('beads.revision').length,
    other: rpcs.length - tree.length - of('beads.revision').length,
    bytes: rpcs.reduce((n, r) => n + (r.answer?.bytes ?? 0), 0),
  };
}

// ---------------------------------------------------------------------------
// In-page timing

/**
 * The in-page watcher: `arm(sel)` before a click; its pointerdown starts the
 * clock and a requestAnimationFrame loop that notes the first frame where
 * `sel` is on screen outside an old panel. It runs inside the page from the
 * pointerdown on, so it sees that frame even when the main thread is too
 * busy to answer the test's own calls until later.
 */
async function installMarks(/** @type {any} */ page) {
  await page.evaluate(([timeoutMs]) => {
    const w = /** @type {any} */ (window);
    if (w.__bench) return;
    const b = (w.__bench = { mark: 0, want: null, seen: null });
    const visible = (/** @type {string} */ sel) => [...document.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0 && !e.closest('[data-bench-old]'));
    b.watch = () => {
      const sel = b.want;
      const start = b.mark;
      const tick = () => {
        if (b.want !== sel) return;
        if (visible(sel)) { b.seen = Math.round(performance.now() - start); b.want = null; return; }
        if (performance.now() - start > timeoutMs) { b.seen = -1; b.want = null; return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    document.addEventListener('pointerdown', () => {
      if (!b.want) return;
      b.mark = performance.now();
      b.watch();
    }, true);
  }, [WAIT_MS]);
}

/** Watch for `sel` from the next pointerdown on (or from now, `now`). */
const arm = (/** @type {any} */ page, /** @type {string} */ sel, now = false) => page.evaluate(([sel, now]) => {
  const b = /** @type {any} */ (window).__bench;
  b.want = sel;
  b.seen = null;
  if (now) { b.mark = performance.now(); b.watch(); }
}, [sel, now]);

/** Mark the panels on the page now, so a wait can look for a new one only. */
const markOldPanels = (/** @type {any} */ page) => page.evaluate(() => {
  for (const el of document.querySelectorAll('[data-testid="beads-panel"]')) el.setAttribute('data-bench-old', '1');
});

/** Milliseconds the armed watcher saw: from the pointerdown (or arm) to the first frame with the element. */
async function msUntil(/** @type {any} */ page) {
  const handle = await page.waitForFunction(() => /** @type {any} */ (window).__bench.seen, null, { timeout: WAIT_MS + 5_000, polling: 100 });
  const ms = await handle.jsonValue();
  if (ms < 0) throw new Error('not on screen in time');
  return ms;
}

async function openFromCommandCenter(/** @type {any} */ page) {
  await page.keyboard.press('Control+k');
  await page.keyboard.type('Beads');
  const item = page.getByText(/^Open Beads$/).first();
  await item.waitFor({ timeout: 15_000 });
  await arm(page, ROW);
  await item.click();
}

/** Does the server hold a disk snapshot of the fixture's project (server/beads/disk.ts)? */
const hasDiskSnapshot = (/** @type {string} */ dir) => fs.existsSync(cacheFileFor(fs.realpathSync(path.join(dir, '.beads'))));

/** Change one issue's priority with bd, the way a terminal next to the panel would. */
function editOutside(/** @type {string} */ dir) {
  const bd = (/** @type {string[]} */ args) => execFileSync('bd', ['-C', dir, ...args], { cwd: dir, env: BD_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const [issue] = JSON.parse(bd(['--readonly', '--json', 'show', EDIT_KEY]));
  bd(['update', EDIT_KEY, '--priority', String(((issue?.priority ?? 2) + 1) % 5), '-q']);
}

/** The page to the background and back: what the poll's foreground check reacts to (AppState on web). */
const backgroundAndBack = (/** @type {any} */ page) => page.evaluate(async () => {
  const set = (/** @type {string} */ v) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => v === 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  set('hidden');
  await new Promise((r) => setTimeout(r, 300));
  set('visible');
  // The 300 ms in the background are not the panel's: the clock starts at the return.
});

// ---------------------------------------------------------------------------
// One run

/** @typedef {{ ms: number, tree: number, treeKinds: string, treeMs: number, revision: number, other: number, bytes: number }} Scenario */

/** Run `act`, time it with `wait`, then let the RPCs settle and count them. */
function scenarioSet(/** @type {Awaited<ReturnType<typeof captureRpcs>>} */ rpc) {
  /** @type {Record<string, Scenario>} */
  const out = {};
  /** @type {Record<string, number>} */
  const sizes = {};
  const run = async (/** @type {string} */ name, /** @type {() => Promise<void>} */ act, /** @type {(t0: number) => Promise<number>} */ wait) => {
    await rpc.settle();
    const t0 = Date.now();
    await act();
    const ms = await wait(t0);
    await rpc.settle();
    const rpcs = rpc.since(t0);
    out[name] = { ms, ...summarize(rpcs) };
    for (const r of rpcs) {
      if (!r.answer) continue;
      const key = `${r.method} ${r.answer.kind}`;
      sizes[key] = Math.max(sizes[key] ?? 0, r.answer.bytes);
    }
    say(`${name}: ${ms} ms, ${JSON.stringify(out[name])}`);
  };
  return { out, sizes, run };
}

/**
 * a0: the cold open with no disk snapshot, alone (a fresh fixture). Leaves
 * the snapshot behind for the runs (it is written on the turn after the answer).
 * @param {import('./lib/paseo-web.mjs').Workspace} workspace
 */
async function primeRun(workspace) {
  await reloadPlugin();
  return withPanel({ workspace, now: null, open: false }, async ({ page }) => {
    const rpc = await captureRpcs(page);
    await installMarks(page);
    const s = scenarioSet(rpc);
    await s.run('a0 cold, no disk snapshot: bd list', () => openFromCommandCenter(page), () => msUntil(page));
    for (let i = 0; i < 50 && !hasDiskSnapshot(workspace.dir); i++) await sleep(100);
    return s.out['a0 cold, no disk snapshot: bd list'];
  });
}

/**
 * @param {import('./lib/paseo-web.mjs').Workspace} workspace
 * @returns {Promise<{ scenarios: Record<string, Scenario>, sizes: Record<string, number>, reloadMs: number, disk: boolean }>}
 */
async function oneRun(workspace) {
  const reloadMs = await reloadPlugin();
  say(`plugin reloaded in ${reloadMs} ms`);
  return withPanel({ workspace, now: null, open: false }, async ({ page }) => {
    const rpc = await captureRpcs(page);
    await installMarks(page);
    const { out: scenarios, sizes, run: scenario } = scenarioSet(rpc);
    const disk = hasDiskSnapshot(workspace.dir);

    await scenario('a cold: Open Beads after reload', () => openFromCommandCenter(page), () => msUntil(page));

    await scenario('b warm: close the tab, Open Beads', async () => {
      const close = page.locator(`${MAIN} [data-testid^="workspace-plugin-close-"]`).first();
      await page.locator(BEADS_TAB).first().hover();
      await close.click({ force: true });
      await page.locator('[data-testid="beads-panel"]').first().waitFor({ state: 'detached', timeout: 15_000 });
      await openFromCommandCenter(page);
    }, () => msUntil(page));

    await scenario('c duplicate: second tab from "+"', async () => {
      await markOldPanels(page);
      await page.locator(`${MAIN} [data-testid="workspace-new-tab-button"]`).click();
      const item = page.locator('[data-testid="workspace-new-tab-menu-plugin:beads:beads"]');
      await item.waitFor({ timeout: 15_000 });
      await arm(page, ROW);
      await item.click();
    }, () => msUntil(page));

    // Away to a Diff tab (not timed), then back to the first Beads tab.
    await page.locator(`${MAIN} [data-testid="workspace-new-tab-button"]`).click();
    await page.locator('[data-testid="workspace-new-tab-menu-diff"]').click();
    await page.waitForFunction((sel) => ![...document.querySelectorAll(sel)].some((e) => e.getClientRects().length > 0), ROW, { timeout: 15_000 });
    await page.evaluate(() => { for (const el of document.querySelectorAll('[data-bench-old]')) el.removeAttribute('data-bench-old'); });
    await scenario('d switch: another tab and back', async () => {
      await arm(page, ROW);
      await page.locator(BEADS_TAB).first().click();
    }, () => msUntil(page));

    await scenario('f charts: switch the view to Charts', async () => {
      await arm(page, '[data-testid^="beads-charts-body-"]');
      await page.locator('[data-testid="beads-view-switch"] [data-testid="beads-view-charts"]').filter({ visible: true }).first().click();
    }, () => msUntil(page));
    await page.locator('[data-testid="beads-view-switch"] [data-testid="beads-view-tree"]').filter({ visible: true }).first().click();
    await page.locator(ROW).filter({ visible: true }).first().waitFor({ timeout: 15_000 });

    // Not timed in the page: from the foreground event until the tree answer is in.
    let foreground = 0;
    await scenario('h delta: bd update outside, back to the foreground', async () => {
      editOutside(workspace.dir);
      await backgroundAndBack(page);
      foreground = Date.now();
    }, async (t0) => {
      const end = Date.now() + WAIT_MS;
      for (;;) {
        const tree = rpc.since(t0).find((r) => r.method === 'beads.tree' && r.answer);
        if (tree?.answer) return tree.answer.at - foreground;
        if (Date.now() > end) throw new Error('no tree answer after the outside edit');
        await sleep(50);
      }
    });

    let inPageReloadMs = 0;
    await scenario('r reload: plugin reload with the tab open', async () => {
      await markOldPanels(page);
      await arm(page, ROW, true);
      inPageReloadMs = await reloadPlugin();
    }, () => msUntil(page));
    // The reload itself is the CLI's and the daemon's; what is left is the plugin's.
    scenarios['r net: minus the reload itself'] = { ...scenarios['r reload: plugin reload with the tab open'] };
    scenarios['r net: minus the reload itself'].ms -= inPageReloadMs;

    return { scenarios, sizes, reloadMs, disk };
  });
}

// ---------------------------------------------------------------------------

const median = (/** @type {number[]} */ xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
};
const kb = (/** @type {number} */ n) => (n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : n >= 1e3 ? `${(n / 1e3).toFixed(1)} kB` : `${n} B`);

const t0 = Date.now();
let dir = opt('--dir');
let removeFixture = () => {};
if (!dir) {
  say(`building a ${N}-issue rich fixture…`);
  const fx = buildFixture({ mode: 'bd', many: N, rich: true, tag: 'bench-open' });
  dir = fx.dir;
  if (!KEEP) {
    removeFixture = fx.cleanup;
    process.once('exit', () => removeFixture()); // also after a signal (paseo-web exits on it)
  }
  say(`fixture: ${fx.rows.length} issues in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

const load = os.loadavg().map((x) => x.toFixed(2)).join(' ');
const commit = (() => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return '?'; } })();
/** @type {Awaited<ReturnType<typeof oneRun>>[]} */
const runs = [];
/** @type {Scenario | null} */
let prime = null;
try {
  await withWorkspace({ dir, title: 'beads bench' }, async (workspace) => {
    if (!hasDiskSnapshot(workspace.dir)) {
      say('no disk snapshot yet: a0 first');
      prime = await primeRun(workspace);
    }
    for (let i = 0; i < RUNS; i++) {
      say(`run ${i + 1}/${RUNS}`);
      runs.push(await oneRun(workspace));
    }
  });
} finally {
  await closeBrowser();
  removeFixture();
  removeFixture = () => {};
}

const names = Object.keys(runs[0].scenarios);
const row = (/** @type {string} */ name, /** @type {Scenario[]} */ of) => {
  const pick = (/** @type {'tree'|'treeMs'|'revision'|'other'|'bytes'} */ k) => median(of.map((s) => s[k]));
  console.log(`  ${name.padEnd(52)} ${String(median(of.map((s) => s.ms))).padStart(7)}  ${of.map((s) => s.ms).join(' / ').padEnd(20)} ${String(pick('tree')).padStart(4)} ${String(pick('treeMs') || '-').padStart(7)} ${String(pick('revision')).padStart(4)} ${String(pick('other')).padStart(6)}  ${kb(pick('bytes')).padStart(9)}   ${of.map((s) => s.treeKinds || '-').join(' | ')}`);
};
console.log(`\nbench:open on ${dir}`);
console.log(`commit ${commit}, ${RUNS} runs, medians; load ${load}; ${((Date.now() - t0) / 1000).toFixed(0)} s`);
console.log(`\n  ${'scenario'.padEnd(52)} ${'ms'.padStart(7)}  ${'runs (ms)'.padEnd(20)} tree tree ms  rev  other  bytes in   tree answers`);
if (prime) row('a0 cold, no disk snapshot: bd list (once)', [prime]);
for (const name of names) row(name, runs.map((r) => r.scenarios[name]));
console.log(`\n  disk snapshot there before a: ${runs.map((r) => (r.disk ? 'yes' : 'no')).join(' / ')}`);
console.log('\n  e answer sizes (largest seen, median over runs)');
const keys = [...new Set(runs.flatMap((r) => Object.keys(r.sizes)))].sort();
for (const k of keys) console.log(`    ${k.padEnd(40)} ${kb(median(runs.map((r) => r.sizes[k] ?? 0)))}`);
console.log(`\n  plugin reload (CLI until "running"): ${runs.map((r) => r.reloadMs).join(' / ')} ms`);
