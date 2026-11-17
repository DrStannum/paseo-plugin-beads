// @ts-check
/**
 * Drive the real Paseo web app against the live local daemon and screenshot
 * the beads panel on a synthetic fixture project.
 *
 * How it works (see also the paseo SDK notes, "visual testing"):
 * - The daemon on 127.0.0.1:6767 does not serve its web UI, but the bundle ships
 *   on disk. Playwright answers every http://127.0.0.1:6767/* request from that
 *   bundle (except /api/*, which goes to the daemon), so the page has the
 *   daemon's own origin and its WebSocket passes the origin check.
 * - The fixture (tests/fixture/build.mjs) is registered as a Paseo project and
 *   a background workspace only for the duration of the run, and both are
 *   deleted afterwards, also on SIGINT/SIGTERM. `paseo project delete` removes
 *   the registration and its workspaces, never files; the fixture directory is
 *   removed by the builder, which only ever deletes its own directories.
 *
 * The browser is a live client of the shared daemon: this module only opens
 * the command center and our panel. It never clicks in the sidebar and never
 * creates agents. Screenshots are cropped to the panel, so the sidebar (which
 * lists the user's real projects) never ends up in a PNG.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
// @ts-ignore — global install, no types in this project
import { chromium } from '/usr/local/lib/node_modules/playwright/index.mjs';
import { SETTINGS_DEFAULT } from '../../shared/settings.ts';
import { TEAM_NOW, buildFixture } from '../fixture/build.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const TESTS_DIR = path.join(here, '..');

export const DAEMON = '127.0.0.1:6767';

/** The page clock of every frame unless told otherwise: the team fixture's own "now". */
export const HELD_NOW = TEAM_NOW;
const ORIGIN = `http://${DAEMON}`;
export const DIST = '/usr/local/lib/node_modules/@getpaseo/cli/node_modules/@getpaseo/server/dist/server/web-ui';

const TYPES = /** @type {Record<string, string>} */ ({
  '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.map': 'application/json',
});

/** The command-center item of our panel, per app language. */
const OPEN_TITLES = /** @type {Record<string, string>} */ ({ en: 'Open Beads', ru: 'Открыть Beads' });

const log = (/** @type {string} */ msg) => { if (process.env.PASEO_WEB_QUIET !== '1') console.error(`[paseo-web] ${msg}`); };

// ---------------------------------------------------------------------------
// Cleanup on exit: whatever was registered gets undone even on Ctrl+C.

/** @type {Set<() => void>} */
const pending = new Set();
let signalsHooked = false;

function hookSignals() {
  if (signalsHooked) return;
  signalsHooked = true;
  for (const sig of /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP'])) {
    process.once(sig, () => {
      log(`${sig}: cleaning up`);
      for (const fn of [...pending].reverse()) { try { fn(); } catch (e) { log(`cleanup failed: ${e}`); } }
      process.exit(130);
    });
  }
}

/** Run fn as a cleanup now, and make sure it runs on a signal until then. */
function deferCleanup(/** @type {() => void} */ fn) {
  hookSignals();
  let done = false;
  const once = () => { if (!done) { done = true; pending.delete(once); fn(); } };
  pending.add(once);
  return once;
}

// ---------------------------------------------------------------------------
// The plugin's host settings, pinned for the run
//
// The poll interval shows in every frame's header and the reader's name on
// the settings page, and both live in the host's settings file, shared with
// the user's real panels. For the run the file holds the defaults; after it,
// the exact previous bytes come back (or the file goes, if there was none).
// The daemon reads the file on every settings RPC and every page of a run is
// opened after the pin, so no client holds a stale copy. Only this plugin's
// own file is touched. A copy of the original sits in the temp directory
// until the restore, so a run killed with SIGKILL is undone by the next one.

