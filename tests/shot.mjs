// @ts-check
/**
 * Screenshots of the beads panel in the real Paseo web app, on the synthetic
 * fixture (tests/fixture/), never on a live project.
 *
 *   npm run shot                  # every frame below
 *   npm run shot -- --only tree   # frames whose name contains "tree"
 *
 * Frames:
 *   preview-tree-<theme>-<locale>  tree + the card of FIXTURE.selected, with
 *                                  FIXTURE.expanded open (bd mode)
 *   preview-links-dark-en          the card of an epic: children tree, comments
 *   preview-jsonl-dark-en          the same in the read-only jsonl mode
 *   preview-stale-en               a refresh failed after a good load (.beads removed)
 *   preview-refreshing-<locale>    rows held while newer ones load: "Refreshing…" in the title row
 *                                  (the page holds back its beads.tree request, so it stays on)
 *   preview-empty-<locale>         a workspace with no .beads at all
 *   preview-narrow-tree-en         a tab under 900 px: the tree alone
 *   preview-narrow-card-ru         …a picked issue: its card in the tree's place, "Tree" leads back
 *                                  (checked: the list comes back with its selection and scroll)
 *   preview-narrow-back-en         …a link followed from that card: "Back" leads through the chain,
 *                                  the X straight to the list (checked)
 *   preview-split-dark-en          two Beads tabs split side by side, a card in each: how two cards
 *                                  are read at once (Paseo's split, the second tab from "+")
 *   preview-filters-dark-en        the filter panel open, two chips on
 *   preview-labels-light-ru        the tag picker open over the panel
 *   preview-chips-light-en         filters applied: badge, removable chips
 *   preview-search-dark-en         a full-text query (server hits merged)
 *   preview-search-key-en          a whole issue key: that issue only
 *   preview-columns-light-en       the column panel, Assignee + Updated on
 *   preview-link-cols-dark-en      a card's linked-list column picker
 *   preview-splitter-dark-en       the card pane dragged wider
 *   preview-explorer-dark-en       the explorer panel (320 px) beside the open tab: the reader's
 *                                  issues in progress and ready, counts, search (fixture `mine`)
 *                                  (checked: opening it sends no beads.tree — the tab's cache is
 *                                  shared; a picked row opens its card in the tab)
 *   preview-explorer-light-ru      the explorer alone, light, Russian (it loads the tree itself)
 *   preview-explorer-narrow-en     the explorer at Paseo's minimum 240 px, a search on
 *   preview-explorer-noname-en     no reader's name in the settings: the way to set it
 *   preview-header-dark-en         the Beads button in the workspace header, its menu open
 *                                  (checked: the board item opens the tab on the board, the
 *                                  explorer item the explorer panel; a workspace without
 *                                  .beads gets no button)
 *   preview-header-compact-ru      a phone-sized window: the button in the header's
 *                                  "Workspace actions" sheet, no explorer item
 *
 * Writes tests/<frame>.png. Look at them before committing.
 * Needs the local Paseo daemon (127.0.0.1:6767) with the beads plugin loaded;
 * each fixture workspace is registered only for the run and removed afterwards.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE } from './fixture/build.mjs';
import { closeBrowser, openExplorer, resizeExplorer, setSettings, shot, withPanel, withWorkspace } from './lib/paseo-web.mjs';

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] ?? '' : '';
const want = (/** @type {string} */ name) => !only || name.includes(only);

/** Open FIXTURE.expanded and select FIXTURE.selected, the way a reader would. */
async function openFixture(/** @type {any} */ panel, /** @type {{ select?: boolean | string }} */ { select = true } = {}) {
  await panel.locator(`[data-testid="beads-row-${FIXTURE.expanded[0]}"]`).waitFor({ timeout: 30_000 });
  for (const id of FIXTURE.expanded) {
    const twisty = panel.locator(`[data-testid="beads-twisty-${id}"]`);
    if (await twisty.count()) await twisty.first().click();
  }
  if (select) {
    await panel.locator(`[data-testid="beads-row-${select === true ? FIXTURE.selected : select}"]`).click();
    await panel.locator('[data-testid="beads-card-title"]').waitFor({ timeout: 30_000 });
  }
  // Let the hover state of the last click go: move the pointer off the panel.
  await panel.page().mouse.move(0, 0);
  await panel.page().waitForTimeout(400);
}

