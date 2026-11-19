// @ts-check
/**
 * Screenshots of the board view in the real Paseo web app, on the synthetic
 * fixture (tests/fixture/), never on a live project — plus the board's
 * scripted checks: a drag really writes the status (read back with
 * `bd show --json` in the fixture), Escape cancels a drag, Enter opens a
 * card, and a jsonl project does not drag at all.
 *
 *   npm run shot:board                   # every frame and check below
 *   npm run shot:board -- --only drag    # frames whose name contains "drag"
 *
 * Frames:
 *   preview-board-<theme>-<locale>  the board, nothing selected: lanes take the width
 *   preview-board-selected-en       a card pressed: selected style, the card beside the board
 *   preview-board-drag-en           mid-drag: the ghost under the pointer, the target lane lit
 *   preview-board-dropped-en        …after the drop: the card in its new lane (bd checked)
 *   preview-board-more-en           a lane past BOARD_PAGE: "N more" under it
 *   preview-board-jsonl-en          the jsonl export only: the same board, no drag
 *   preview-board-narrow-ru         under 900 px: 220 px lanes, swiped sideways
 *                                  (checked: a pressed card takes the board's place, "Board" leads back)
 *   preview-board-narrow-card-en    …a pressed card in the board's place, "Board" leads back
 *
 * Writes tests/<frame>.png. Look at them before committing.
 * Needs the local Paseo daemon (127.0.0.1:6767) with the beads plugin loaded.
 */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { closeBrowser, shot, withPanel, withWorkspace } from './lib/paseo-web.mjs';

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] ?? '' : '';
const want = (/** @type {string} */ name) => !only || name.includes(only);

const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 820, height: 860 };
const ready = /** @param {any} panel */ (panel) => panel.locator('[data-testid="beads-view-switch"]').waitFor({ timeout: 30_000 });
const sel = (/** @type {string} */ id) => `[data-testid="${id}"]`;

/** The card that moves in the drag frames: open, ready, a label. */
const DRAGGED = 'demo-a1.4';

async function openBoard(/** @type {any} */ panel) {
  await panel.locator(sel('beads-view-board')).first().click();
  await panel.locator(sel('beads-lane-open')).waitFor({ timeout: 30_000 });
  await settle(panel.page());
}

async function settle(/** @type {any} */ page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(400);
}

/** Centre of a node's box. */
async function centre(/** @type {any} */ locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error('not on screen');
  return { x: b.x + b.width / 2, y: b.y + Math.min(b.height / 2, 24) };
}

/** Press on a card and carry it over a lane, without letting go. */
async function dragOver(/** @type {any} */ panel, /** @type {string} */ id, /** @type {string} */ to) {
  const page = panel.page();
  const from = await centre(panel.locator(sel(`beads-bcard-${id}`)));
  const lane = await panel.locator(sel(`beads-lane-${to}`)).boundingBox();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 2, from.y + 1); // inside the slop: still a press
  const target = { x: lane.x + lane.width / 2, y: lane.y + 180 };
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.waitForTimeout(250);
}

/** @param {string} dir @param {string} id */
function bdStatus(dir, id) {
  const out = execFileSync('bd', ['show', id, '--json', '--readonly'], { cwd: dir, encoding: 'utf8', env: { ...process.env, BD_NON_INTERACTIVE: '1' } });
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed[0] : parsed).status;
}

