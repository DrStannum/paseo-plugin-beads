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

/** Rows per `bd import` call (see buildFixture). */
const IMPORT_CHUNK = 500;

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

const RICH_STATUS = ['open', 'open', 'in_progress', 'closed', 'closed', 'closed', 'blocked', 'deferred'];
const RICH_TYPE = ['task', 'bug', 'feature', 'chore'];
const RICH_WORDS = 'the panel reads every issue of the project once and keeps the snapshot until the revision moves so a poll costs nothing while a write invalidates it'.split(' ');

/** Invented prose of about `n` characters, the same for the same seed. */
function prose(/** @type {number} */ seed, /** @type {number} */ n) {
  let out = '';
  for (let k = 0; out.length < n; k++) {
    out += RICH_WORDS[(seed * 7 + k * 13) % RICH_WORDS.length] + ((k + seed) % 17 === 16 ? '.\n\n' : ' ');
  }
  return out.trim();
}

/** One row of a large synthetic tracker (buildFixture `rich`). */
function richRow(/** @type {string} */ prefix, /** @type {number} */ i) {
  const id = `${prefix}-x${String(i).padStart(4, '0')}`;
  const epic = i % 25 === 1;
  const parent = epic ? null : `${prefix}-x${String(i - ((i - 1) % 25)).padStart(4, '0')}`;
  const day = (/** @type {number} */ d) => new Date(Date.parse('2026-01-01T09:00:00Z') + d * 3_600_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const status = epic ? 'open' : RICH_STATUS[i % RICH_STATUS.length];
  /** @type {Record<string, any>} */
  const row = {
    _type: 'issue', id, title: `${epic ? 'Epic' : 'Work item'} ${i}: ${prose(i, 50)}`,
    description: prose(i, 1200), design: prose(i + 1, 900), acceptance_criteria: prose(i + 2, 400), notes: prose(i + 3, 200),
    status, priority: i % 5, issue_type: epic ? 'epic' : RICH_TYPE[i % RICH_TYPE.length],
    assignee: `person-${i % 12}@example.com`, owner: `person-${i % 12}@example.com`, created_by: 'fixture',
    created_at: day(i), updated_at: day(i + 5),
    labels: [`area:${['ui', 'server', 'docs', 'tests'][i % 4]}`, ...(i % 3 ? [] : ['debt'])],
  };
  if (status === 'closed') { row.closed_at = day(i + 9); row.close_reason = 'done'; }
  if (parent) {
    row.dependencies = [{ issue_id: id, depends_on_id: parent, type: 'parent-child', created_at: day(i), created_by: 'fixture', metadata: '{}' }];
  }
  if (i % 5 === 0) {
    row.comments = [{ id: `${id}-c1`, issue_id: id, author: 'Sam Okoye', text: prose(i + 4, 300), created_at: day(i + 6) }];
    row.comment_count = 1;
  }
  return row;
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

/** @param {string} cwd @param {string[]} args @param {number} [timeout] */
function bd(cwd, args, timeout = 60_000) {
  return execFileSync('bd', args, { cwd, env: bdEnv(), stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', timeout, maxBuffer: 1 << 28 });
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
 * `variant: 'bare'` is a plain directory with no .beads anywhere above it —
 * the panel's "beads is not set up" empty state.
 *
 * `many: N` adds N plain open tasks (demo-x001…): a board lane long enough
 * to be cut short at BOARD_PAGE — the fixture itself is a readable 16 issues.
 * `rich: true` makes those N rows look like a real tracker's instead: an
 * epic every 25 rows with its children under it, every status and type,
 * labels, kilobytes of description / design / acceptance text and a comment
 * on every fifth — the shape behind bd's load time on a large project
 * (tests/bench-large.mjs). Still invented text, deterministic timestamps.
 * `tag` gives a run its own directory, so two shot scripts running at once
 * never build over each other's fixture.
 *
 * @param {{ mode?: 'bd' | 'jsonl', team?: boolean, variant?: 'main' | 'other' | 'bare', many?: number, rich?: boolean, tag?: string }} [opts]
 * @returns {{ dir: string, name: string, prefix: string, mode: 'bd' | 'jsonl', rows: any[], cleanup: () => void }}
 */
export function buildFixture({ mode = 'bd', team = false, variant = 'main', many = 0, rich = false, tag = '' } = {}) {
  if (variant === 'bare') {
    const owner = path.join(FIXTURE_ROOT, 'bare');
    const dir = path.join(owner, 'demo-empty');
    if (fs.existsSync(owner)) removeFixtureDir(dir);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(owner, MARKER), 'built by tests/fixture/build.mjs; safe to delete\n');
    fs.writeFileSync(path.join(dir, 'README.md'), 'A project without beads.\n');
    return { dir, name: 'demo-empty', prefix: '', mode, rows: [], cleanup: () => removeFixtureDir(dir) };
  }
  const name = variant === 'other' ? 'demo-docs' : 'demo-shop';
  const prefix = variant === 'other' ? FIXTURE.other.prefix : FIXTURE.tree.prefix;
  const key = [variant, mode, team ? 'team' : null, many ? `many${many}` : null, rich ? 'rich' : null, tag || null].filter(Boolean).join('-');
  const owner = path.join(FIXTURE_ROOT, key);
  const dir = path.join(owner, name);
  // A leftover from a crashed run: ours (marker present) is replaced.
  if (fs.existsSync(owner)) removeFixtureDir(dir);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(owner, MARKER), 'built by tests/fixture/build.mjs; safe to delete\n');

  const rows = fixtureRows({ team, variant: variant === 'other' ? 'other' : 'main', mode });
  for (let i = 1; i <= many; i++) rows.push(rich ? richRow(prefix, i) : {
    _type: 'issue', id: `${prefix}-x${String(i).padStart(3, '0')}`, title: `Backlog item ${i}`,
    status: 'open', priority: 3, issue_type: 'task', created_at: NO_CREATED_AT, updated_at: NO_CREATED_AT,
  });
  const jsonl = rows.map((r) => JSON.stringify(r)).join('\n') + '\n';
  const cleanup = () => removeFixtureDir(dir);
  try {
    if (mode === 'jsonl') {
      fs.mkdirSync(path.join(dir, '.beads'));
      fs.writeFileSync(path.join(dir, '.beads', 'issues.jsonl'), jsonl);
    } else {
      bd(dir, ['init', '--non-interactive', '--prefix', prefix, '--skip-hooks', '--skip-agents', '-q']);
      const input = path.join(owner, 'import.jsonl'); // outside the project: not a stray file in it
      // bd import slows down faster than its input grows; a large fixture goes in by IMPORT_CHUNK rows.
      for (let at = 0; at < rows.length; at += IMPORT_CHUNK) {
        fs.writeFileSync(input, rows.slice(at, at + IMPORT_CHUNK).map((r) => JSON.stringify(r)).join('\n') + '\n');
        bd(dir, ['import', input], 300_000);
      }
      bd(dir, ['export', '-o', path.join(dir, '.beads', 'issues.jsonl')], 300_000);
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
