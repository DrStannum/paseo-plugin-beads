# Changelog

**English** · [Русский](CHANGELOG.ru.md)

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.0] - 2026-11-19

The panel is rebuilt around Paseo's own windows, and it now opens from a cache.
In CloudCLI the plugin had a single tab, so it carried a small window manager
inside it: a second pinned card, an overlay card in a narrow tab, back and forward.
In Paseo the host owns tabs, splits, focus, closing and the saved layout, so those
parts are gone, and Beads is an ordinary tab of the workspace with a compact
companion panel in the explorer. And since `bd` is slow on a large project, a
plugin reload used to mean waiting for a full `bd list`, every open asked the
daemon again, and any change brought the whole snapshot; now the daemon keeps the
last snapshot on disk, the client keeps one cache per workspace, and a change
travels as a delta.

### Added

- **A Beads panel in the explorer** (`beads-explorer`), a compact view of its own
  rather than a smaller copy of the tab: your issues in progress and ready to
  start, their counts, and a search. A click opens the issue in the Beads tab. It
  reads the same cache as the tab, so opening it next to a loaded tab asks the
  daemon nothing.
- **Command Center items "Open Beads board" and "Open Beads in the explorer"**,
  next to "Open Beads". The board item brings up the Beads tab (the one already
  open, if there is one) and switches it to the board; where Paseo has no
  explorer (a phone-sized window) the explorer item opens the tab instead.
- **A Beads button in the workspace header**, shown only for a workspace that has a
  `.beads` project: a menu with Open Beads, Open Beads board and Open Beads in the
  explorer. A new RPC `beads.workspaces` tells which workspaces have one (a few
  file checks on the daemon, no `bd`).
- **A snapshot on the host's disk.** Each project's last good snapshot is kept in
  `$PASEO_HOME/plugin-data/beads/` (directory 0700, files 0600, named by a hash of
  the `.beads` path, written atomically). After a plugin reload or a daemon
  restart the panel is answered from it at once: if the revision still matches,
  `bd` is not run at all; if not, the old copy answers while one `bd list` runs
  behind it. The cache is warmed by the first `beads.revision`, dropped when the
  workspace is archived (unless another workspace uses the same `.beads`), and
  swept after 30 idle days or past 256 MB in total; a snapshot over 64 MB is not
  stored. See [How reading works](docs/reading.md) and
  [Privacy](docs/privacy.md).
- **Deltas in `beads.tree`.** The client sends the revision it holds; the answer is
  "unchanged" (70 bytes), a delta (changed, added and removed rows), or a full
  snapshot on a first open, an unknown base or a large gap.
- **One cache and one poll per workspace** in the client, shared by every Beads
  tab and the explorer panel: a second tab, a tab put back on screen or the
  explorer next to a loaded tab draw from it without a request.
- **A "Refreshing…" mark** in the header while newer rows load over the ones on
  screen. They take their place without resetting the selection, the open
  branches or the scroll.
- **`npm run bench:open`**: the time from the click to the first row in the real
  Paseo web app, by scenario, with the RPCs each one sends. `npm run bench` also
  times the cold open from disk and the delta, and prints the size of the disk
  file.

### Changed

- **One card, beside the tree.** The tab shows the tree (or the board) and one
  card; two things side by side are two Paseo tabs.
- **History is "Back" only.** Following a link from the card (or opening an issue
  from the charts or the editor) remembers the card you left, and Back returns to
  it; picking a row in the tree or on the board starts afresh.
- **A narrow tab navigates.** Below 900 px of its own width, or in Paseo's compact
  layout, the card takes the place of the list across the whole tab, the toolbar
  steps aside, and "Back to the list" / "Back to the board" returns with the
  selection and the scroll where they were.
- **The main Beads panel lives in the workspace only**; the explorer has its own
  panel (above) instead of a copy of the tab.
- **The tab's saved state has a version** (2). A tab saved by an older build is
  migrated field by field: a field that does not parse falls back to its default,
  and a field this build no longer has is dropped. The state is written a moment after it stops changing
  rather than on every keystroke, and flushed when the tab closes, the app goes
  to the background or the page unloads.

