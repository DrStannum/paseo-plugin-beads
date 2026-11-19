# Screenshots

**English** · [Русский](ru/screenshots.md)

Every image here is a test artefact: `npm run preview` opens the real Paseo web
app against the local daemon, registers the synthetic fixture in `tests/fixture/`
as a workspace for the length of the run, and photographs the panel, so nothing
on this page comes from a live project. The page clock is held at a fixed moment
and the plugin's settings at their defaults, so a re-run only changes the pictures
of what really changed. Several of the runs also assert behaviour a picture cannot
show; see [Development and tests](development.md). Every PNG the run draws appears
on this page, and the test suite checks that it stays that way.

## The panel

| | |
|---|---|
| ![](../tests/preview-tree-light-en.png) | ![](../tests/preview-tree-dark-en.png) |
| Light theme, the defaults: the tree and the card of the selected issue | Dark theme |
| ![](../tests/preview-tree-light-ru.png) | ![](../tests/preview-tree-dark-ru.png) |
| Russian, light | Russian, dark |
| ![](../tests/preview-links-dark-en.png) | ![](../tests/preview-link-cols-dark-en.png) |
| The card of an epic: its children as a tree with a progress bar, and the comments | The column picker of a card's linked lists |
| ![](../tests/preview-jsonl-dark-en.png) | ![](../tests/preview-empty-en.png) |
| jsonl mode: the export only, read-only | A workspace with no beads project |
| ![](../tests/preview-empty-ru.png) | ![](../tests/preview-stale-en.png) |
| The same empty state in Russian | A refresh failed after a good load: the rows stay under the "may be out of date" strip |
| ![](../tests/preview-refreshing-en.png) | |
| Newer data on its way: "Refreshing…" by the title, the rows, open branches and the card stay | |

## Search, filters and columns

| | |
|---|---|
| ![](../tests/preview-filters-dark-en.png) | ![](../tests/preview-labels-light-ru.png) |
| The filter panel open, two filters on | The tag picker, searchable, with counts |
| ![](../tests/preview-chips-light-en.png) | ![](../tests/preview-columns-light-en.png) |
| Filters applied: the badge on the button and the removable chips | The column panel, Assignee and Updated turned on |
| ![](../tests/preview-search-dark-en.png) | ![](../tests/preview-search-key-en.png) |
| A full-text query: the daemon's hits in descriptions merged with the panel's own | A whole issue key typed in: that issue alone |
| ![](../tests/preview-assignee-menu-en.png) | |
| 45 assignees: the list scrolls, and Esc closes it | |

## Layout

| | |
|---|---|
| ![](../tests/preview-splitter-dark-en.png) | ![](../tests/preview-narrow-tree-en.png) |
| The card pane dragged wider with the splitter | A tab under 900 px: the tree alone |
| ![](../tests/preview-narrow-card-ru.png) | |
| …a picked issue: its card in the tree's place, "Tree" leads back | |

## The board

The same issues laid out by status, one lane per status the project uses. The
count in a lane header is the whole lane, not the cards drawn in it.

| | |
|---|---|
| ![](../tests/preview-board-light-en.png) | ![](../tests/preview-board-dark-en.png) |
| Light theme, nothing selected: the lanes take the width | Dark theme |
| ![](../tests/preview-board-light-ru.png) | ![](../tests/preview-board-dark-ru.png) |
| Russian, light | Russian, dark |
| ![](../tests/preview-board-selected-en.png) | ![](../tests/preview-board-more-en.png) |
| A card pressed: the issue card opens beside the board | A lane past the page size: 50 cards drawn, all counted, the rest behind "N more" |
| ![](../tests/preview-board-drag-en.png) | ![](../tests/preview-board-dropped-en.png) |
| Mid-drag: the card under the pointer, the target lane lit | After the drop: the card in its new lane, the status written by bd |
| ![](../tests/preview-board-jsonl-en.png) | ![](../tests/preview-board-narrow-ru.png) |
| jsonl mode: the same board, nothing moves | A narrow tab: narrower lanes, swiped sideways |

