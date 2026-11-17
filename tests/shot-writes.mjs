// @ts-check
/**
 * Screenshots of the writing side of the panel — status menu, edit / create
 * forms, comment box, export / sync badge, settings page — in the real Paseo
 * web app on the synthetic fixture, plus a scripted end-to-end pass that
 * writes through the UI and checks each write with `bd show --json` in the
 * fixture directory.
 *
 *   npm run shot:writes                  # every frame + the e2e pass
 *   npm run shot:writes -- --only edit   # frames whose name contains "edit"
 *   npm run shot:writes -- --e2e         # only the end-to-end pass
 *
 * Frames:
 *   preview-status-menu-<theme>-<locale>  the card's status menu open
 *   preview-edit-<theme>-<locale>         the edit form of FIXTURE.selected
 *   preview-edit-discard-en               closing it with unsaved changes asks first
 *   preview-create-<theme>-<locale>       New issue
 *   preview-sub-issue-dark-en             the card's +: a new issue under it
 *   preview-comment-draft-<theme>-<locale> a draft in the comment box (anonymous)
 *   preview-comment-named-en              …and with a name set in the settings
 *   preview-export-running-ru             Sync pressed: the badge while it runs
 *   preview-sync-done-en                  …and what the sync pulled in
 *   preview-export-stale-en               a failed export with "Export again"
 *   preview-jsonl-writes-dark-en          jsonl mode: nothing writable
 *   preview-settings-<theme>-<locale>     the plugin's page in Paseo's Settings
 *   preview-assignee-menu-en              45 assignees: the filter's list scrolls (and Escape closes it)
 *
 * The settings are the host's own (shared by every client), so the frames
 * that need a name set it through the settings page and put back what was
 * there before when they are done.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE } from './fixture/build.mjs';
import { closeBrowser, shot, withPanel, withWorkspace } from './lib/paseo-web.mjs';

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] ?? '' : '';
const e2eOnly = argv.includes('--e2e');
const want = (/** @type {string} */ name) => !e2eOnly && (!only || name.includes(only));

const WIDE = { width: 1440, height: 900 };
const NAME = 'Sam Okoye';
const SETTINGS_FILE_DIR = path.join(process.env.PASEO_HOME ?? path.join(process.env.HOME ?? '/root', '.paseo'), 'plugin-settings', 'beads');

const ready = /** @param {any} panel */ (panel) => panel.locator('[data-testid="beads-panel"]').waitFor({ timeout: 30_000 });
const tap = (/** @type {any} */ panel, /** @type {string} */ id) => panel.locator(`[data-testid="${id}"]`).first().click();
const sel = (/** @type {string} */ id) => `[data-testid="${id}"]`;

async function openFixture(/** @type {any} */ panel, /** @type {string | false} */ select = FIXTURE.selected) {
  await panel.locator(sel(`beads-row-${FIXTURE.expanded[0]}`)).waitFor({ timeout: 30_000 });
  for (const id of FIXTURE.expanded) {
    const twisty = panel.locator(sel(`beads-twisty-${id}`));
    if (await twisty.count()) await twisty.first().click();
  }
  if (select) {
    await panel.locator(sel(`beads-row-${select}`)).click();
    await panel.locator(sel('beads-card-title')).waitFor({ timeout: 30_000 });
  }
  await panel.page().mouse.move(0, 0);
  await panel.page().waitForTimeout(400);
}

/** The whole page, for frames that live outside the panel (the modal, the settings page). */
async function pageShot(/** @type {any} */ page, /** @type {string} */ name, /** @type {any} */ clipTo) {
  const file = path.join(path.dirname(new URL(import.meta.url).pathname), `${name}.png`);
  const box = clipTo ? await clipTo.boundingBox() : null;
  await page.screenshot({ path: file, ...(box ? { clip: box } : {}), animations: 'disabled', caret: 'hide' });
  console.error(`[shot-writes] saved ${name}.png`);
  return file;
}

/** The editor modal's dialog box (the host draws it; we know our content inside it). */
function dialogOf(/** @type {any} */ page) {
  return page.locator('[role="dialog"]').filter({ has: page.locator(sel('beads-editor')) }).last();
}