### Removed

- **Two-card mode**: pinning a card to the left in place of the tree and browsing
  its links in a second card beside it.
- **The Forward button** and the back/forward history behind it.
- **The card overlay** over a narrow tab.

### Fixed

- **A project's export state outlived its workspace.** A new project at the same
  path saw the old project's export error. It is now forgotten when the workspace
  is archived, and when the `.beads` directory is recreated at the same path.
- **A hidden board lost its sideways scroll**: its lanes were unmounted while the
  tab was hidden. The tree and the board now keep their rows while hidden.
- **Wording.** The hints that said "restart the panel" now say to reload the plugin
  in Paseo's settings (Plugins); the chart bar filters "the issues", not "the
  tab"; the empty-list hint names the "Show closed" button as it reads. In
  Russian the workspace, tab, panel and explorer are called what Paseo's Russian
  interface calls them.

### Performance

On a synthetic project of 4016 issues (`bd list` prints 14.6 MB, the tree answer is
2 MB), in Paseo web, medians of three runs. The full table and where the remaining
time goes are in [How reading works](docs/reading.md).

| | Before | After |
|---|---|---|
| Open after a plugin reload | 3.6 s | 1.3 s, from the disk snapshot |
| Open again after closing the tab | 374 ms, one `beads.tree` | 345 ms, no `beads.tree` |
| A second tab | 345 ms | 242 ms, no request |
| Another tab and back | 204 ms | 157 ms |
| An edit outside the panel, the poll's answer | the full 2 MB | a 1.2 kB delta |
| A tab kept open through a plugin reload | rows back 1.7 s after it | rows back before it ends |
| `beads.tree` "unchanged" | 619 B | 70 B |

The targets of under 300 ms warm and under 1 s cold from disk were not reached: of
the warm open, about 160 ms is Paseo opening a tab at all.

### Where this plugin differs from the CloudCLI plugin, on purpose

