// @ts-check
/**
 * Materialise the synthetic fixture (./data.mjs) as a real beads project on disk.
 *
 *   mode "bd"    — `bd init` + `bd import` of the generated issues.jsonl, then a
 *                  fresh `bd export` back into .beads/issues.jsonl so the export
 *                  is never stale against the database. The plugin's full mode.
 *   mode "jsonl" — only .beads/issues.jsonl, no database: the read-only mode.
 *
 * The rows are written in bd's own export format (see `bd export`): the list
 * rows of FIXTURE.tree.issues (and FIXTURE.team with `team: true`) merged with
 * the full cards — text fields, comments with authors and times, parent-child,
 * blocks, discovered-from and relates-to links.
 *
 * Determinism: every timestamp comes from the fixture, never from the clock,
 * and the project directory has a fixed path per configuration (the panel
 * prints it, so a random temp name would move the screenshots). One known
 * divergence: bd fills a missing created_at with "now", so in bd mode the one
 * team issue that has none (demo-tx04) gets NO_CREATED_AT instead.
 *
 * The bd process never sees the user's git identity or hooks: it runs with
 * GIT_CONFIG_GLOBAL=/dev/null, a fixed BEADS_ACTOR and --skip-hooks, inside a
 * directory under os.tmpdir() that is not part of any repository.
 *
 * CLI (handy for poking at the fixture by hand):
 *   node tests/fixture/build.mjs [--mode bd|jsonl] [--team] [--other]
 * prints the directory and leaves it in place.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURE, TEAM_NOW } from './data.mjs';

export { FIXTURE, TEAM_NOW };

/** Stand-in creation time for the team issue that has none (bd mode only). */
export const NO_CREATED_AT = '2026-01-05T09:00:00Z';

/** Root of every fixture directory; each build owns one subdirectory. */
export const FIXTURE_ROOT = path.join(os.tmpdir(), 'paseo-beads-fixture');

/** Written into each built directory so cleanup only ever removes our own. */
const MARKER = '.paseo-beads-fixture';

/**
 * Comments for issues whose list row counts them but which have no card in
 * the fixture. Invented, like everything else, so comment_count holds up.
 * @type {Record<string, Array<{author: string, created_at: string, text: string}>>}
 */
const EXTRA_COMMENTS = {
  'demo-a1.1': [
    { author: 'Sam Okoye', created_at: '2026-07-15T09:30:00Z', text: 'Twelve entities, four of them with nested actions.' },
    { author: 'Alex Perez', created_at: '2026-07-16T14:05:00Z', text: 'Spec reviewed; the matrix can start from it.' },
  ],
  'demo-a1.5': [
    { author: 'Alex Perez', created_at: '2026-07-30T08:40:00Z', text: 'Reproduces on every role but the owner.' },
  ],
  'demo-e4': [
    { author: 'Sam Okoye', created_at: '2026-08-01T11:00:00Z', text: 'Only with the status filter left at its default.' },
  ],
};

/** Strip milliseconds: bd stores timestamps to the second. */
function ts(/** @type {string | null | undefined} */ v) {
  return v ? v.replace(/\.\d{3}Z$/, 'Z') : null;
}

/**
 * The issues of one fixture variant as bd export rows.
 * @param {{ team?: boolean, variant?: 'main' | 'other', mode?: 'bd' | 'jsonl' }} [opts]
 * @returns {any[]}
 */
export function fixtureRows({ team = false, variant = 'main', mode = 'bd' } = {}) {
  /** @type {any[]} */
  const list = variant === 'other' ? [...FIXTURE.other.issues] : [...FIXTURE.tree.issues, ...(team ? FIXTURE.team : [])];
  /** @type {Record<string, any>} */
  const cards = variant === 'other' ? {} : FIXTURE.cards;
  const byId = new Map(list.map((i) => [i.id, i]));

  /** @type {Map<string, any[]>} */
  const deps = new Map();
  /** @param {string} from @param {string} to @param {string} type */
  const addDep = (from, to, type) => {
    if (!byId.has(from) || !byId.has(to)) return;
    const arr = deps.get(from) ?? [];
    if (arr.some((d) => d.depends_on_id === to)) return; // bd keeps one link per pair
    const src = byId.get(from);
    arr.push({
      issue_id: from,
      depends_on_id: to,
      type,
      created_at: ts(src.created_at) ?? NO_CREATED_AT,
      created_by: cards[from]?.created_by ?? src.created_by ?? src.owner ?? 'fixture',
      metadata: '{}',
    });
    deps.set(from, arr);
  };
  for (const i of list) {
    if (i.parent) addDep(i.id, i.parent, 'parent-child');
    for (const b of i.blockers ?? []) addDep(i.id, b, 'blocks');
    const rel = cards[i.id]?.relations;
    if (!rel) continue;
    for (const r of rel.blockedBy ?? []) addDep(i.id, r.id, 'blocks');
    for (const r of rel.discoveredFrom ?? []) addDep(i.id, r.id, 'discovered-from');
    for (const r of rel.other ?? []) if (r.direction !== 'in') addDep(i.id, r.id, r.type);
  }
  /** @param {string} id */
  const blocksIn = (id) => [...deps.values()].flat().filter((d) => d.type === 'blocks' && d.depends_on_id === id).length;

  return list.map((row) => {
    const card = cards[row.id] ?? {};
    const pick = (/** @type {string} */ k) => card[k] ?? row[k] ?? null;
    const status = pick('status');
    let createdAt = ts(pick('created_at'));
    if (!createdAt && mode === 'bd') createdAt = NO_CREATED_AT;
    const updatedAt = ts(pick('updated_at')) ?? createdAt;
    const closedAt = ts(pick('closed_at')) ?? (status === 'closed' ? updatedAt : null);
    const comments = (card.comments ?? EXTRA_COMMENTS[row.id] ?? []).map(
      (/** @type {any} */ c, /** @type {number} */ n) => ({
        id: c.id ?? `${row.id}-c${n + 1}`,
        issue_id: row.id,
        author: c.author,
        text: c.text,
        created_at: ts(c.created_at),
      }),
    );
    const d = deps.get(row.id) ?? [];
    /** @type {Record<string, any>} in bd's own field order; nulls dropped below */
    const out = {
      _type: 'issue',
      id: row.id,
      title: pick('title'),
      description: pick('description'),
      design: pick('design'),
      acceptance_criteria: pick('acceptance_criteria'),
      notes: pick('notes'),
      status,
      priority: pick('priority'),
      issue_type: pick('issue_type'),
      assignee: pick('assignee'),
      owner: pick('owner'),
      created_at: createdAt,
      created_by: pick('created_by'),
      updated_at: updatedAt,
      started_at: ts(pick('started_at')),
      closed_at: closedAt,
      close_reason: pick('close_reason'),
      defer_until: ts(pick('defer_until')),
      external_ref: pick('external_ref'),
      labels: pick('labels'),
      dependencies: d,
      comments,
      dependency_count: d.filter((x) => x.type === 'blocks').length,
      dependent_count: blocksIn(row.id),
      comment_count: comments.length,
    };
    for (const [k, v] of Object.entries(out)) {
      if (v === null || v === undefined || (Array.isArray(v) && v.length === 0)) delete out[k];
    }
    return out;
  });
}

