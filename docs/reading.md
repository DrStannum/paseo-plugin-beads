# How reading works

**English** · [Русский](ru/reading.md)

How a workspace becomes a project, one call per snapshot, the copy kept on disk across restarts, only what moved on the wire, one shared cache and one poll in the app, a change marker that survives Dolt, the 30-second RPC budget, what the daemon and the panel keep when `bd` fails, what it all costs on a large project, and the boundaries every reading call runs inside.

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

**The snapshot survives a restart.** After every good load, once the reply has
gone, the daemon writes the snapshot to a file under `~/.paseo/plugin-data/beads/`
(under `$PASEO_HOME` if that is set), atomically: a temporary file, flushed, then
renamed over the old one, so a crash leaves the previous copy or the new one,
never half of either. A failed load is never saved, and a snapshot over 64 MB is
not saved at all (an older file for that project goes too, so a restart never
serves something ever older). The first request for a project after a plugin
reload or a daemon restart reads that file back. If the revision still matches,
it is the current snapshot and no `bd` runs. If it moved, the file stands in: the
tree, the card and the search answer from it at once, while exactly one `bd list`
runs behind it; the next tree the panel asks for brings the fresh rows, as a delta
from the copy it holds (see below). A write never plans against that older copy:
an edit after a restart waits for a fresh load. The first `beads.revision` of a
project, the cheap poll every open panel starts with, warms it the same way after
replying, so the tree is often ready before it is asked for. A broken or foreign
file reads as nothing and is deleted; the project then loads cold, as before.
The housekeeping runs a little after the plugin starts: a project not opened for
30 days goes, past 256 MB in all the least recently used ones go, and archiving a
workspace in Paseo removes its project's file unless another workspace still opens
the same `.beads`. Who can read the files is in
[Privacy and issue text](privacy.md).

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

**Only what moved.** A client that also says it can apply deltas (`deltas: true`)
gets one of three answers. `unchanged` shrinks to the revision and the mode, a
few dozen bytes. If the revision moved and the server still remembers the rows of
the one the client holds, the answer is a delta: the rows changed or added since
that revision (`base`) and the ids removed — one edit on a 4000-issue project is a
row or two, not megabytes. Otherwise — the first load, a revision the server
never handed out or has forgotten, more than max(50, 20%) of the rows moved, or a
stale answer — it is the full set as before. The server keeps, per project, a
short hash of every row for the last 8 revisions it answered with, and for the
disk copy a restarted plugin read back, so a delta works across a plugin reload
too. Nothing in it is issue text, and none of it is logged. The panel always
asks with `deltas` (the reload after a write too, so its answer becomes the next
base) and lays a delta only over the revision it was cut from; on any other one it
asks again in full.

**The panel keeps what it has.** The last good tree of each workspace and the
cards opened in it stay in the client's memory (react-query's cache, up to eight
workspaces), so reopening the panel or switching back draws the list at once and
checks in the background. That cache is one per plugin installation in Paseo,
shared by every Beads tab, a copy in the explorer and every workspace of the host;
a tree in it counts as fresh until the revision moves, so a second tab of the same
workspace shows the rows without asking for them. The revision poll runs once per
workspace however many copies are mounted (Paseo keeps hidden tabs mounted), stops
with the last one, and looks at once when the panel comes back after nobody showed
the workspace. While newer rows are on their way (the poll saw the revision move,
a refresh is in flight, or the server is still loading `bd` behind a disk copy) a
quiet "Refreshing…" sits by the title; it shows only once a refresh has lasted
0.4 s and never on a poll that finds nothing new. The new rows then replace the
old ones in place: the selected issue, the open branches and the scroll of the
tree and the board stay where they were. In the app this is memory only: the
client writes no issue text to the device's storage, because issue text can carry
secrets (the tab state holds ids, filters and layout); the one copy on disk is the
daemon host's, above. A failed refresh never empties the list: the rows stay
under a "Data may be out of date" strip with the reason and a **Retry** button; a
card whose reload failed stays up marked "May be out of date". Each failed poll
round doubles the wait before the next one, up to 5 minutes (or the chosen
interval, if that is longer), and the first success restores the chosen interval.

**One snapshot, three layouts.** The tree, the board and the charts are all laid
out in the client from the rows already in hand, after the same filters, the same
search and the same sort, so switching views costs no call. The lane counts, the
"N more" pages and every chart are computed there too.

**What it costs, measured.** On a synthetic project of 4016 issues with kilobytes
of text each (`bd list` prints 14.6 MB; the tree answer is 2 MB), in Paseo web on a
shared VM (load 3–5), medians of three runs of `npm run bench:open` (and `npm run
bench` for the server's own lines, see [Development and tests](development.md)),
before the disk snapshot, the deltas and the shared client cache, and after them.
A time is from the click to the first frame that shows a row.

| | Before | After |
|---|---|---|
| Open after a plugin reload (cold) | 3.6 s (a full `bd list`) | 1.3 s (the disk snapshot; `bd` checks behind it) |
| Open of a project never loaded | 3.4 s | 3.7 s (the same `bd list`) |
| Open again after closing the tab (warm) | 374 ms, `beads.tree` "unchanged" 619 B | 345 ms, no `beads.tree` (one `beads.revision`, 390 B) |
| A second tab from "+" | 345 ms, 619 B | 242 ms, nothing asked |
| Another tab and back | 204 ms | 157 ms |
| Switch to the charts | 124 ms | 131 ms |
| An edit outside the panel, until the poll's tree answer is in | 3.0 s, the full 2 MB | 2.6 s (`bd list`), a delta of 1.2 kB |
| The tab open through a plugin reload: rows back after the reload itself | 1.7 s | none: back before the CLI reports the plugin running |
| `beads.tree` "unchanged" | 619 B | 70 B |
| The tree after a restart, in the server | — | 271 ms from disk, no `bd` |
| One save of the disk snapshot (blocks the plugin) | — | 210–280 ms, a 13.7 MB file |

Where the rest goes. Of the warm open, Paseo itself takes about 160 ms on this VM
(the same open with a panel that draws one empty row: 141–233 ms), and its styling
engine rebuilds the page's whole stylesheet each time a style appears for the first
time or the last element using one goes; the panel's own share is about 60 ms for
the first render (header, toolbar, the sorted and filtered tree of 4000 rows) and
about 80 ms for the rows that fit the window. Coming back to a tab costs the panel
nothing: a hidden tab keeps its rows. The cold open from disk splits into about
0.5–0.9 s until the 2 MB answer is in the page (reading the 14 MB snapshot back,
indexing it, and the trip through the daemon) and about 0.4–0.5 s to take it in
and draw it. The charts are laid out in the client from the rows already there and
cost no call, so they need no aggregates from the server.

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
| `beads.tree` | when the snapshot is out of date | rows, counts, revision, `stale`; or `unchanged` with counts when `have` matches; with `deltas`, a delta (`upsert`, `removed`) from `have` |
| `beads.issue` | `bd comments`, once per snapshot and issue | the full card, `stale` |
| `beads.search` | when the snapshot is out of date | matching ids, `stale` |

Any of the reading RPCs can also answer `busy` (see above) or a failure code such
as `unknown_workspace`, `no_beads`, `not_initialized` or `no_bd`.

---

[← Documentation index](README.md) · [Project README](../README.md)
