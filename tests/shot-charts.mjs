// @ts-check
/**
 * Screenshots of the charts view in the real Paseo web app, on the synthetic
 * fixture with the team history (tests/fixture/, `team: true`) and the page
 * clock held at FIXTURE.teamNow, so every reading draws the same each run.
 *
 *   npm run shot:charts                       # every frame below
 *   npm run shot:charts -- --only flow        # frames whose name contains "flow"
 *
 * Frames:
 *   preview-charts-<theme>-<locale>    Breakdowns
 *   preview-charts-barclick-en         a breakdown bar pressed: the filter is on, the chip shows
 *   preview-flow-<theme>-<locale>      Over time, the whole page (show closed on)
 *   preview-flow-hidden-en             Over time with closed issues hidden: the warning
 *   preview-people-<theme>-<locale>    Assignees
 *   preview-person-<theme>-<locale>    one person's page, the whole page
 *   preview-authors-<theme>-<locale>   Authors
 *   preview-author-light-en            one author's page
 *
 * Writes tests/<frame>.png. Look at them before committing.
 * Needs the local Paseo daemon (127.0.0.1:6767) with the beads plugin loaded.
 */

import { FIXTURE } from './fixture/build.mjs';
import { closeBrowser, shot, withPanel, withWorkspace } from './lib/paseo-web.mjs';

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] ?? '' : '';
const want = (/** @type {string} */ name) => !only || name.includes(only);

const WIDE = { width: 1440, height: 900 };
const ready = /** @param {any} panel */ (panel) => panel.locator('[data-testid="beads-view-switch"]').waitFor({ timeout: 30_000 });

/** The busiest person of the team fixture: someone holding work and closing it. */
const PERSON = 'dana@example.com';

/**
 * Grow the page to the panel's full content height, so a long reading is one
 * picture: the panel scrolls inside the viewport, so the viewport has to grow.
 */
async function fullHeight(/** @type {any} */ page, /** @type {any} */ panel) {
  const extra = await panel.evaluate((/** @type {HTMLElement} */ el) => {
    let more = 0;
    for (const n of el.querySelectorAll('*')) {
      const s = /** @type {HTMLElement} */ (n);
      if (s.scrollHeight > s.clientHeight + 2 && getComputedStyle(s).overflowY !== 'visible') more = Math.max(more, s.scrollHeight - s.clientHeight);
    }
    return more;
  });
  if (extra > 0) {
    const vp = page.viewportSize();
    await page.setViewportSize({ width: vp.width, height: vp.height + extra + 20 });
    await page.waitForTimeout(500);
  }
}

async function openCharts(/** @type {any} */ panel, /** @type {string} */ tab) {
  await panel.locator('[data-testid="beads-view-charts"]').click();
  await panel.locator(`[data-testid="beads-charts-tab-${tab}"]`).click();
  await panel.locator(`[data-testid="beads-charts-body-${tab}"]`).waitFor({ timeout: 15_000 });
}

async function showClosed(/** @type {any} */ panel) {
  const btn = panel.locator('[data-testid="beads-closed"]');
  if ((await btn.getAttribute('aria-selected')) !== 'true') await btn.click();
  await panel.page().waitForTimeout(300);
}

async function settle(/** @type {any} */ page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
}

const t0 = Date.now();
/** @type {string[]} */
const files = [];
try {
  await withWorkspace({ mode: 'bd', team: true }, async (workspace) => {
    const open = (/** @type {'dark'|'light'} */ theme, /** @type {'en'|'ru'} */ locale, /** @type {(ctx: any) => Promise<void>} */ fn) =>
      withPanel({ workspace, theme, locale, viewport: WIDE, now: FIXTURE.teamNow, ready }, fn);
    for (const [theme, locale] of /** @type {const} */ ([['dark', 'en'], ['light', 'ru'], ['light', 'en'], ['dark', 'ru']])) {
      const main = theme === 'dark' && locale === 'en' || theme === 'light' && locale === 'ru';
      const cuts = `preview-charts-${theme}-${locale}`;
      if (want(cuts)) {
        await open(theme, locale, async ({ page, panel }) => {
          await openCharts(panel, 'cuts');
          await settle(page);
          files.push(await shot(page, cuts, { panel }));
        });
      }
      const flow = `preview-flow-${theme}-${locale}`;
      if (want(flow)) {
        await open(theme, locale, async ({ page, panel }) => {
          await openCharts(panel, 'flow');
          await showClosed(panel);
          await panel.locator('[data-testid="beads-charts-flow"]').waitFor({ timeout: 15_000 });
          await fullHeight(page, panel);
          await settle(page);
          files.push(await shot(page, flow, { panel }));
        });
      }
      const people = `preview-people-${theme}-${locale}`;
      if (want(people)) {
        await open(theme, locale, async ({ page, panel }) => {
          await openCharts(panel, 'people');
          await showClosed(panel);
          await panel.locator('[data-testid="beads-ppl-table"]').waitFor({ timeout: 15_000 });
          await settle(page);
          files.push(await shot(page, people, { panel }));
        });
      }
      const person = `preview-person-${theme}-${locale}`;
      if (main && want(person)) {
        await open(theme, locale, async ({ page, panel }) => {
          await openCharts(panel, 'people');
          await showClosed(panel);
          await panel.locator(`[data-testid="beads-ppl-row-${PERSON}"]`).click();
          await panel.locator('[data-testid="beads-person"]').waitFor({ timeout: 15_000 });
          await fullHeight(page, panel);
          await settle(page);
          files.push(await shot(page, person, { panel }));
        });
      }
      const authors = `preview-authors-${theme}-${locale}`;
      if (main && want(authors)) {
        await open(theme, locale, async ({ page, panel }) => {
          await openCharts(panel, 'authors');
          await showClosed(panel);
          await panel.locator('[data-testid="beads-auth-table"]').waitFor({ timeout: 15_000 });
          await settle(page);
          files.push(await shot(page, authors, { panel }));
        });
      }
    }
    if (want('preview-author-light-en')) {
      await open('light', 'en', async ({ page, panel }) => {
        await openCharts(panel, 'authors');
        await showClosed(panel);
        await panel.locator(`[data-testid="beads-ppl-row-${PERSON}"]`).click();
        await panel.locator('[data-testid="beads-author"]').waitFor({ timeout: 15_000 });
        await fullHeight(page, panel);
        await settle(page);
        files.push(await shot(page, 'preview-author-light-en', { panel }));
      });
    }
    if (want('preview-flow-hidden-en')) {
      await open('dark', 'en', async ({ page, panel }) => {
        await openCharts(panel, 'flow');
        if (!(await panel.locator('[data-testid="beads-charts-closed-warning"]').count())) await panel.locator('[data-testid="beads-closed"]').click();
        await panel.locator('[data-testid="beads-charts-closed-warning"]').waitFor({ timeout: 15_000 });
        await settle(page);
        files.push(await shot(page, 'preview-flow-hidden-en', { panel }));
      });
    }
    if (want('preview-charts-barclick-en')) {
      await open('dark', 'en', async ({ page, panel }) => {
        await openCharts(panel, 'cuts');
        await panel.locator('[data-testid="beads-bar-type-bug"]').click();
        await settle(page);
        files.push(await shot(page, 'preview-charts-barclick-en', { panel }));
      });
    }
  });
} finally {
  await closeBrowser();
}
console.log(`${files.length} screenshot(s) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const f of files) console.log(`  ${f}`);