const t0 = Date.now();
/** @type {string[]} */
const files = [];
/** @type {string[]} */
const checks = [];
try {
  const bdFrames = ['dark', 'light'].flatMap((th) => ['en', 'ru'].map((l) => `preview-board-${th}-${l}`))
    .concat('preview-board-selected-en', 'preview-board-drag-en', 'preview-board-dropped-en', 'preview-board-narrow-ru', 'preview-board-narrow-card-en');
  if (bdFrames.some(want)) {
    await withWorkspace({ mode: 'bd', tag: 'board' }, async (workspace) => {
      for (const theme of /** @type {const} */ (['dark', 'light'])) {
        for (const locale of /** @type {const} */ (['en', 'ru'])) {
          const name = `preview-board-${theme}-${locale}`;
          if (!want(name)) continue;
          await withPanel({ workspace, theme, locale, viewport: WIDE, ready }, async ({ page, panel }) => {
            await openBoard(panel);
            // Nothing selected: no card pane next to the board.
            assert.equal(await panel.locator(sel('beads-card-pane')).count(), 0, 'no card pane without a selection');
            files.push(await shot(page, name, { panel }));
          });
        }
      }
      if (want('preview-board-selected-en')) {
        await withPanel({ workspace, theme: 'dark', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
          await openBoard(panel);
          // The keyboard first: a card is a button, Enter opens it.
          await panel.locator(sel('beads-bcard-demo-b7.3')).focus();
          await page.keyboard.press('Enter');
          await panel.locator(sel('beads-card-title')).waitFor({ timeout: 30_000 });
          assert.match(await panel.locator(sel('beads-card-title')).innerText(), /Cross-resource/);
          checks.push('Enter on a focused card opens it beside the board');
          await panel.locator(sel('beads-bcard-demo-a1.2')).click();
          await panel.locator(sel('beads-card-pane')).waitFor({ timeout: 30_000 });
          await page.waitForTimeout(600);
          assert.match(await panel.locator(sel('beads-card-title')).innerText(), /Permission matrix/);
          checks.push('a pressed card opens beside the board');
          await settle(page);
          files.push(await shot(page, 'preview-board-selected-en', { panel }));
        });
      }
      if (want('preview-board-narrow-ru')) {
        await withPanel({ workspace, theme: 'light', locale: 'ru', viewport: NARROW, ready }, async ({ page, panel }) => {
          await openBoard(panel);
          const lane = await panel.locator(sel('beads-lane-open')).boundingBox();
          assert.equal(Math.round(lane.width), 220, 'narrow lanes are 220 px');
          checks.push('narrow lanes are 220 px wide');
          files.push(await shot(page, 'preview-board-narrow-ru', { panel }));
          // Swipe the lanes a little: the way back must find them where they were.
          const scrollLeft = (/** @type {number | null} */ to) => panel.locator(sel('beads-lane-open')).evaluate((/** @type {any} */ el, /** @type {number | null} */ v) => {
            let n = el.parentElement;
            while (n && !(n.scrollWidth > n.clientWidth + 4 && getComputedStyle(n).overflowX !== 'visible')) n = n.parentElement;
            if (!n) return -1;
            if (v != null) n.scrollLeft = v;
            return n.scrollLeft;
          }, to);
          const left = await scrollLeft(120);
          assert.ok(left > 0, 'narrow lanes scroll sideways');
          await page.waitForTimeout(200);
          await panel.locator(sel('beads-bcard-demo-a1.2')).click();
          await panel.locator(sel('beads-card-title')).waitFor({ timeout: 30_000 });
          assert.equal(await panel.locator(sel('beads-lane-open')).isVisible(), false, 'the card takes the board\'s place');
          assert.equal(await panel.locator(sel('beads-card-overlay')).count(), 0, 'no overlay');
          checks.push('narrow: a pressed card opens in the board\'s place');
          await panel.locator(sel('beads-card-back-list')).click();
          await panel.locator(sel('beads-lane-open')).waitFor({ state: 'visible', timeout: 10_000 });
          await page.mouse.move(0, 0);
          // The selected style (RN-web puts no aria-selected on a button): not a plain card's background.
          const bg = (/** @type {string} */ id) => panel.locator(sel(id)).evaluate((/** @type {any} */ e) => getComputedStyle(e).backgroundColor);
          assert.notEqual(await bg('beads-bcard-demo-a1.2'), await bg(`beads-bcard-${DRAGGED}`), 'the card stays selected');
          assert.equal(await scrollLeft(null), left, 'the lanes keep their sideways scroll');
          checks.push('narrow: "Board" leads back to the board, the card stays selected, the lanes where they were');
        });
      }
      if (want('preview-board-narrow-card-en')) {
        await withPanel({ workspace, theme: 'dark', locale: 'en', viewport: NARROW, ready }, async ({ page, panel }) => {
          await openBoard(panel);
          await panel.locator(sel('beads-bcard-demo-b7.3')).click();
          await panel.locator(sel('beads-card-title')).waitFor({ timeout: 30_000 });
          assert.equal(await panel.locator(sel('beads-card-back-list')).innerText(), 'Board', 'the way back names the board');
          await settle(page);
          files.push(await shot(page, 'preview-board-narrow-card-en', { panel }));
        });
      }
      if (want('preview-board-drag-en') || want('preview-board-dropped-en')) {
        await withPanel({ workspace, theme: 'light', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
          await openBoard(panel);
          // Escape first: the card goes nowhere, nothing is written.
          await dragOver(panel, DRAGGED, 'blocked');
          await panel.locator(sel('beads-board-ghost')).waitFor({ timeout: 5_000 });
          await page.keyboard.press('Escape');
          await panel.locator(sel('beads-board-ghost')).waitFor({ state: 'detached', timeout: 5_000 });
          await page.mouse.up();
          await page.waitForTimeout(800);
          assert.equal(bdStatus(workspace.dir, DRAGGED), 'open', 'Escape cancels the drag');
          assert.equal(await panel.locator(`${sel('beads-lane-open')} ${sel(`beads-bcard-${DRAGGED}`)}`).count(), 1);
          checks.push('Escape cancels a drag: no write, the card stays');

          await dragOver(panel, DRAGGED, 'in_progress');
          await panel.locator(sel('beads-board-ghost')).waitFor({ timeout: 5_000 });
          if (want('preview-board-drag-en')) files.push(await shot(page, 'preview-board-drag-en', { panel }));
          // The "exported" badge after the write shows for EXPORT_DONE_MS only; start
          // watching for it before the drop, or a slow bd show below can outlast it.
          const exported = panel.locator(sel('beads-export-done')).waitFor({ timeout: 30_000 });
          exported.catch(() => {});
          await page.mouse.up();
          await panel.locator(`${sel('beads-lane-in_progress')} ${sel(`beads-bcard-${DRAGGED}`)}`).waitFor({ timeout: 30_000 });
          // The export after the write reports back in the header; wait for it, so the
          // frame does not depend on whether bd export beat the shot. The checks
          // through bd come after the frame: a slow bd show must not outlast the badge.
          await exported;
          await settle(page);
          if (want('preview-board-dropped-en')) files.push(await shot(page, 'preview-board-dropped-en', { panel }));
          assert.equal(bdStatus(workspace.dir, DRAGGED), 'in_progress', 'the drop wrote the status');
          // The click that ends a drag opens nothing.
          assert.equal(await panel.locator(sel('beads-card-pane')).count(), 0, 'a drop does not select');
          checks.push(`drag ${DRAGGED} open → in_progress: bd show says in_progress`);

          // The open card hears about a board drag: one shared changeStatus.
          await panel.locator(sel(`beads-bcard-${DRAGGED}`)).click();
          await panel.locator(sel('beads-card-pane')).waitFor({ timeout: 30_000 });
          await settle(page);
          await dragOver(panel, DRAGGED, 'open');
          await page.mouse.up();
          const both = await page.waitForFunction(([card, pill]) => {
            const c = document.querySelector(card);
            const p = document.querySelector(pill);
            return Boolean(c && p && /changing/.test(c.textContent ?? '') && /changing/.test(p.textContent ?? ''));
          }, [sel(`beads-bcard-${DRAGGED}`), `${sel('beads-card-pane')} ${sel('beads-status')}`], { timeout: 10_000, polling: 20 })
            .then(() => true, () => false);
          assert.ok(both, '"changing…" shows on the board card and the open card at once');
          await panel.locator(`${sel('beads-lane-open')} ${sel(`beads-bcard-${DRAGGED}`)}`).waitFor({ timeout: 30_000 });
          assert.equal(bdStatus(workspace.dir, DRAGGED), 'open', 'dragged back');
          checks.push('a drag with the card open: "changing…" on both, bd show says open again');
        });
      }
    });
  }
  if (want('preview-board-more-en')) {
    await withWorkspace({ mode: 'bd', many: 120, tag: 'board' }, async (workspace) => {
      await withPanel({ workspace, theme: 'light', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
        await openBoard(panel);
        const open = panel.locator(sel('beads-lane-open'));
        const count = Number(await panel.locator(sel('beads-lanecount-open')).innerText());
        assert.equal(await open.locator('[data-testid^="beads-bcard-"]').count(), 50, 'one page drawn');
        const more = panel.locator(sel('beads-lanemore-open'));
        assert.equal(await more.innerText(), `${count - 50} more`);
        await more.click();
        await page.waitForTimeout(400);
        assert.equal(await open.locator('[data-testid^="beads-bcard-"]').count(), 100, 'a second page drawn');
        checks.push(`a lane of ${count}: 50 drawn, "${count - 50} more" draws 50 more`);
        await settle(page);
        files.push(await shot(page, 'preview-board-more-en', { panel }));
      });
    });
  }
  if (want('preview-board-jsonl-en')) {
    await withWorkspace({ mode: 'jsonl', tag: 'board' }, async (workspace) => {
      await withPanel({ workspace, theme: 'light', locale: 'en', viewport: WIDE, ready }, async ({ page, panel }) => {
        await openBoard(panel);
        await dragOver(panel, DRAGGED, 'in_progress');
        assert.equal(await panel.locator(sel('beads-board-ghost')).count(), 0, 'jsonl: no ghost');
        await page.mouse.up();
        await page.waitForTimeout(500);
        assert.equal(await panel.locator(`${sel('beads-lane-open')} ${sel(`beads-bcard-${DRAGGED}`)}`).count(), 1);
        const tip = await panel.locator(sel(`beads-bcard-${DRAGGED}`)).getAttribute('title');
        assert.match(tip ?? '', /jsonl/);
        checks.push('jsonl: no drag, the card tooltip says why');
        await settle(page);
        files.push(await shot(page, 'preview-board-jsonl-en', { panel }));
      });
    });
  }
} finally {
  await closeBrowser();
}
console.log(`${files.length} screenshot(s) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const f of files) console.log(`  ${f}`);
for (const c of checks) console.log(`  ok: ${c}`);