const SETTINGS_DIR = path.join(process.env.PASEO_HOME ?? path.join(process.env.HOME ?? '/root', '.paseo'), 'plugin-settings', 'beads');
export const SETTINGS_FILE = path.join(SETTINGS_DIR, 'beads.json');
/** What the frames are drawn with: the plugin's defaults, in the daemon's file format. */
const PINNED_SETTINGS = JSON.stringify({ version: 1, values: SETTINGS_DEFAULT });
const SETTINGS_BACKUP = path.join(process.env.TMPDIR ?? '/tmp', 'paseo-beads-preview-settings.backup.json');

let settingsPinned = false;

/** Pin the beads settings file to the defaults until this process exits. Idempotent. */
export function pinSettings() {
  if (settingsPinned) return;
  settingsPinned = true;
  /** @type {{ existed: boolean, dirExisted: boolean, mode: number, b64: string }} */
  let saved;
  if (fs.existsSync(SETTINGS_BACKUP)) {
    // A run before this one died before restoring: its copy is the original.
    saved = JSON.parse(fs.readFileSync(SETTINGS_BACKUP, 'utf8'));
    log('restoring the settings a killed run left pinned');
  } else {
    const existed = fs.existsSync(SETTINGS_FILE);
    saved = {
      existed,
      dirExisted: fs.existsSync(SETTINGS_DIR),
      mode: existed ? fs.statSync(SETTINGS_FILE).mode & 0o777 : 0o600,
      b64: existed ? fs.readFileSync(SETTINGS_FILE).toString('base64') : '',
    };
    fs.writeFileSync(SETTINGS_BACKUP, JSON.stringify(saved), { mode: 0o600 });
  }
  const restore = () => {
    if (saved.existed) {
      fs.writeFileSync(SETTINGS_FILE, Buffer.from(saved.b64, 'base64'), { mode: saved.mode });
      fs.chmodSync(SETTINGS_FILE, saved.mode);
    } else {
      fs.rmSync(SETTINGS_FILE, { force: true });
      if (!saved.dirExisted) { try { fs.rmdirSync(SETTINGS_DIR); } catch { /* not empty or gone */ } }
    }
    fs.rmSync(SETTINGS_BACKUP, { force: true });
  };
  const undo = deferCleanup(restore);
  process.once('exit', undo);
  fs.mkdirSync(SETTINGS_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SETTINGS_FILE, PINNED_SETTINGS, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Paseo registration

/** @param {string[]} args */
function paseoJson(args) {
  const out = execFileSync('paseo', [...args, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 });
  return JSON.parse(out);
}

/** Delete any Paseo project still registered at exactly this path (a crashed run). */
function dropStaleProjects(/** @type {string} */ dir) {
  /** @type {any[]} */
  const projects = paseoJson(['project', 'ls']);
  for (const p of projects) {
    if (p.path === dir) {
      log(`removing stale project ${p.projectId} at ${dir}`);
      paseoJson(['project', 'delete', p.projectId]);
    }
  }
}

/**
 * @typedef {{ mode?: 'bd' | 'jsonl', team?: boolean, variant?: 'main' | 'other' | 'bare', many?: number, rich?: boolean, people?: boolean, tag?: string }} FixtureOptions
 * @typedef {{ dir: string, name: string, projectId: string, workspaceId: string, serverId: string, fixture: ReturnType<typeof buildFixture> }} Workspace
 */

/**
 * Build a fixture, register it in Paseo as a project + background workspace,
 * run fn, then unregister and delete it.
 *
 * @template T
 * @param {FixtureOptions & { title?: string }} opts
 * @param {(ws: Workspace) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withWorkspace(opts, fn) {
  const t0 = Date.now();
  pinSettings();
  const fixture = buildFixture(opts);
  const removeDir = deferCleanup(() => fixture.cleanup());
  /** @type {string | null} */
  let projectId = null;
  const unregister = deferCleanup(() => {
    if (projectId) {
      try { paseoJson(['project', 'delete', projectId]); } catch (e) { log(`project delete ${projectId} failed: ${e}`); }
    }
  });
  try {
    dropStaleProjects(fixture.dir);
    projectId = /** @type {string} */ (paseoJson(['project', 'create', fixture.dir]).projectId);
    const ws = paseoJson([
      'workspace', 'create', '--isolation', 'local', '--path', fixture.dir, '--project', projectId,
      '--background', '--title', opts.title ?? 'beads fixture',
    ]);
    const status = await (await fetch(`${ORIGIN}/api/status`)).json();
    log(`fixture ${fixture.mode}${opts.team ? '+team' : ''} at ${fixture.dir}: ${projectId}/${ws.workspaceId} (${Date.now() - t0} ms)`);
    return await fn({ dir: fixture.dir, name: fixture.name, projectId, workspaceId: ws.workspaceId, serverId: status.serverId, fixture });
  } finally {
    unregister();
    removeDir();
  }
}

// ---------------------------------------------------------------------------
// Browser

/** @type {Promise<any> | null} */
let browserPromise = null;

/** One shared Chromium per process; closed by closeBrowser(). */
function browser() {
  browserPromise ??= chromium.launch();
  return browserPromise;
}

export async function closeBrowser() {
  if (!browserPromise) return;
  const b = await browserPromise;
  browserPromise = null;
  await b.close();
}

/** Serve the bundled web UI as if the daemon did. */
async function routeWebUi(/** @type {any} */ page) {
  const inject = `<script>window.__PASEO_INITIAL_DAEMON_CONNECTION__=${JSON.stringify({ listen: DAEMON, useTls: false, label: 'vm' })}</script></head>`;
  await page.route(`${ORIGIN}/**`, async (/** @type {any} */ route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) return route.continue();
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
    let body = fs.readFileSync(file);
    if (file.endsWith('index.html')) body = Buffer.from(body.toString().replace('</head>', inject));
    await route.fulfill({ status: 200, body, contentType: TYPES[path.extname(file)] ?? 'application/octet-stream' });
  });
}