/** The environment bd runs in: no user git identity, no prompts, fixed actor. */
function bdEnv() {
  return {
    ...process.env,
    BEADS_ACTOR: 'fixture',
    BD_NON_INTERACTIVE: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
  };
}

/** @param {string} cwd @param {string[]} args */
function bd(cwd, args) {
  return execFileSync('bd', args, { cwd, env: bdEnv(), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout: 60_000 });
}

/** Remove a fixture directory, refusing anything that is not one of ours. */
export function removeFixtureDir(/** @type {string} */ dir) {
  const resolved = path.resolve(dir);
  if (!resolved.startsWith(FIXTURE_ROOT + path.sep)) throw new Error(`refusing to remove ${resolved}: outside ${FIXTURE_ROOT}`);
  const owner = path.dirname(resolved); // <root>/<key>/<name>: the key dir holds the marker
  if (!fs.existsSync(path.join(owner, MARKER))) {
    if (fs.existsSync(owner)) throw new Error(`refusing to remove ${owner}: no ${MARKER} marker`);
    return;
  }
  fs.rmSync(owner, { recursive: true, force: true });
}

/**
 * Build a fixture project.
 *
 * @param {{ mode?: 'bd' | 'jsonl', team?: boolean, variant?: 'main' | 'other' }} [opts]
 * @returns {{ dir: string, name: string, prefix: string, mode: 'bd' | 'jsonl', rows: any[], cleanup: () => void }}
 */
export function buildFixture({ mode = 'bd', team = false, variant = 'main' } = {}) {
  const name = variant === 'other' ? 'demo-docs' : 'demo-shop';
  const prefix = variant === 'other' ? FIXTURE.other.prefix : FIXTURE.tree.prefix;
  const key = [variant, mode, team ? 'team' : null].filter(Boolean).join('-');
  const owner = path.join(FIXTURE_ROOT, key);
  const dir = path.join(owner, name);
  // A leftover from a crashed run: ours (marker present) is replaced.
  if (fs.existsSync(owner)) removeFixtureDir(dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(owner, MARKER), 'built by tests/fixture/build.mjs; safe to delete\n');

  const rows = fixtureRows({ team, variant, mode });
  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const cleanup = () => removeFixtureDir(dir);
  try {
    if (mode === 'jsonl') {
      fs.mkdirSync(path.join(dir, '.beads'));
      fs.writeFileSync(path.join(dir, '.beads', 'issues.jsonl'), jsonl);
    } else {
      bd(dir, ['init', '--non-interactive', '--prefix', prefix, '--skip-hooks', '--skip-agents', '-q']);
      const input = path.join(owner, 'import.jsonl'); // outside the project: not a stray file in it
      fs.writeFileSync(input, jsonl);
      bd(dir, ['import', input]);
      bd(dir, ['export', '-o', path.join(dir, '.beads', 'issues.jsonl')]);
      fs.rmSync(input);
    }
  } catch (err) {
    cleanup();
    throw err;
  }
  return { dir, name, prefix, mode, rows, cleanup };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const modeArg = argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : 'bd';
  const t0 = Date.now();
  const fx = buildFixture({
    mode: modeArg === 'jsonl' ? 'jsonl' : 'bd',
    team: argv.includes('--team'),
    variant: argv.includes('--other') ? 'other' : 'main',
  });
  console.log(`${fx.dir}  (${fx.rows.length} issues, ${fx.mode}, ${Date.now() - t0} ms)`);
}
