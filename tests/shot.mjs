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

/** The reference's own shots are 1360 wide; Paseo's tab strip takes a little more. */
const WIDE = { width: 1440, height: 900 };

const t0 = Date.now();
/** @type {string[]} */
const files = [];
const ready = /** @param {any} panel */ (panel) => panel.locator('[data-testid="beads-panel"]').waitFor({ timeout: 30_000 });
try {
  const bdFrames = ['dark', 'light'].flatMap((th) => ['en', 'ru'].map((l) => `preview-tree-${th}-${l}`))
    .concat('preview-links-dark-en', 'preview-narrow-tree-en', 'preview-narrow-card-ru');
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