const LAYOUT_FRAMES = [
  'preview-filters-dark-en', 'preview-labels-light-ru', 'preview-chips-light-en', 'preview-search-dark-en', 'preview-search-key-en',
  'preview-columns-light-en', 'preview-link-cols-dark-en', 'preview-splitter-dark-en',
];

/** The selected style (RN-web puts no aria-selected on a button): its background is not a plain row's. */
async function looksSelected(/** @type {any} */ row, /** @type {any} */ plain) {
  const bg = (/** @type {any} */ l) => l.evaluate((/** @type {any} */ e) => getComputedStyle(e).backgroundColor);
  return (await bg(row)) !== (await bg(plain));
}

/**
 * A narrow tab's list → card → back: "back to the list" shows the tree again
 * with the issue still selected, scrolled where it was (the list stays
 * mounted under the card). The window is made short so the list scrolls.
 */
async function narrowWayBack(/** @type {any} */ page, /** @type {any} */ panel) {
  const tree = panel.locator('[data-testid="beads-tree"]');
  const row = (/** @type {string} */ id) => panel.locator(`[data-testid="beads-row-${id}"]`);
  await panel.locator('[data-testid="beads-card-back-list"]').click();
  await tree.waitFor({ state: 'visible', timeout: 10_000 });
  await page.mouse.move(0, 0);
  assert.ok(await looksSelected(row(FIXTURE.selected), row(FIXTURE.expanded[0])), 'back to the list keeps the selection');
  await page.setViewportSize({ width: 820, height: 480 });
  await page.waitForTimeout(400);
  /** The list's scrolling box: the FlatList's node or the first scrollable one inside it. */
  const scrollTop = (/** @type {number | null} */ set) => tree.evaluate((/** @type {any} */ el, /** @type {number | null} */ to) => {
    const box = [el, ...el.querySelectorAll('*')].find((n) => n.scrollHeight > n.clientHeight + 4 && getComputedStyle(n).overflowY !== 'visible');
    if (!box) return -1;
    if (to != null) box.scrollTop = to;
    return box.scrollTop;
  }, set);
  const top = await scrollTop(10_000);
  assert.ok(top > 0, 'the list scrolls in a short window');
  await page.waitForTimeout(300);
  const last = panel.locator('[data-testid^="beads-row-"]').last();
  const id = (await last.getAttribute('data-testid')).replace('beads-row-', '');
  await last.click();
  await panel.locator('[data-testid="beads-card-title"]').waitFor({ timeout: 30_000 });
  assert.equal(await tree.isVisible(), false);
  await panel.locator('[data-testid="beads-card-back-list"]').click();
  await tree.waitFor({ state: 'visible', timeout: 10_000 });
  await page.waitForTimeout(300);
  assert.equal(await scrollTop(null), top, 'back to the list keeps its scroll');
  await page.mouse.move(0, 0);
  assert.ok(await looksSelected(row(id), row(FIXTURE.expanded[0])), 'the row picked last is still selected');
  console.log('  narrow: card in the list\'s place, back to the list keeps the selection and the scroll');
}

/** Click by test id inside the panel. */
const tap = (/** @type {any} */ panel, /** @type {string} */ id) => panel.locator(`[data-testid="${id}"]`).first().click();

/** Type into the quick search and wait for the server's answer. */
async function search(/** @type {any} */ panel, /** @type {string} */ q) {
  const box = panel.locator('[data-testid="beads-search"]');
  await box.click();
  await box.fill(q);
  await panel.page().waitForTimeout(300);
  await panel.locator('[data-testid="beads-searching"]').waitFor({ state: 'detached', timeout: 15_000 });
  await panel.page().mouse.move(0, 0);
  await panel.page().waitForTimeout(300);
}

/** The reference's own shots are 1360 wide; Paseo's tab strip takes a little more. */
const WIDE = { width: 1440, height: 900 };

