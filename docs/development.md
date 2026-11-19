# Development and tests

**English** · [Русский](ru/development.md)

How to set the project up, the test suites and what each needs, and how the screenshots are taken in the real Paseo app.

## Setup

```bash
git clone https://github.com/DrStannum/paseo-plugin-beads.git
cd paseo-plugin-beads
npm install                 # type definitions and the test toolchain only
paseo plugin install .      # the daemon builds and loads it from this directory
```

The plugin has **no runtime dependencies**: everything it imports at run time is
provided by the Paseo host (`react`, `react-native`, `@tanstack/react-query`,
`zod`, `@getpaseo/plugin`) or is a `node:*` module on the server side. The
`devDependencies` are there for the type checker and the tests. Node 22.18 or
newer runs the TypeScript tests directly, without a build step.

After a change, `paseo plugin reload beads` makes the daemon rebuild the plugin
and the open panels pick it up. There is no need to restart the daemon.

The client code runs on Hermes on iOS and Android, so it stays within what Hermes
supports: no `class`, no `Array.prototype.toSorted`, no regex lookbehind or `v`
flag, no `Intl.Segmenter`.

## The suites

```bash
npm run typecheck   # tsc --noEmit
npm run smoke       # the RPC handlers against a recording bd stub, in seconds
npm run write       # the write path against a real bd, in a throwaway project, about a minute
npm test            # typecheck + every tests/*.test.ts (smoke, write and the pure logic)
npm run preview     # every screenshot in the real Paseo web app, plus scripted checks, about 20 minutes
npm run bench       # timings on a large synthetic project, about 3 minutes; not part of npm test
npm run bench:open  # the same project opened in the real Paseo web app, about 7 minutes; not part of npm test
```

What each one needs:

| Script | Needs |
|---|---|
| `npm run typecheck`, the logic tests | nothing beyond `npm install` |
| `npm run smoke` | nothing: `bd` is a stub the test puts on `PATH` |
| `npm run write`, `npm test` | a real `bd` on `PATH`; the test creates and removes its own project |
| `npm run preview`, `npm run shot*` | a running local Paseo daemon with this plugin loaded, `bd`, and Playwright with Chromium |
| `npm run bench` | a real `bd` |
| `npm run bench:open` | as `npm run preview`; it also reloads the plugin (`paseo plugin reload beads`) |

**`tests/support/harness.ts`** calls the plugin's RPC handlers the way the daemon
does, without one: the input is parsed by the contract, the handler runs with a
fake context whose workspace lookup answers from a map, and the output is parsed
by the contract too, so an answer that does not match its schema fails the test
just as it would fail the RPC.

**`tests/smoke.test.ts` and `tests/smoke-write.test.ts`** drive the handlers
against an argv-recording `bd` stub and check the log afterwards, so the invariants
are verified by running the code, not by reading it: every read carries
`--readonly`; writes come only from the write RPCs, only with a subcommand from the
closed set, never with `--readonly` and always with `--dolt-auto-commit off`;
`delete`, `init` and `sync` are refused before `bd` is started; an unknown
workspace answers `unknown_workspace` from every RPC and a directory without
`.beads` `no_beads`. The snapshot cache is driven through failure on purpose:
parallel requests after a revision move spawn one `bd list`; `have` answers
`unchanged` without rows; with `deltas`, a changed, removed or added issue comes as
a delta that, applied to the rows held, equals the full answer — also when the
revision moves during the read — while an unknown `have`, a big gap or a stale
answer get the full set (the pure diff and the revision ring are unit-tested in
`tests/history.test.ts`, the restart case in `tests/snapshot-disk.test.ts`); a failing `bd list` serves the last good snapshot marked
`stale`; a load slower than the handler's budget answers `busy` and lands in the
cache; the log line names the reason without issue text.

**`tests/write.test.ts`** does the same against a real `bd`: it creates a
throwaway project, drives field edits, close and reopen, tags, comments with and
without an author, a parent change, the export queue, an injected export failure
and its repair, and Sync both ways (a stale file does not overwrite newer work),
then deletes the project.

**`tests/disk.test.ts`** covers the on-disk snapshot store (`server/beads/disk.ts`)
in a temporary directory (`CBD_CACHE_DIR`), never the real `~/.paseo`: the
directory is 0700 and files 0600 even under an empty umask; a saved snapshot reads
back with the same graph; a broken, truncated, foreign or other-format file reads
as nothing and is deleted; a write cut short leaves only a temp file that no read
sees and the sweep removes; the size limits, the idle and least-recently-used
sweep; two processes saving at once leave one whole file.

