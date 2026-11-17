# Changelog

**English** · [Русский](CHANGELOG.ru.md)

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - unreleased

The first version: a port of
[cloudcli-plugin-beads](https://github.com/DrStannum/cloudcli-plugin-beads), the
beads tab for CloudCLI UI, to a Paseo workspace panel. Everything that tab does is
here: the tree, the card, search and filters, columns and sorting, the board, the
four chart readings, editing, creating, comments, Sync, two-card mode, the narrow
layout, auto-refresh and both languages. Its tests were carried over to the
handlers and the pure logic, and its screenshots are now taken in the real Paseo
web app.

### Added

- A workspace panel (in the workspace and in the explorer), a Command Center
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

[0.1.0]: https://github.com/DrStannum/paseo-plugin-beads