/** Poll until the element's text has not changed for `quietMs`. */
async function waitTextStable(/** @type {any} */ locator, quietMs = 600, timeoutMs = 15_000) {
  const end = Date.now() + timeoutMs;
  let last = null;
  let since = Date.now();
  while (Date.now() < end) {
    const text = await locator.innerText().catch(() => null);
    if (text !== last) { last = text; since = Date.now(); }
    else if (text && Date.now() - since >= quietMs) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * @typedef {{
 *   fixture?: FixtureOptions & { title?: string },
 *   workspace?: Workspace,
 *   theme?: 'light' | 'dark',
 *   locale?: 'en' | 'ru',
 *   viewport?: { width: number, height: number },
 *   now?: string | null,
 *   sidebar?: boolean,
 *   ready?: string | RegExp | ((panel: any) => Promise<void>),
 * }} PanelOptions
 * @typedef {{ page: any, panel: any, workspaceId: string, dir: string, workspace: Workspace, locale: string, theme: string }} PanelContext
 */

/**
 * Open the beads panel of a fixture workspace in Paseo web and run fn.
 *
 * Pass `workspace` (from withWorkspace) to reuse one registration for several
 * shots; otherwise `fixture` options build and register one just for this call.
 * `now` holds the page clock (Date) at that instant; by default HELD_NOW, so
 * dates read the same on every run (the fixture's dates are absolute) — the
 * dashboards need exactly that instant. `now: null` leaves the real clock. `sidebar: false` (the default) collapses Paseo's left sidebar so
 * the panel gets the whole width; shots are cropped to the panel either way.
 *
 * @template T
 * @param {PanelOptions} opts
 * @param {(ctx: PanelContext) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withPanel(opts, fn) {
  if (!opts.workspace) return withWorkspace(opts.fixture ?? {}, (workspace) => withPanel({ ...opts, workspace }, fn));
  const { workspace, theme = 'dark', locale = 'en', viewport = { width: 1280, height: 800 }, now = HELD_NOW, sidebar = false, ready } = opts;
  const t0 = Date.now();
  const context = await (await browser()).newContext({ viewport, colorScheme: theme, locale: locale === 'ru' ? 'ru-RU' : 'en-US', timezoneId: 'UTC' });
  try {
    const page = await context.newPage();
    page.on('pageerror', (/** @type {Error} */ e) => log(`page error: ${String(e.message).slice(0, 200)}`));
    // Paseo keeps theme and language in this key (AsyncStorage = localStorage on web).
    await page.addInitScript((/** @type {string} */ settings) => {
      localStorage.setItem('@paseo:app-settings', settings);
    }, JSON.stringify({ theme, language: locale }));
    if (now) await page.clock.setFixedTime(new Date(now));
    await routeWebUi(page);

    // A deep link straight to the workspace is redirected to /open-project
    // while the app boots, so boot on "/" and navigate client-side.
    await page.goto(`${ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    // Attached, not visible: on a phone-sized viewport the sidebar is a hidden drawer.
    await page.locator('[data-testid="sidebar-global-new-workspace"]').waitFor({ state: 'attached', timeout: 90_000 });
    const booted = Date.now() - t0;
    await page.evaluate((/** @type {string} */ u) => {
      history.pushState({}, '', u);
      dispatchEvent(new PopStateEvent('popstate'));
    }, `/h/${workspace.serverId}/workspace/${workspace.workspaceId}`);
    await page.locator('[data-testid="workspace-pane-main"] [data-testid="workspace-tabs-row"]').waitFor({ timeout: 30_000 });
    if (!sidebar && await page.locator('[data-testid="sidebar-global-new-workspace"]').isVisible()) {
      await page.keyboard.press('Control+Period'); // "toggle left sidebar" on non-mac
      await page.locator('[data-testid="sidebar-global-new-workspace"]').waitFor({ state: 'hidden', timeout: 5_000 })
        .catch(() => log('sidebar did not collapse; the crop still excludes it'));
    }

    // Our command-center item; its title follows the app language.
    await page.keyboard.press('Control+k');
    await page.keyboard.type('Beads');
    const titles = [OPEN_TITLES[locale], 'Open Beads'].filter(Boolean);
    const item = page.getByText(new RegExp(`^(${titles.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`)).first();
    await item.waitFor({ timeout: 15_000 });
    await item.click();

    await page.locator('[data-testid^="workspace-tab-plugin_workspace"][data-testid*="beads"]').waitFor({ timeout: 15_000 });
    // The pane is the tabs row plus the content; the panel is the content.
    const panel = page.locator('[data-testid="workspace-pane-main"] > div').nth(1);
    await panel.waitFor({ timeout: 15_000 });
    if (typeof ready === 'function') await ready(panel);
    else if (ready) await panel.getByText(ready).first().waitFor({ timeout: 30_000 });
    await waitTextStable(panel);
    log(`panel ${theme}/${locale} ready in ${Date.now() - t0} ms (app boot ${booted} ms)`);
    return await fn({ page, panel, workspaceId: workspace.workspaceId, dir: workspace.dir, workspace, locale, theme });
  } finally {
    await context.close();
  }
}

/**
 * Save tests/<name>.png cropped to the plugin panel (no Paseo chrome, no
 * sidebar). Returns the file path.
 *
 * @param {any} page
 * @param {string} name file name without extension
 * @param {{ panel?: any, dir?: string, fullPage?: boolean }} [opts]
 */
export async function shot(page, name, opts = {}) {
  const panel = opts.panel ?? page.locator('[data-testid="workspace-pane-main"] > div').nth(1);
  const file = path.join(opts.dir ?? TESTS_DIR, `${name}.png`);
  const box = await panel.boundingBox();
  if (!box) throw new Error('beads panel is not on screen');
  await page.screenshot({ path: file, clip: box, animations: 'disabled', caret: 'hide' });
  log(`saved ${path.relative(process.cwd(), file)}`);
  return file;
}
