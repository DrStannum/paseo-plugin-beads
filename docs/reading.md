# How reading works

**English** · [Русский](ru/reading.md)

How a workspace becomes a project, one call per snapshot, a change marker that survives Dolt, the 30-second RPC budget, what the daemon and the panel keep when `bd` fails, and the boundaries every reading call runs inside.

**The workspace is resolved by the daemon.** Every RPC carries a workspace id and
nothing else that names a place. The plugin's server half asks the daemon for that
workspace (`workspaces.ref(id).refresh()`), takes its directory, and walks up from
there to the nearest `.beads`, the way `bd` does. A path the client sends is never
used, so the panel cannot be turned into "run `bd` anywhere": an unknown or
archived workspace answers `unknown_workspace`, a directory with no beads project
`no_beads`. A `.beads` directory that holds none of beads' own files (some other
tool's leftover) is skipped on the way up.

**One call per snapshot.** `bd list --all -n 0 --json` returns everything at once,
descriptions and links included, so the card needs no separate `bd show`. The
snapshot is cached in the daemon and rebuilt only when the revision changes;
`bd comments` is the one extra call, made when a card with comments is opened, and
its answer is cached on the snapshot.

**One load at a time.** Per project there is never more than one `bd list`
running. Requests that arrive while it runs (a poll, a card, a search) wait for it
and share its answer. If the revision moved or a write landed after it started,
they wait it out and start exactly one fresh load, so no caller is handed data
from before its own write.

**The 30-second budget and `busy`.** The Paseo daemon gives a plugin RPC 30
seconds. A reading handler waits for `bd` at most 25 seconds; if the load is not
done by then it answers `busy`, and the load keeps running in the background and
lands in the cache. The panel retries a `busy` answer after a second and a half,
and the next try is usually served from the cache. The full `bd list` has its own
60-second limit for exactly this reason: on a large project it may outlive one RPC
and still finish for the next. Every other reading `bd` call has 15 seconds.

**A failed read keeps the last good copy.** When `bd list` fails (a timeout, a
locked database, unparseable output, a non-zero exit) the daemon tries once more
after 300 ms (not for a timeout, an oversized answer or a missing `bd`: a second
try would only cost the same again). If that fails too and the project has loaded
before, `beads.tree`, `beads.issue` and `beads.search` answer from the last good
snapshot marked `stale`; only a project that has never loaded gets the error
itself, as an empty state. The failure stands for its revision for 5 seconds, so a
broken `bd` does not cost a spawn per request. Each failed load leaves one line in
the plugin's log (the error code, the exit status, whether it timed out, the first
line of `bd`'s stderr capped at 200 characters, never issue text) and a
`recovered` line once a load succeeds again.

**Asking without downloading.** The panel polls `beads.revision`, which only stats
files and never runs `bd`; besides the revision it carries the export state and
the last failed load. When the revision moves, the panel asks `beads.tree` with
the revision it already holds (`have`); an unchanged snapshot answers
`unchanged` with the counts and no rows, instead of the same megabytes again. The
Refresh button, Retry and the reload after a write always ask for the full tree.

**The panel keeps what it has.** The last good tree of each workspace and the
cards opened in it stay in the client's memory (react-query's cache, up to eight
workspaces), so reopening the panel or switching back draws the list at once and
checks in the background. Only memory: nothing goes to storage, because issue
text can carry secrets. A failed refresh never empties the list: the rows stay
under a "Data may be out of date" strip with the reason and a **Retry** button; a
card whose reload failed stays up marked "May be out of date". Each failed poll
round doubles the wait before the next one, up to 5 minutes (or the chosen
interval, if that is longer), and the first success restores the chosen interval.

**One snapshot, three layouts.** The tree, the board and the charts are all laid
out in the client from the rows already in hand, after the same filters, the same
search and the same sort, so switching views costs no call. The lane counts, the
"N more" pages and every chart are computed there too.

**The change marker is sizes, not mtime.** Dolt updates its manifest's mtime on
every *read*, so polling by mtime would see the plugin's own reads as changes and
run `bd` forever. File sizes under the embedded Dolt store move only on writes;
the revision is computed from those plus the size and mtime of `issues.jsonl`.

**stdout and stderr do not mix.** `bd` writes warnings to stderr; only stdout is
parsed, and the first warning surfaces in the header as a ⚠ line.

**Boundaries.** Every reading call runs `bd` with `--readonly`, through an argv
array and never a shell, with a timeout and a cap on the size of its output
(64 MiB). Reads and writes are separate RPCs: only `beads.edit`, `beads.create`,
`beads.comment`, `beads.export` and `beads.sync` may run a writing subcommand, and
that separation is verified by running the handlers against a recording `bd` stub,
not just by reading the source (see [Development and tests](development.md)).

**The RPCs at a glance.**

| RPC | Runs `bd`? | Answers |
|---|---|---|
| `beads.health` | when the snapshot is out of date | mode, where `.beads` is, whether `bd` exists |
| `beads.revision` | never | revision, export state, last load error |
| `beads.job-status` | never | the state of the background export or sync |
| `beads.tree` | when the snapshot is out of date | rows, counts, revision, `stale`; or `unchanged` with counts when `have` matches |
| `beads.issue` | `bd comments`, once per snapshot and issue | the full card, `stale` |
| `beads.search` | when the snapshot is out of date | matching ids, `stale` |

Any of the reading RPCs can also answer `busy` (see above) or a failure code such
as `unknown_workspace`, `no_beads`, `not_initialized` or `no_bd`.

---

[← Documentation index](README.md) · [Project README](../README.md)
