# Documentation

**English** · [Русский](ru/README.md)

The full description of the plugin, split by subject. The
[project README](../README.md) is the short version: what it is, how to install it,
and the highlights.

## Using it

- **[What the panel does](features.md)**: where the panel lives, the tree, the
  board, the charts, columns and sorting, search and filters, the card, comments,
  the settings page, editing, creating, Sync, two-card mode, the narrow layout,
  auto-refresh, the platforms and the two interface languages.
- **[Two modes: `bd` and `jsonl`](modes.md)**: where the data comes from, how the
  mode is decided, and what the read-only jsonl fallback cannot do.
- **[Screenshots](screenshots.md)**: the whole interface in both themes and both
  languages.

## How it works

- **[How reading works](reading.md)**: how the workspace becomes a project, one
  call per snapshot, the change marker, the 30-second RPC budget and `busy`, what
  the daemon and the panel keep when `bd` fails, and the boundaries every reading
  call runs inside.
- **[How writing works](writing.md)**: what can be changed and what cannot, why no
  git commit is ever created, how Sync reconciles the file and the database, and
  why the export to `issues.jsonl` runs in the background.
- **[Privacy and issue text](privacy.md)**: what leaves the host, and the rules
  that keep issue text out of markup, logs and screenshots.
- **[Design notes](design-notes.md)**: where the colours come from and why none of
  them carries the message alone.

## Working on it

- **[Development and tests](development.md)**: the test suites, the screenshot
  harness and what each one needs.
- **[Contributing](../CONTRIBUTING.md)**: the invariants a change has to respect.
- **[Security policy](../SECURITY.md)**: how to report a vulnerability, and what
  the plugin is trusted with.
- **[Changelog](../CHANGELOG.md)**: released versions.
