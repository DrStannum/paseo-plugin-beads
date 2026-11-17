// @ts-check
/**
 * Every screenshot of the panel in one go, then the checks that keep the
 * committed PNGs honest.
 *
 *   npm run preview
 *
 * Runs each shot script below in turn, as its own process (each one owns a
 * browser and its fixture workspaces, and cleans both up): the frames, plus
 * the scripted checks the board and writes scripts carry (drag writes the
 * status, the end-to-end pass through the UI). Any failure fails the run.
 *
 * Deterministic on purpose, so a re-run only changes the PNGs of what really
 * changed: fixtures with fixed timestamps and fixed paths
 * (tests/fixture/build.mjs); the page clock held at FIXTURE.teamNow in every
 * frame (tests/lib/paseo-web.mjs, withPanel); screenshots taken with
 * animations disabled, so a spinner is caught at its first frame, never
 * mid-turn.
 *
 * Then the gallery check — the counterpart of the reference's "screenshots
 * that no documentation page shows", against frames rather than pages:
 * - every preview-*.png in tests/ was drawn by this run (else it is an
 *   orphan: a frame was renamed or dropped and its old PNG left behind);
 * - every PNG this run drew is listed in its script's "Frames:" header;
 * - every entry of a "Frames:" header draws at least one PNG.
 *
 * Needs the local Paseo daemon (127.0.0.1:6767) with the beads plugin loaded
 * (`paseo plugin reload beads` after a change). Synthetic fixtures only.
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The shot scripts, in the order they run. */
const SCRIPTS = ['shot.mjs', 'shot-board.mjs', 'shot-charts.mjs', 'shot-writes.mjs'];

/** The names a script's "Frames:" header promises, as patterns. */
function framePatterns(/** @type {string} */ script) {
  const src = fs.readFileSync(path.join(here, script), 'utf8');
  const head = src.slice(0, src.indexOf('*/'));
  const at = head.indexOf('Frames:');
  if (at < 0) throw new Error(`${script} has no "Frames:" header`);
  /** @type {{ entry: string, re: RegExp }[]} */
  const out = [];
  for (const line of head.slice(at).split('\n').slice(1)) {
    const m = line.match(/^\s*\*\s+(preview-[\w<>.-]+)/);
    if (!m) {
      if (/^\s*\*\s*$/.test(line)) break; // the list ends at the first empty comment line
      continue;
    }
    const entry = m[1];
    const re = new RegExp(`^${entry
      .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      .replace(/<theme>/g, '(dark|light)')
      .replace(/<locale>/g, '(en|ru)')}$`);
    out.push({ entry, re });
  }
  if (!out.length) throw new Error(`${script}: empty "Frames:" header`);
  return out;
}

const pngs = () => fs.readdirSync(here).filter((f) => /^preview-.*\.png$/.test(f));
const mtime = (/** @type {string} */ f) => fs.statSync(path.join(here, f)).mtimeMs;

const t0 = Date.now();
/** @type {{ script: string, ms: number, frames: string[] }[]} */
const runs = [];
/** @type {string[]} */
const bad = [];
for (const script of SCRIPTS) {
  const started = Date.now();
  const before = new Map(pngs().map((f) => [f, mtime(f)]));
  console.log(`── ${script}`);
  const res = spawnSync(process.execPath, [path.join(here, script)], { stdio: 'inherit', env: { ...process.env, PASEO_WEB_QUIET: '1' } });
  const frames = pngs().filter((f) => !before.has(f) || mtime(f) > /** @type {number} */ (before.get(f)));
  runs.push({ script, ms: Date.now() - started, frames });
  if (res.status !== 0) {
    console.log(`✗ ${script} failed (exit ${res.status ?? res.signal}); stopping`);
    process.exit(1);
  }
}

// ── the gallery check ──
/** @type {Map<string, string>} frame -> the script that drew it */
const drawnBy = new Map();
for (const r of runs) for (const f of r.frames) drawnBy.set(f, r.script);
for (const f of pngs()) {
  if (!drawnBy.has(f)) bad.push(`${f} is in tests/ but no frame draws it any more — an orphan: delete it (or bring its frame back)`);
}
for (const r of runs) {
  const patterns = framePatterns(r.script);
  const used = new Set();
  for (const f of r.frames) {
    const hit = patterns.find((p) => p.re.test(f.replace(/\.png$/, '')));
    if (hit) used.add(hit.entry);
    else bad.push(`${r.script} drew ${f}, which its "Frames:" header does not list`);
  }
  for (const p of patterns) if (!used.has(p.entry)) bad.push(`${r.script} lists ${p.entry} under "Frames:", but drew no such PNG`);
}

console.log('');
for (const r of runs) console.log(`  ${r.script.padEnd(16)} ${String(r.frames.length).padStart(3)} frame(s)  ${(r.ms / 1000).toFixed(0)} s`);
const total = runs.reduce((n, r) => n + r.frames.length, 0);
if (bad.length) {
  for (const line of bad) console.log(`  ✗ ${line}`);
  process.exitCode = 1;
} else {
  console.log(`  gallery check: all ${total} PNGs in tests/ are drawn by a listed frame, none orphaned`);
}
console.log(`preview: ${((Date.now() - t0) / 1000).toFixed(0)} s`);
