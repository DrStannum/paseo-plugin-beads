Beads shows the issues of the open workspace's [beads](https://github.com/gastownhall/beads)
tracker in a workspace panel: the issue tree on one side and the selected issue's card on
the other.

It needs the `bd` command on the daemon host's PATH and a `.beads` directory in the
workspace or one of its parents. The plugin reads with `bd --readonly`, writes only through
a fixed set of `bd` subcommands, never deletes issues and never makes git commits.