[cloudcli-plugin-beads](https://github.com/DrStannum/cloudcli-plugin-beads) stays
the reference for what the panel does with the data, for its texts in both
languages and for what its tests check. It is no longer the reference for the
windows:

- **Windows belong to Paseo.** Tabs, splits, focus, closing and the saved layout
  are the host's. The panel draws no window of its own: no second card, no
  overlay, no floating card. Where the CloudCLI tab pinned a second card, here
  you open a second tab or split.
- **The card stays beside the tree**, as in the reference, but a narrow tab is the
  plain navigation list → card → Back instead of an overlay, and the history keeps
  Back without Forward.
- **The explorer panel is new.** CloudCLI has no sidebar for plugins; here the
  explorer gets a compact view of your own work instead of a shrunken tab.
- **The ways in are Paseo's**: the **+** menu over the tabs, the Command Center and
  the header button, instead of CloudCLI's tab bar.
- **The cache is on the host's disk.** The CloudCLI plugin keeps its snapshot in
  memory, so every restart of its backend waits for a full `bd list`; in Paseo an
  RPC has 30 seconds and `bd list` on a large project can take longer, so the last
  snapshot is kept on the daemon's disk and answers at once.
- **Deltas and one shared cache.** After any change the CloudCLI tab is sent the
  whole snapshot again; here a change arrives as the rows that changed, and every
  Beads tab and the explorer panel of a workspace share one cache and one poll.

## [0.1.0] - unreleased

The first version: a port of
[cloudcli-plugin-beads](https://github.com/DrStannum/cloudcli-plugin-beads), the
beads tab for CloudCLI UI, to a Paseo workspace panel. Everything that tab does is
here: the tree, the card, search and filters, columns and sorting, the board, the
four chart readings, editing, creating, comments, Sync, two-card mode, the narrow
layout, auto-refresh and both languages. (Two-card mode and the narrow overlay
were removed in the next version, above, in favour of Paseo's own tabs.) Its tests were carried over to the
handlers and the pure logic, and its screenshots are now taken in the real Paseo
web app.

### Added

- A workspace panel (in the workspace and in the explorer; the next version gives
  the explorer a panel of its own), a Command Center
  item "Open Beads", and a settings page in Paseo's Settings.
- RPCs for reading (`beads.health`, `beads.revision`, `beads.tree`,
  `beads.issue`, `beads.search`) and writing (`beads.edit`, `beads.create`,
  `beads.comment`, `beads.export`, `beads.sync`, `beads.job-status`).
- iOS and Android paths: charts drawn as static pictures, a long-press "Move to"
  menu on board cards. Type-checked, not yet tried on a device.
- A benchmark on a large synthetic project (`npm run bench`).

### Changed against the CloudCLI plugin

Where Paseo works differently, or where the port fixed something on the way:

- **The project comes from the workspace.** The panel sends a workspace id, and
  the daemon resolves the directory itself; a path from the client is never
  accepted. An unknown or archived workspace answers `unknown_workspace`.
- **Settings live on the host.** Your name and the refresh interval are Paseo
  plugin settings, shared by every client of the daemon and edited on the
  plugin's settings page, instead of the browser's `localStorage`. The interval
  picker in the header writes the same setting.
- **What the panel remembers belongs to its tab.** Open branches, selection,
  filters, the search query, columns, sort, view and card width are kept in the
  Paseo tab's state, per workspace, instead of `localStorage` keys per project.
- **The 30-second RPC budget.** A reading handler waits for `bd` at most 25
  seconds and otherwise answers `busy`; the load carries on and lands in the
  cache, and the panel retries. The full `bd list` gets its own 60-second limit so
  it can outlive one RPC on a large project; other reads keep 15 seconds.
- **Writes and the export.** The background export is requested just before the
  reply (an RPC has no "after the reply"). A write whose reload does not fit in the
  budget answers `ok: true` with `issue: null, reloading: true`. Export and Sync
  are started by their RPC and followed by polling `beads.job-status` and
  `beads.revision`.
- **`syncing` is reported for the whole Sync.** In the CloudCLI plugin the flag
  was true only while the import half ran, so it was almost never seen.
- **The fallback identity is `paseo-beads`** (was `cloudcli-beads`).
- **Stopping the plugin** kills the reading `bd` processes and lets a writing one
  finish.
- **Links in Markdown.** `http(s)` links open through Paseo's external-link
  handler, `mailto` through the system; a relative link is shown as text, since
  inside Paseo there is nothing for it to lead to.
- **The card cache** has no 300-card cap: cards stay in the client's query cache
  for 30 minutes after their last use. The highlight of a changed row is a
  steady tint for a few seconds rather than a fade.
- **Closing the edit form asks first whenever anything was typed**, also in a new
  issue with no title yet.
- **"Assign to me" is in the card only**, not in the edit form.
- **Every save confirms its export.** After an edit, a new issue or a comment the
  header badge shows "updating issues.jsonl…" and then a brief confirmation. The
  CloudCLI plugin showed it only when a poll happened to catch the export
  running.
- **The "Data may be out of date" strip names the problem in words** ("beads is
  not set up in this project", "bd took too long to answer") instead of printing
  the raw error code, which moved to its tooltip.
- **All charts on the Over time page share one time axis.** The cumulative flow
  used to run edge to edge while the other charts put each step in the middle of
  its slot, so the same date stood at different places on the same page.
- **The children progress bar's legend uses the bar's own colours.** Its status
  dots did not match the segments (closed was a solid ink dot over a grey
  segment, open a ring over a light one).
- **The interface language follows the Paseo app's setting.**
- **The over-time aggregation** returns an empty series instead of failing when
  every creation date lies in the future.

[Unreleased]: https://github.com/DrStannum/paseo-plugin-beads/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/DrStannum/paseo-plugin-beads/releases/tag/v0.2.0
[0.1.0]: https://github.com/DrStannum/paseo-plugin-beads