/** bd's own view of an issue in the fixture directory. */
function bdShow(/** @type {string} */ dir, /** @type {string} */ id) {
  const out = execFileSync('bd', ['show', id, '--json', '--readonly', '-C', dir], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  const v = JSON.parse(out);
  return Array.isArray(v) ? v[0] : v;
}

/** bd's comments of an issue in the fixture directory. */
function bdComments(/** @type {string} */ dir, /** @type {string} */ id) {
  const out = execFileSync('bd', ['comments', id, '--json', '--readonly', '-C', dir], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  });
  return JSON.parse(out || '[]') ?? [];
}

/** Remember the host's beads settings file(s) and restore them afterwards. */
function snapshotSettings() {
  /** @type {Map<string, Buffer>} */
  const saved = new Map();
  const existed = fs.existsSync(SETTINGS_FILE_DIR);
  if (existed) for (const f of fs.readdirSync(SETTINGS_FILE_DIR)) saved.set(f, fs.readFileSync(path.join(SETTINGS_FILE_DIR, f)));
  return { existed, saved };
}

/** Open the settings page from the panel's gear and set (or clear) the name there. */
async function setName(/** @type {any} */ page, /** @type {any} */ panel, /** @type {string} */ name) {
  await tap(panel, 'beads-settings');
  // The host renders the settings rows; our page is the one with this placeholder.
  const input = page.locator(sel('settings-detail-pane')).getByPlaceholder('you@example.com');
  await input.waitFor({ timeout: 20_000 });
  await input.fill(name);
  await page.waitForTimeout(1500);
  await page.goBack();
  await panel.locator(sel('beads-panel')).waitFor({ timeout: 20_000 });
}

