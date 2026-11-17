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
 *   preview-empty-<locale>         a workspace with no .beads at all
 *   preview-narrow-tree-en         a pane under 900 px: the tree alone
 *   preview-narrow-card-ru         …and the card as a full overlay
 *   preview-filters-dark-en        the filter panel open, two chips on
 *   preview-labels-light-ru        the tag picker open over the panel
 *   preview-chips-light-en         filters applied: badge, removable chips
 *   preview-search-dark-en         a full-text query (server hits merged)
 *   preview-search-key-en          a whole issue key: that issue only
 *   preview-columns-light-en       the column panel, Assignee + Updated on
 *   preview-link-cols-dark-en      a card's linked-list column picker
 *   preview-focus-dark-en          two-card mode: pinned left, a link right
 *   preview-focus-light-ru         …the same, light / ru
 *   preview-splitter-dark-en       the card pane dragged wider
 *
 * Writes tests/<frame>.png. Look at them before committing.
 * Needs the local Paseo daemon (127.0.0.1:6767) with the beads plugin loaded;
 * each fixture workspace is registered only for the run and removed afterwards.
 */

import fs from 'node:fs';
import path from 'node:path';
import { FIXTURE } from './fixture/build.mjs';
import { closeBrowser, shot, withPanel, withWorkspace } from './lib/paseo-web.mjs';

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
  'preview-columns-light-en', 'preview-link-cols-dark-en', 'preview-focus-dark-en', 'preview-focus-light-ru', 'preview-splitter-dark-en',
];

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
    .concat('preview-links-dark-en', 'preview-narrow-tree-en', 'preview-narrow-card-ru')
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
        'preview-focus-dark-en': ['dark', 'en', async (panel) => {
          await openFixture(panel, { select: 'demo-a1.3' });
          await tap(panel, 'beads-card-pin');
          await panel.locator('[data-testid="beads-card-focus"] [data-testid="beads-relrow-demo-a1"]').first().click();
          await panel.locator('[data-testid="beads-card"] [data-testid="beads-card-title"]').waitFor({ timeout: 30_000 });
          await panel.locator('[data-testid="beads-card-focus"] [data-testid="beads-card-title"]').scrollIntoViewIfNeeded();
        }],
        'preview-focus-light-ru': ['light', 'ru', async (panel) => {
          await openFixture(panel, { select: 'demo-b7' });
          await tap(panel, 'beads-card-pin');
          await panel.locator('[data-testid="beads-card-focus"] [data-testid="beads-relrow-demo-b7.1"]').first().click();
          await panel.locator('[data-testid="beads-card"] [data-testid="beads-card-title"]').waitFor({ timeout: 30_000 });
          await panel.locator('[data-testid="beads-card-focus"] [data-testid="beads-card-title"]').scrollIntoViewIfNeeded();
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
      // Under NARROW_PX but still Paseo's desktop layout (its phone layout has no tab strip to drive).
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
          files.push(await shot(page, 'preview-narrow-card-ru', { panel }));
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
