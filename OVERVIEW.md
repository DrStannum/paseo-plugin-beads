Beads shows the issues of the open workspace's [beads](https://github.com/gastownhall/beads) tracker in a tab of the workspace: the issue tree on one side and the selected issue's card on the other, with every property, the text blocks rendered as Markdown, linked issues and comments. The same list can also be read as a board with a lane per status, or as charts.

## Setup

The plugin runs on the daemon, so the `bd` command has to be on the daemon host's PATH. The workspace directory, or one of its parents, needs a `.beads` directory, the same rule `bd` follows. Open the Beads tab from the + menu over the workspace's tabs, with "Open Beads" or "Open Beads board" in the Command Center, or from the Beads button in the workspace header.

When a project has only `.beads/issues.jsonl` and no database, the panel reads that file and stays read-only.

## What you can do

- Browse the hierarchy, sort and choose columns, filter by status, type, priority, readiness, creation date, tags and assignee, and search titles and issue text.
- Create issues and sub-issues, edit their fields, change the status from the card or by moving a card across the board, and post comments.
- Read charts of the filtered issues: breakdowns, the work over time (cumulative flow, pace, waiting and working time, predictability, cohorts) and a page per assignee and per author. Pressing a bar filters the list.
- Sync `issues.jsonl` and the database both ways. Older data never overwrites newer.
- Follow the links between cards and come back with Back. To read two cards side by side, open a second Beads tab and split it beside the first.
- Keep your own work in the explorer: a compact panel lists the issues assigned to you that are in progress or ready, with counts and a search, and a click opens the issue in the tab.
- Use it in a narrow tab or on a phone: the list first, then the picked card in its place, with a way back.

## Settings

The plugin's settings page holds your name and the refresh interval. The name signs your comments and enables "Assign to me". Both settings are stored on the daemon host and shared by every client of it.

## What it reads and writes

Reads always run `bd` in read-only mode. Writes go through a fixed set of `bd` subcommands: create, update, close, reopen, comment, import and export. The plugin never deletes issues and never makes git commits. The project is found from the workspace by the daemon. The plugin sends nothing outside the host, and its logs never contain issue text. So that the tab opens at once after a restart, the daemon keeps the last list of each project in its data directory on the host, readable by its owner only.

## Limits

- A request may run for up to 30 seconds. On a very large project the first load can take longer; it carries on in the background and the panel asks again until it is done.
- In a phone-sized window Paseo has no explorer, so the explorer panel is not there; the Beads button in the header sheet opens the tab.
- The interface is in English and Russian.
- On the web and in the desktop app everything works. On iOS and Android charts are static pictures and a board card is moved with a long press menu; these builds have not been tested on devices yet.