const t0 = Date.now();
/** @type {string[]} */
const files = [];
const results = /** @type {string[]} */ ([]);
const settingsBefore = snapshotSettings();
try {
  await withWorkspace({ mode: 'bd' }, async (workspace) => {
    // ── status menu ──
    for (const [theme, locale] of /** @type {const} */ ([['dark', 'en'], ['light', 'ru']])) {
      const name = `preview-status-menu-${theme}-${locale}`;
      if (!want(name)) continue;
      await withPanel({ workspace, theme, locale, viewport: WIDE, ready }, async ({ page, panel }) => {
        await openFixture(panel, 'demo-b7');
        await tap(panel, 'beads-status');
        await panel.locator(sel('beads-status-menu')).waitFor();
        await page.mouse.move(0, 0);
        files.push(await shot(page, name, { panel }));
      });
    }
    // ── edit form ──
    for (const [theme, locale] of /** @type {const} */ ([['light', 'en'], ['dark', 'ru']])) {
      const name = `preview-edit-${theme}-${locale}`;
      if (!want(name)) continue;
      await withPanel({ workspace, theme, locale, viewport: WIDE, ready }, async ({ page, panel }) => {
        await openFixture(panel);
        await tap(panel, 'beads-card-edit');
        await page.locator(sel('beads-editor')).waitFor();
        await page.waitForTimeout(500);
        files.push(await pageShot(page, name, null));
      });
    }
    if (want('preview-edit-discard-en')) {
      await withPanel({ workspace, theme: 'dark', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
        await openFixture(panel);
        await tap(panel, 'beads-card-edit');
        await page.locator(sel('beads-ef-title')).fill('Manager group shows a check icon');
        await page.locator(sel('beads-ef-cancel')).click();
        await page.locator(sel('beads-ef-discard-q')).waitFor();
        await page.mouse.move(0, 0);
        files.push(await pageShot(page, 'preview-edit-discard-en', null));
      });
    }
    // ── create / sub-issue ──
    for (const [theme, locale] of /** @type {const} */ ([['dark', 'en'], ['light', 'ru']])) {
      const name = `preview-create-${theme}-${locale}`;
      if (!want(name)) continue;
      await withPanel({ workspace, theme, locale, viewport: WIDE, ready }, async ({ page, panel }) => {
        await openFixture(panel, false);
        await tap(panel, 'beads-new');
        await page.locator(sel('beads-editor')).waitFor();
        await page.locator(sel('beads-ef-title')).fill(locale === 'ru' ? 'Экспорт в CSV из таблицы бронирований' : 'Export bookings to CSV');
        await page.locator(sel('beads-ef-label-input')).click();
        await page.locator(sel('beads-ef-label-input-list')).waitFor();
        await page.waitForTimeout(300);
        files.push(await pageShot(page, name, null));
      });
    }
    if (want('preview-sub-issue-dark-en')) {
      await withPanel({ workspace, theme: 'dark', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
        await openFixture(panel, 'demo-b7');
        await tap(panel, 'beads-card-sub');
        await page.locator(sel('beads-editor')).waitFor();
        await page.locator(sel('beads-ef-priority')).click();
        await page.locator(sel('beads-ef-priority-menu')).waitFor();
        await page.mouse.move(0, 0);
        files.push(await pageShot(page, 'preview-sub-issue-dark-en', null));
      });
    }
    // ── comment box ──
    for (const [theme, locale] of /** @type {const} */ ([['light', 'ru'], ['dark', 'en']])) {
      const name = `preview-comment-draft-${theme}-${locale}`;
      if (!want(name)) continue;
      await withPanel({ workspace, theme, locale, viewport: WIDE, ready }, async ({ page, panel }) => {
        await openFixture(panel, 'demo-b7');
        await panel.locator(sel('beads-comment-input')).fill(locale === 'ru' ? 'Черновик переживает переход\nк другой карточке.' : 'A draft survives a trip\nto another card.');
        // away and back: the draft is still there
        await panel.locator(sel('beads-row-demo-c2')).click();
        await panel.locator(sel('beads-row-demo-b7')).click();
        await panel.locator(sel('beads-comment-box')).scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        files.push(await shot(page, name, { panel }));
      });
    }
    // ── export / sync ──
    if (want('preview-export-running-ru') || want('preview-sync-done-en')) {
      if (want('preview-export-running-ru')) {
        await withPanel({ workspace, theme: 'light', locale: 'ru', viewport: WIDE, ready }, async ({ page, panel }) => {
          await openFixture(panel, false);
          await tap(panel, 'beads-sync');
          await panel.locator(sel('beads-export-running')).waitFor({ timeout: 10_000 });
          await page.mouse.move(0, 0);
          files.push(await shot(page, 'preview-export-running-ru', { panel }));
        });
      }
      if (want('preview-sync-done-en')) {
        await withPanel({ workspace, theme: 'dark', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
          await openFixture(panel, false);
          await tap(panel, 'beads-sync');
          await panel.locator(sel('beads-export-done')).waitFor({ timeout: 30_000 });
          await page.mouse.move(0, 0);
          files.push(await shot(page, 'preview-sync-done-en', { panel }));
        });
      }
    }
    // ── settings page ──
    for (const [theme, locale] of /** @type {const} */ ([['dark', 'en'], ['light', 'ru']])) {
      const name = `preview-settings-${theme}-${locale}`;
      if (!want(name)) continue;
      await withPanel({ workspace, theme, locale, viewport: WIDE, ready }, async ({ page, panel }) => {
        await openFixture(panel, false);
        await tap(panel, 'beads-settings');
        const pane = page.locator(sel('settings-detail-pane'));
        await pane.getByText(locale === 'ru' ? 'Ваше имя' : 'Your name').waitFor({ timeout: 20_000 });
        await page.waitForTimeout(600);
        // The detail pane only: the settings sidebar names the real host.
        files.push(await pageShot(page, name, pane));
      });
    }
    // ── name set: comment box + assign to me ──
    if (want('preview-comment-named-en')) {
      await withPanel({ workspace, theme: 'dark', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
        await setName(page, panel, NAME);
        await openFixture(panel, 'demo-b7');
        await panel.locator(sel('beads-assign-me')).waitFor({ timeout: 10_000 });
        await panel.locator(sel('beads-comment-input')).fill('Signed with the name from the settings.');
        await panel.locator(sel('beads-comment-box')).scrollIntoViewIfNeeded();
        await page.mouse.move(0, 0);
        files.push(await shot(page, 'preview-comment-named-en', { panel }));
        await setName(page, panel, '');
      });
    }
  });

  // ── a failed export: point the export at a file it cannot write ──
  if (want('preview-export-stale-en')) {
    await withWorkspace({ mode: 'bd' }, async (workspace) => {
      await withPanel({ workspace, theme: 'dark', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
        await openFixture(panel);
        const jsonl = path.join(workspace.dir, '.beads', 'issues.jsonl');
        // A directory where the file should be: the export cannot replace it.
        fs.rmSync(jsonl, { force: true });
        fs.mkdirSync(path.join(jsonl, 'blocker'), { recursive: true });
        await tap(panel, 'beads-status');
        await tap(panel, 'beads-status-in_progress');
        await panel.locator(sel('beads-export-stale')).waitFor({ timeout: 40_000 });
        // The written card carries today's updated/started dates: show one the fixture dates.
        await panel.locator(sel('beads-row-demo-b7')).click();
        await panel.locator(sel('beads-card-title')).getByText(/Booking calendar/).waitFor({ timeout: 30_000 });
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
        files.push(await shot(page, 'preview-export-stale-en', { panel }));
        fs.rmSync(jsonl, { recursive: true, force: true });
      });
    });
  }

  if (want('preview-assignee-menu-en')) {
    // 45 more people, so the assignee list is longer than any screen (fixed ids and dates).
    await withWorkspace({ mode: 'bd', many: 45, people: true }, async (workspace) => {
      await withPanel({ workspace, theme: 'light', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
        await panel.locator(sel('beads-row-demo-a1')).waitFor({ timeout: 30_000 });
        await tap(panel, 'beads-filters');
        await tap(panel, 'beads-f-person');
        const menu = panel.locator(sel('beads-f-person-menu'));
        await menu.waitFor();
        const box = await menu.boundingBox();
        if (!box || box.height > 290) throw new Error(`assignee menu is ${box && box.height}px tall`);
        await menu.hover();
        await page.mouse.wheel(0, 300);
        await page.waitForTimeout(300);
        files.push(await shot(page, 'preview-assignee-menu-en', { panel }));
        await page.keyboard.press('Escape');
        await menu.waitFor({ state: 'detached', timeout: 3000 });
        results.push('PASS assignee menu: capped height, scrolls, Escape closes');
      });
    });
  }

  if (want('preview-jsonl-writes-dark-en')) {
    await withWorkspace({ mode: 'jsonl' }, async (workspace) => {
      await withPanel({ workspace, theme: 'dark', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
        await openFixture(panel, 'demo-b7');
        await panel.locator(sel('beads-status')).hover();
        await page.waitForTimeout(300);
        files.push(await shot(page, 'preview-jsonl-writes-dark-en', { panel }));
      });
    });
  }

  // ── end to end: write through the UI, read back with bd ──
  if (e2eOnly || !only) {
    await withWorkspace({ mode: 'bd' }, async (workspace) => {
      const dir = workspace.dir;
      await withPanel({ workspace, theme: 'dark', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
        await setName(page, panel, NAME);
        await openFixture(panel);
        const id = FIXTURE.selected;
        const check = (/** @type {string} */ what, /** @type {boolean} */ ok, /** @type {unknown} */ detail) => {
          results.push(`${ok ? 'PASS' : 'FAIL'} ${what}${ok ? '' : `: ${JSON.stringify(detail)}`}`);
          if (!ok) throw new Error(`e2e: ${what}: ${JSON.stringify(detail)}`);
        };
        // 1. status from the card's menu
        await tap(panel, 'beads-status');
        await tap(panel, 'beads-status-in_progress');
        await panel.locator(sel('beads-status')).getByText('in progress').waitFor({ timeout: 30_000 });
        check('status → in_progress', bdShow(dir, id).status === 'in_progress', bdShow(dir, id).status);
        await panel.locator(`${sel(`beads-row-${id}`)}`).getByText('in progress').waitFor({ timeout: 30_000 });
        check('tree row shows the new status', true, null);

        // 2. assign to me
        await tap(panel, 'beads-assign-me');
        await panel.locator(sel('beads-assign-me')).waitFor({ state: 'detached', timeout: 30_000 });
        check('assign to me', bdShow(dir, id).assignee === NAME, bdShow(dir, id).assignee);

        // 3. the edit form: a title, a label, the external ref
        await tap(panel, 'beads-card-edit');
        await page.locator(sel('beads-ef-title')).fill('Manager group shows a lock icon instead of controls');
        await page.locator(sel('beads-ef-label-input')).fill('e2e:edited');
        await page.locator(sel('beads-ef-label-add')).click();
        await page.locator(sel('beads-ef-label-x-sec:roles')).click();
        await page.locator(sel('beads-ef-save')).click();
        await page.locator(sel('beads-editor')).waitFor({ state: 'detached', timeout: 30_000 });
        const edited = bdShow(dir, id);
        check('edit: title', edited.title === 'Manager group shows a lock icon instead of controls', edited.title);
        check('edit: labels', (edited.labels ?? []).includes('e2e:edited') && !(edited.labels ?? []).includes('sec:roles'), edited.labels);
        check('edit: untouched description kept', typeof edited.description === 'string' && edited.description.length > 20, edited.description?.slice(0, 40));

        // 4. a sub-issue from the card's +
        await tap(panel, 'beads-card-sub');
        await page.locator(sel('beads-ef-title')).fill('E2E child created from the panel');
        await page.locator(sel('beads-ef-type')).click();
        await page.locator(sel('beads-ef-type-bug')).click();
        await page.locator(sel('beads-ef-description')).fill('Made by tests/shot-writes.mjs.');
        await page.locator(sel('beads-ef-save')).click();
        await page.locator(sel('beads-editor')).waitFor({ state: 'detached', timeout: 30_000 });
        await panel.locator(sel('beads-card-title')).getByText('E2E child created from the panel').waitFor({ timeout: 30_000 });
        const key = (await panel.locator(sel('beads-card-key')).innerText()).split(/\s/)[0].trim();
        const made = bdShow(dir, key);
        check('create: title/type/parent', made.title === 'E2E child created from the panel' && made.issue_type === 'bug' && (made.parent === id || (made.dependencies ?? []).some((/** @type {any} */ d) => (d.depends_on_id ?? d.id) === id)), { key, title: made.title, type: made.issue_type, parent: made.parent });

        // 5. a comment, signed with the settings' name, sent with Ctrl+Enter
        const box = panel.locator(sel('beads-comment-input'));
        await box.scrollIntoViewIfNeeded();
        await box.fill('E2E comment from the panel');
        await box.press('Control+Enter');
        await panel.getByText('E2E comment from the panel').first().waitFor({ timeout: 30_000 });
        await page.waitForTimeout(500);
        const comments = bdComments(dir, key);
        const c = comments.find((/** @type {any} */ x) => x.text === 'E2E comment from the panel');
        check('comment landed (bd comments --json)', Boolean(c), comments);
        check('comment author = settings name', c && c.author === NAME, c && c.author);
        // The box empties once the write (and the tree reload behind it) is done.
        for (let i = 0; i < 40 && (await box.inputValue()) !== ''; i++) await page.waitForTimeout(250);
        check('comment box cleared', (await box.inputValue()) === '', await box.inputValue());

        // 6. sync from the header
        await tap(panel, 'beads-sync');
        await panel.locator(sel('beads-export-done')).waitFor({ timeout: 30_000 });
        check('sync reports back', true, null);
        await setName(page, panel, '');
      });
    });
  }
} finally {
  await closeBrowser();
  // Put the host's settings back exactly as they were.
  const now = fs.existsSync(SETTINGS_FILE_DIR) ? fs.readdirSync(SETTINGS_FILE_DIR) : [];
  if (settingsBefore.existed) {
    for (const [f, buf] of settingsBefore.saved) fs.writeFileSync(path.join(SETTINGS_FILE_DIR, f), buf);
  } else if (now.length) {
    console.error(`[shot-writes] settings dir was created by the run: ${SETTINGS_FILE_DIR} (${now.join(', ')})`);
  }
}
console.log(`${files.length} screenshot(s) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const f of files) console.log(`  ${f}`);
for (const r of results) console.log(r);