**`tests/snapshot-disk.test.ts`** covers that store wired into the read path,
against the stub, with a restart simulated by dropping the memory and keeping the
files: a good load is saved after the reply, a failed one never; with the same
revision the tree, card and search answer from the file without running `bd`;
with a moved revision the older copy answers at once while one `bd list` runs
behind it, and the next tree with `have` gets the fresh rows (or the old ones
marked stale if that load failed); a missing or broken file is a cold load; an
edit after a restart never plans against the older copy; the first revision poll
warms a project after replying; archiving a workspace removes its file unless
another workspace opens the same `.beads`; `contribute()` returns at once and the
sweep runs after it, or not at all if the plugin is stopped first.

The rest are pure logic: the tree, filters and search (`tree`, `filters`), the
board's lanes and drag arithmetic (`board`), the edit form's diff and the settings
schema (`form`), chart aggregations and scenes (`charts`, `chart-scene`,
`charts-view`), the Markdown renderer with its hostile inputs (`markdown`), the
string tables of both languages (`strings`), and the documentation (`docs`: every
page exists in both languages, every relative link and image resolves, and every
screenshot is shown in the gallery).

## The screenshot harness

`npm run preview` (`tests/preview.mjs`) runs four scripts one after another, each
in its own process: `shot.mjs` (the tree, the card, filters, layout),
`shot-board.mjs`, `shot-charts.mjs` and `shot-writes.mjs`. Each can be run alone,
and narrowed to the frames whose name contains a word:

```bash
npm run shot -- --only stale
npm run shot:board
npm run shot:charts -- --only flow
npm run shot:writes -- --e2e     # only the end-to-end pass through the UI
```

How it works (`tests/lib/paseo-web.mjs`):

- **The real app.** The daemon on `127.0.0.1:6767` does not serve its web UI, but
  the bundle ships on disk; Playwright answers the page's requests from that
  bundle and lets `/api/*` through to the daemon, so the page has the daemon's own
  origin and connects like any client.
- **A fixture workspace for the run only.** `tests/fixture/` builds a synthetic
  beads project (in `bd` or `jsonl` mode, optionally with a team history or a few
  thousand issues) at a fixed path, registers it as a Paseo project and a
  background workspace, and removes both afterwards, also on Ctrl+C. Nothing else
  in the daemon is touched, and the screenshots are cropped to the panel, so the
  sidebar never ends up in a PNG.
- **Deterministic frames.** Fixed timestamps in the fixture, the page clock held
  at the fixture's own "now", animations disabled. The plugin's settings (the
  poll interval in every header, the name on the settings page) are pinned to
  their defaults for the run, and the exact previous settings file is put back on
  exit; a run killed outright is undone by the next one.
- **Scripted checks.** The board script drags a card with the mouse and checks
  with `bd show` that the status was written; the writes script edits, creates,
  comments, signs a comment with a name set on the settings page and syncs,
  through the UI, and checks every result with `bd`.

The run ends with a gallery check: every `tests/preview-*.png` was drawn by this
run (otherwise it is an orphan and has to go), every drawn PNG is listed in its
script's "Frames:" header, and every entry there draws something. A new frame
starts as a line in "Frames:", and as a row in [Screenshots](screenshots.md).

**Never on a real project.** Screenshots and measurements run on the synthetic
fixture only: issue text can carry secrets. Need volume? The fixture has options
for it (`many`, `rich`, `people`); do not create issues in a frame with
`bd create`, which mints random ids and current dates.

**If you change the UI, re-run the affected frames, look at them, and commit the
PNGs**: they are the documentation's illustrations and regression fixtures at once.

## Benchmarks

`npm run bench` (`tests/bench-large.ts`) builds a project of 4000 issues with
kilobytes of text each, times `bd list` and `bd comments` alone and four at once,
then the handlers in-process: a cold tree, an unchanged tree, a card, the tree
after a restart answered from the disk cache, three cold trees at once, the
revision poll, and the bytes of an unchanged answer and of the delta after one
edit. It asserts only that every read answers inside
the daemon's 30 seconds and the tree from disk inside one; the rest is for reading. These numbers are where the
15-second read timeout, the 60-second `bd list` limit and the 25-second handler
budget come from.

`npm run bench:open` (`tests/bench-open.mjs`) registers the same kind of project in
Paseo and times what a user waits for in the web app: from the click to the first
row of the tree when the panel is opened cold (right after a plugin reload, in a
fresh browser), warm (the tab closed and opened again), as a second tab from the
"+" menu, after switching to another tab and back, from the view switch to the
drawn charts, and after a plugin reload with the tab open. For each case it also
counts the `beads.*` requests and the bytes of their answers, read from the page's
WebSocket frames, and lists the answer sizes. Each of three runs (`--runs`) starts
from a plugin reload; the table shows medians. `--n`, `--keep` and `--dir` work as
in `npm run bench`, and a fixture kept by one can be reused by the other.

---

[← Documentation index](README.md) · [Project README](../README.md)
