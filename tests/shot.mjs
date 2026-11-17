// @ts-check
/**
 * Screenshots of the beads panel in the real Paseo web app, on the synthetic
 * fixture (tests/fixture/), never on a live project.
 *
 *   npm run shot                     # bd mode, dark/light × en/ru
 *   npm run shot -- --mode jsonl     # the read-only, database-less mode
 *   npm run shot -- --team           # include the dashboard (team) issues
 *
 * Writes tests/preview-<set>-<theme>-<locale>.png. Look at them before committing.
 * Needs the local Paseo daemon (127.0.0.1:6767) with the beads plugin loaded;
 * the fixture workspace is registered only for the run and removed afterwards.
 */

import { FIXTURE } from './fixture/build.mjs';
import { closeBrowser, shot, withPanel, withWorkspace } from './lib/paseo-web.mjs';

const argv = process.argv.slice(2);
const mode = argv.includes('--mode') && argv[argv.indexOf('--mode') + 1] === 'jsonl' ? 'jsonl' : 'bd';
const team = argv.includes('--team');
const set = argv.includes('--set') ? argv[argv.indexOf('--set') + 1] : 'scaffold';

const t0 = Date.now();
/** @type {string[]} */
const files = [];
try {
  await withWorkspace({ mode, team }, async (workspace) => {
    for (const theme of /** @type {const} */ (['dark', 'light'])) {
      for (const locale of /** @type {const} */ (['en', 'ru'])) {
        await withPanel({ workspace, theme, locale, now: team ? FIXTURE.teamNow : undefined }, async ({ page, panel }) => {
          const suffix = [mode === 'jsonl' ? 'jsonl' : null, team ? 'team' : null, theme, locale].filter(Boolean).join('-');
          files.push(await shot(page, `preview-${set}-${suffix}`, { panel }));
        });
      }
    }
  });
} finally {
  await closeBrowser();
}
console.log(`${files.length} screenshot(s) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
for (const f of files) console.log(`  ${f}`);