## Charts: breakdowns

Six breakdowns of exactly the filtered issues: assignee, status, priority,
readiness, type, tag.

| | |
|---|---|
| ![](../tests/preview-charts-light-en.png) | ![](../tests/preview-charts-dark-en.png) |
| Light theme | Dark theme |
| ![](../tests/preview-charts-light-ru.png) | ![](../tests/preview-charts-dark-ru.png) |
| Russian, light | Russian, dark |
| ![](../tests/preview-charts-barclick-en.png) | |
| A bar pressed: its filter is on, the chip shows, every cut is recounted | |

## Charts: over time

How the work moved, on a larger fixture with a history and a team in it, with the
clock held still so the axis does not drift between runs. Each picture is the
whole page.

| | |
|---|---|
| ![](../tests/preview-flow-light-en.png) | ![](../tests/preview-flow-dark-en.png) |
| Light theme | Dark theme |
| ![](../tests/preview-flow-light-ru.png) | ![](../tests/preview-flow-dark-ru.png) |
| Russian, light | Russian, dark |
| ![](../tests/preview-flow-hidden-en.png) | |
| Closed issues hidden: nothing counts as done, and the page says so with the switch to hand | |

## Charts: assignees and authors

| | |
|---|---|
| ![](../tests/preview-people-light-en.png) | ![](../tests/preview-people-dark-en.png) |
| Assignees, light | Assignees, dark |
| ![](../tests/preview-people-light-ru.png) | ![](../tests/preview-people-dark-ru.png) |
| Assignees, Russian, light | Assignees, Russian, dark |
| ![](../tests/preview-person-dark-en.png) | ![](../tests/preview-person-light-ru.png) |
| One person's page | One person's page, Russian |
| ![](../tests/preview-authors-dark-en.png) | ![](../tests/preview-authors-light-ru.png) |
| Authors | Authors, Russian |
| ![](../tests/preview-author-light-en.png) | |
| One author's page: what they raised, at what pace, and of what kind | |

## Writing

| | |
|---|---|
| ![](../tests/preview-status-menu-dark-en.png) | ![](../tests/preview-status-menu-light-ru.png) |
| The card's status menu | The same in Russian, light |
| ![](../tests/preview-edit-light-en.png) | ![](../tests/preview-edit-dark-ru.png) |
| The edit form | The edit form, Russian, dark |
| ![](../tests/preview-edit-discard-en.png) | ![](../tests/preview-sub-issue-dark-en.png) |
| Closing the form with unsaved changes asks first | The card's +: a new issue with this one as its parent |
| ![](../tests/preview-create-dark-en.png) | ![](../tests/preview-create-light-ru.png) |
| New issue | New issue, Russian, light |
| ![](../tests/preview-comment-draft-dark-en.png) | ![](../tests/preview-comment-draft-light-ru.png) |
| A draft in the comment box, no name set | The same in Russian, light |
| ![](../tests/preview-comment-named-en.png) | ![](../tests/preview-jsonl-writes-dark-en.png) |
| With a name set: "Assign to me", and the hint says who the comment is from | jsonl mode: every write control is off, with the reason |
| ![](../tests/preview-export-running-ru.png) | ![](../tests/preview-sync-done-en.png) |
| Sync pressed: the badge while it runs | …and what the sync pulled in from the file |
| ![](../tests/preview-export-stale-en.png) | |
| A failed export: "issues.jsonl is out of date" with Export again | |

## Settings

| | |
|---|---|
| ![](../tests/preview-settings-dark-en.png) | ![](../tests/preview-settings-light-ru.png) |
| The plugin's page in Paseo's Settings | The same in Russian, light |

---

[← Documentation index](README.md) · [Project README](../README.md)