const t0 = Date.now();
/** @type {string[]} */
const files = [];
const ready = /** @param {any} panel */ (panel) => panel.locator('[data-testid="beads-panel"]').waitFor({ timeout: 30_000 });
try {
  const bdFrames = ['dark', 'light'].flatMap((th) => ['en', 'ru'].map((l) => `preview-tree-${th}-${l}`))
    .concat('preview-links-dark-en', 'preview-refreshing-en', 'preview-refreshing-ru', 'preview-narrow-tree-en', 'preview-narrow-card-ru')
    .concat('preview-narrow-back-en', 'preview-split-dark-en')
    .concat(LAYOUT_FRAMES);
  if (bdFrames.some(want)) {
    await withWorkspace({ mode: 'bd' }, async (workspace) => {
      for (const theme of /** @type {const} */ (['dark', 'light'])) {
        for (const locale of /** @type {const} */ (['en', 'ru'])) {
          const name = `preview-tree-${theme}-${locale}`;
          if (!want(name)) continue;
          await withPanel({ workspace, theme, locale, viewport: WIDE, ready }, async ({ page, panel }) => {
            await openFixture(panel);
            files.push(await shot(page, name, { panel }));
          });
        }
      }
      if (want('preview-links-dark-en')) {
        await withPanel({ workspace, theme: 'dark', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
          await openFixture(panel, { select: 'demo-b7' });
          await panel.locator('[data-testid="beads-rel-children"]').scrollIntoViewIfNeeded();
          await page.waitForTimeout(300);
          files.push(await shot(page, 'preview-links-dark-en', { panel }));
        });
      }
      for (const [theme, locale] of /** @type {const} */ ([['dark', 'en'], ['light', 'ru']])) {
        const name = `preview-refreshing-${locale}`;
        if (!want(name)) continue;
        await withPanel({ workspace, theme, locale, viewport: WIDE, ready }, async ({ page, panel }) => {
          await openFixture(panel);
          // Swallow the page's next beads.tree requests: the refresh never
          // lands, so the mark stays up for the shot (the rows, the open
          // branches and the selection are what the reader keeps meanwhile).
          await page.evaluate(() => {
            const send = WebSocket.prototype.send;
            WebSocket.prototype.send = function (/** @type {any} */ data) {
              if (typeof data === 'string' && data.includes('"plugin.rpc.invoke.request"') && data.includes('"method":"beads.tree"')) return;
              return send.call(this, data);
            };
          });
          await tap(panel, 'beads-refresh');
          await panel.locator('[data-testid="beads-refreshing"]').waitFor({ timeout: 10_000 });
          await page.mouse.move(0, 0);
          await page.waitForTimeout(400);
          files.push(await shot(page, name, { panel }));
        });
      }
      /** @type {Record<string, [theme: 'dark' | 'light', locale: 'en' | 'ru', run: (panel: any, page: any) => Promise<void>]>} */
      const layout = {
        'preview-filters-dark-en': ['dark', 'en', async (panel) => {
          await openFixture(panel);
          await tap(panel, 'beads-filters');
          await tap(panel, 'beads-f-status-open');
          await tap(panel, 'beads-f-pri-1');
        }],
        'preview-labels-light-ru': ['light', 'ru', async (panel) => {
          await openFixture(panel);
          await tap(panel, 'beads-filters');
          await tap(panel, 'beads-f-labels');
          await tap(panel, 'beads-f-label-area:ui');
        }],
        'preview-chips-light-en': ['light', 'en', async (panel, page) => {
          await openFixture(panel);
          await tap(panel, 'beads-filters');
          await tap(panel, 'beads-f-ready-ready');
          await tap(panel, 'beads-f-type-bug');
          await tap(panel, 'beads-f-labels');
          await tap(panel, 'beads-f-label-area:ui');
          await page.mouse.click(5, 5); // a click elsewhere closes the tag list
          await tap(panel, 'beads-filters');
        }],
        'preview-search-dark-en': ['dark', 'en', async (panel) => {
          await openFixture(panel, { select: false });
          // In descriptions, not in titles: only the server's full-text answer finds these.
          await search(panel, 'sticky');
        }],
        'preview-search-key-en': ['dark', 'en', async (panel) => {
          await openFixture(panel, { select: false });
          await search(panel, 'demo-a1');
        }],
        'preview-columns-light-en': ['light', 'en', async (panel) => {
          await openFixture(panel);
          await tap(panel, 'beads-columns');
          await tap(panel, 'beads-col-assignee');
          await tap(panel, 'beads-col-updated');
        }],
        'preview-link-cols-dark-en': ['dark', 'en', async (panel, page) => {
          await openFixture(panel, { select: 'demo-b7' });
          await panel.locator('[data-testid="beads-rel-children"]').scrollIntoViewIfNeeded();
          await tap(panel, 'beads-relcols-children');
          await tap(panel, 'beads-relcol-assignee');
          await page.waitForTimeout(200);
        }],
        'preview-splitter-dark-en': ['dark', 'en', async (panel, page) => {
          await openFixture(panel);
          const handle = await panel.locator('[data-testid="beads-splitter"]').boundingBox();
          const x = handle.x + handle.width / 2;
          const y = handle.y + handle.height / 2;
          await page.mouse.move(x, y);
          await page.mouse.down();
          await page.mouse.move(x - 120, y, { steps: 6 });
          await page.mouse.move(x - 240, y, { steps: 6 });
          await page.mouse.up();
        }],
      };
      for (const name of LAYOUT_FRAMES) {
        if (!want(name)) continue;
        const [theme, locale, run] = layout[name];
        await withPanel({ workspace, theme, locale, viewport: WIDE, ready }, async ({ page, panel }) => {
          await run(panel, page);
          await page.mouse.move(0, 0);
          await page.waitForTimeout(400);
          files.push(await shot(page, name, { panel }));
        });
      }
      // Under NARROW_PX (the tab's own width) but still Paseo's desktop layout (its phone layout has no tab strip to drive).
      const viewport = { width: 820, height: 860 };
      if (want('preview-narrow-tree-en')) {
        await withPanel({ workspace, theme: 'dark', locale: 'en', viewport, ready }, async ({ page, panel }) => {
          await openFixture(panel, { select: false });
          files.push(await shot(page, 'preview-narrow-tree-en', { panel }));
        });
      }
      if (want('preview-narrow-card-ru')) {
        await withPanel({ workspace, theme: 'light', locale: 'ru', viewport, ready }, async ({ page, panel }) => {
          await openFixture(panel);
          const tree = panel.locator('[data-testid="beads-tree"]');
          assert.equal(await tree.isVisible(), false, 'narrow: the card takes the list\'s place');
          assert.equal(await panel.locator('[data-testid="beads-card-overlay"]').count(), 0, 'no overlay');
          files.push(await shot(page, 'preview-narrow-card-ru', { panel }));
          await narrowWayBack(page, panel);
        });
      }
      if (want('preview-narrow-back-en')) {
        await withPanel({ workspace, theme: 'dark', locale: 'en', viewport, ready }, async ({ page, panel }) => {
          await openFixture(panel);
          // FIXTURE.selected is blocked by demo-a1.2: follow that link from its card.
          await panel.locator('[data-testid="beads-relrow-demo-a1.2"]').click();
          await panel.locator('[data-testid="beads-card-title"]').filter({ hasText: 'Permission matrix' }).waitFor({ timeout: 30_000 });
          assert.equal(await panel.locator('[data-testid="beads-card-back"]').count(), 1, 'a followed link gives "Back"');
          assert.equal(await panel.locator('[data-testid="beads-card-back-list"]').count(), 0, '"Back" stands in for "Tree"');
          await page.mouse.move(0, 0);
          await page.waitForTimeout(400);
          files.push(await shot(page, 'preview-narrow-back-en', { panel }));
          await panel.locator('[data-testid="beads-card-back"]').click();
          await panel.locator('[data-testid="beads-card-title"]').filter({ hasText: 'Manager group' }).waitFor({ timeout: 30_000 });
          assert.equal(await panel.locator('[data-testid="beads-card-back-list"]').count(), 1, 'at the chain\'s start "Tree" is back');
          await panel.locator('[data-testid="beads-relrow-demo-a1.2"]').click();
          await panel.locator('[data-testid="beads-card-title"]').filter({ hasText: 'Permission matrix' }).waitFor({ timeout: 30_000 });
          await panel.locator('[data-testid="beads-card-close"]').click();
          await panel.locator('[data-testid="beads-tree"]').waitFor({ state: 'visible', timeout: 10_000 });
          console.log('  narrow: a followed link gives "Back" through the chain; the X goes straight to the list');
        });
      }
      if (want('preview-split-dark-en')) {
        await withPanel({ workspace, theme: 'dark', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
          // Paseo's own split: the pane menu's "Split pane right", then the new pane's Beads item.
          await page.locator('[data-testid="workspace-pane-main"] [data-testid="workspace-split-pane-menu"]').click();
          await page.locator('[data-testid="workspace-split-pane-right"]').click();
          const right = page.locator('[data-testid^="workspace-pane-pane_"]').first();
          await right.locator('[data-testid="workspace-new-tab-plugin:beads:beads"]').click();
          const second = right.locator('[data-testid="beads-panel"]');
          await second.waitFor({ timeout: 30_000 });
          await openFixture(panel);
          await openFixture(second, { select: 'demo-a1.2' });
          for (const p of [panel, second]) assert.equal(await p.locator('[data-testid="beads-tree"]').isVisible(), false, 'each split half is a narrow tab');
          const boxes = [await page.locator('[data-testid="workspace-pane-main"]').boundingBox(), await right.boundingBox()];
          const x = Math.min(...boxes.map((b) => b.x));
          const y = Math.min(...boxes.map((b) => b.y));
          const clip = { x, y, width: Math.max(...boxes.map((b) => b.x + b.width)) - x, height: Math.max(...boxes.map((b) => b.y + b.height)) - y };
          files.push(await shot(page, 'preview-split-dark-en', { clip }));
        });
      }
    });
  }
  if (want('preview-jsonl-dark-en') || want('preview-stale-en')) {
    await withWorkspace({ mode: 'jsonl' }, async (workspace) => {
      if (want('preview-jsonl-dark-en')) {
        await withPanel({ workspace, theme: 'dark', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
          await openFixture(panel);
          files.push(await shot(page, 'preview-jsonl-dark-en', { panel }));
        });
      }
      if (want('preview-stale-en')) {
        // A refresh that fails after a good load: the rows stay, the strip says so.
        await withPanel({ workspace, theme: 'light', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
          await openFixture(panel, { select: false });
          fs.rmSync(path.join(workspace.dir, '.beads'), { recursive: true, force: true });
          await panel.locator('[data-testid="beads-refresh"]').click();
          await panel.locator('[data-testid="beads-stalebar"]').waitFor({ timeout: 30_000 });
          await page.mouse.move(0, 0);
          files.push(await shot(page, 'preview-stale-en', { panel }));
        });
      }
    });
  }
  const explorerFrames = ['preview-explorer-dark-en', 'preview-explorer-light-ru', 'preview-explorer-narrow-en', 'preview-explorer-noname-en'];
  if (explorerFrames.some(want)) {
    await withWorkspace({ mode: 'bd', mine: true }, async (workspace) => {
      /** The explorer's first rows are in and the pointer is off them. */
      const settled = async (/** @type {any} */ page, /** @type {any} */ ex) => {
        await ex.locator('[data-testid^="beads-explorer-row-"]').first().waitFor({ timeout: 30_000 });
        await page.mouse.move(0, 0);
        await page.waitForTimeout(400);
      };
      try {
        setSettings({ currentUser: FIXTURE.reader });
        if (want('preview-explorer-dark-en')) {
          await withPanel({ workspace, theme: 'dark', locale: 'en', ready }, async ({ page }) => {
            await page.locator('[data-testid="beads-row-demo-a1"]').waitFor({ timeout: 30_000 });
            // Count what the page asks the daemon from here on.
            await page.evaluate(() => {
              const w = /** @type {any} */ (window);
              w.__beadsRpc = [];
              const send = WebSocket.prototype.send;
              WebSocket.prototype.send = function (/** @type {any} */ data) {
                const m = typeof data === 'string' && data.includes('"plugin.rpc.invoke.request"') ? /"method":"(beads\.[a-zA-Z]+)"/.exec(data) : null;
                if (m) w.__beadsRpc.push(m[1]);
                return send.call(this, data);
              };
            });
            const rpcs = () => page.evaluate(() => /** @type {any} */ (window).__beadsRpc.splice(0));
            const ex = await openExplorer(page);
            await settled(page, ex);
            await page.waitForTimeout(1000);
            const onOpen = await rpcs();
            assert.ok(!onOpen.includes('beads.tree'), `opening the explorer beside a loaded tab sent ${JSON.stringify(onOpen)}`);
            console.log(`  explorer: opened beside the tab with RPCs ${JSON.stringify(onOpen)} (no beads.tree)`);
            files.push(await shot(page, 'preview-explorer-dark-en', { panel: ex }));
            await ex.locator('[data-testid="beads-explorer-row-demo-b7.1"]').click();
            const title = page.locator('[data-testid="workspace-pane-main"] [data-testid="beads-card-title"]');
            await title.filter({ hasText: 'Drag layer keeps the pointer offset' }).waitFor({ timeout: 15_000 });
            console.log(`  explorer: a picked row opened its card in the tab (RPCs ${JSON.stringify(await rpcs())})`);
          });
        }
        if (want('preview-explorer-light-ru')) {
          await withPanel({ workspace, theme: 'light', locale: 'ru', open: false }, async ({ page }) => {
            const ex = await openExplorer(page);
            await settled(page, ex);
            files.push(await shot(page, 'preview-explorer-light-ru', { panel: ex }));
          });
        }
        if (want('preview-explorer-narrow-en')) {
          await withPanel({ workspace, theme: 'dark', locale: 'en', open: false }, async ({ page }) => {
            const ex = await openExplorer(page);
            await settled(page, ex);
            assert.equal(await resizeExplorer(page, 240), 240);
            await ex.locator('[data-testid="beads-explorer-search"]').fill('perm');
            await page.locator('[data-testid="beads-explorer-row-demo-b7.1"]').waitFor({ state: 'detached', timeout: 10_000 });
            await page.waitForTimeout(600);
            files.push(await shot(page, 'preview-explorer-narrow-en', { panel: ex }));
          });
        }
        if (want('preview-explorer-noname-en')) {
          setSettings();
          await withPanel({ workspace, theme: 'dark', locale: 'en', open: false }, async ({ page }) => {
            const ex = await openExplorer(page);
            await ex.locator('[data-testid="beads-explorer-empty-noname"]').waitFor({ timeout: 30_000 });
            await page.mouse.move(0, 0);
            files.push(await shot(page, 'preview-explorer-noname-en', { panel: ex }));
            await ex.locator('[data-testid="beads-explorer-settings"]').click();
            await page.locator('[data-testid="beads-settings-name"]').waitFor({ timeout: 15_000 });
            console.log('  explorer: "Open settings" leads to the plugin\'s settings page');
          });
        }
      } finally {
        setSettings();
      }
    });
  }
  if (want('preview-header-dark-en') || want('preview-header-compact-ru')) {
    await withWorkspace({ mode: 'bd' }, async (workspace) => {
      // Our button, not the "Beads" item of an empty tab: it is the one with the menu chevron.
      const button = (/** @type {any} */ page) => page.locator('button[aria-label="Beads"]:has([data-testid="plugin-button-chevron"])');
      if (want('preview-header-dark-en')) {
        await withWorkspace({ variant: 'bare' }, async (bare) => {
          await withPanel({ workspace, theme: 'dark', locale: 'en', open: false }, async ({ page }) => {
            await button(page).waitFor({ timeout: 30_000 });
            await button(page).click();
            const menu = page.getByText('Open Beads in the explorer', { exact: true });
            await menu.waitFor({ timeout: 10_000 });
            await page.mouse.move(0, 400);
            await page.waitForTimeout(400);
            const b = /** @type {any} */ (await button(page).boundingBox());
            const m = /** @type {any} */ (await menu.boundingBox());
            const width = page.viewportSize().width;
            const x = Math.max(0, Math.min(b.x, m.x) - 240);
            files.push(await shot(page, 'preview-header-dark-en', { clip: { x, y: 0, width: width - x, height: m.y + m.height + 24 } }));
            await page.getByText('Open Beads board', { exact: true }).click();
            const main = page.locator('[data-testid="workspace-pane-main"]');
            await main.locator('[data-testid^="beads-lane-"]').first().waitFor({ timeout: 30_000 });
            console.log('  header: "Open Beads board" opened the tab on the board');
            await button(page).click();
            await page.getByText('Open Beads in the explorer', { exact: true }).click();
            await page.locator('[data-testid="workspace-explorer-sidebar"] [data-testid="beads-explorer"]').waitFor({ timeout: 30_000 });
            console.log('  header: "Open Beads in the explorer" opened the explorer panel');
            // The same page, now on a workspace with no .beads: the set is read, no button there.
            await page.evaluate((/** @type {string} */ u) => {
              history.pushState({}, '', u);
              dispatchEvent(new PopStateEvent('popstate'));
            }, `/h/${bare.serverId}/workspace/${bare.workspaceId}`);
            await page.getByText(bare.name).first().waitFor({ timeout: 30_000 });
            await page.waitForTimeout(1500);
            assert.equal(await button(page).count(), 0, 'a workspace without .beads got a Beads button');
            console.log('  header: no button on a workspace without .beads');
          });
        });
      }
      if (want('preview-header-compact-ru')) {
        await withPanel({ workspace, theme: 'light', locale: 'ru', open: false }, async ({ page }) => {
          // Phone-sized once the workspace is up (withPanel waits for the wide layout's tab row).
          // Compact: the host moves plugin buttons into the header's "Workspace actions" sheet.
          await page.setViewportSize({ width: 420, height: 800 });
          await page.waitForTimeout(2500);
          await page.locator('[data-testid="workspace-header-menu-trigger"]').first().click();
          await page.locator('[data-testid="workspace-header-menu-content"]').getByText('Beads', { exact: true }).click();
          const back = page.locator('[data-testid="menu-sheet-back"]');
          await back.waitFor({ timeout: 10_000 });
          const board = page.getByText('Открыть доску Beads', { exact: true });
          await board.waitFor({ timeout: 10_000 });
          assert.equal(await page.getByText('Открыть Beads в боковой панели', { exact: true }).count(), 0, 'the explorer item shows without an explorer');
          await page.waitForTimeout(600);
          // The sheet only (the header above it names the host), down to its last item. Paseo
          // leaves the sheet at one of two heights (that of the level before, or fitted to
          // these two items); fitted, its last item ends 19 px above the window's bottom edge.
          // A bottom margin that fits both keeps the crop the same either way.
          const top = /** @type {any} */ (await back.boundingBox()).y - 24;
          const last = /** @type {any} */ (await board.boundingBox());
          const { width } = page.viewportSize();
          files.push(await shot(page, 'preview-header-compact-ru', { clip: { x: 0, y: top, width, height: last.y + last.height + 16 - top } }));
        });
      }
    });
  }
  if (want('preview-empty-en') || want('preview-empty-ru')) {
    await withWorkspace({ variant: 'bare' }, async (workspace) => {
      for (const [theme, locale] of /** @type {const} */ ([['dark', 'en'], ['light', 'ru']])) {
        if (!want(`preview-empty-${locale}`)) continue;
        await withPanel({ workspace, theme, locale, ready }, async ({ page, panel }) => {
          await panel.locator('[data-testid="beads-empty-failure"]').waitFor({ timeout: 30_000 });
          files.push(await shot(page, `preview-empty-${locale}`, { panel }));
        });
      }
    });
  }
} finally {
  await closeBrowser();
}
console.log(`${files.length} screenshot(s) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const f of files) console.log(`  ${f}`);
