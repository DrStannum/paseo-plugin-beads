// @ts-check
/**
 * A synthetic beads project for the screenshots.
 *
 * Carried over from the CloudCLI version of this plugin, where it fed a mock
 * backend; here tests/fixture/build.mjs materialises it as a real beads project
 * (or a bare issues.jsonl) that Paseo opens for the duration of a run.
 *
 * Deliberately not a snapshot of a live project: issue text can carry secrets,
 * and the screenshots are committed. Everything here is invented, but the
 * shapes are real — hierarchical dotted ids, a wide and shallow tree,
 * blockers, discovered-from links, labels, all five statuses and markdown
 * bodies that exercise every branch of the renderer.
 */

/** @param {string} id @param {any} extra */
function issue(id, title, extra = {}) {
  return {
    id,
    title,
    status: 'open',
    priority: 2,
    issue_type: 'task',
    parent: null,
    labels: [],
    assignee: null,
    owner: 'sam@example.com',
    created_at: '2026-07-14T12:25:31Z',
    updated_at: '2026-07-30T09:12:00Z',
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    blockers: [],
    ready: false,
    ...extra,
  };
}

const ISSUES = [
  issue('demo-a1', 'Permissions: one model for object × action', {
    issue_type: 'epic', priority: 1, labels: ['area:ui', 'sec:roles'], ready: true,
  }),
  issue('demo-a1.1', 'Audit the entities and write the model spec', {
    parent: 'demo-a1', issue_type: 'task', priority: 1, status: 'closed', labels: ['sec:roles'],
    dependent_count: 2, comment_count: 2,
  }),
  issue('demo-a1.2', 'Permission matrix: tri-state toggles per role', {
    parent: 'demo-a1', issue_type: 'feature', priority: 1, status: 'in_progress',
    labels: ['area:ui'], assignee: 'alex@example.com', dependency_count: 1, comment_count: 2, dependent_count: 1,
  }),
  issue('demo-a1.3', 'Manager group shows a check icon instead of controls', {
    parent: 'demo-a1', issue_type: 'task', priority: 1, labels: ['area:ui', 'sec:roles'],
    blockers: ['demo-a1.2'], dependency_count: 1,
  }),
  issue('demo-a1.4', 'Roles API returns the effective permission set', {
    parent: 'demo-a1', issue_type: 'task', priority: 2, ready: true, labels: ['area:api'],
  }),
  issue('demo-a1.5', 'Toggling a permission does not persist on reload', {
    parent: 'demo-a1', issue_type: 'bug', priority: 0, ready: true, labels: ['area:ui'],
    assignee: 'alex@example.com', comment_count: 1,
  }),

  issue('demo-b7', 'Booking calendar: drag & drop between resources', {
    issue_type: 'epic', priority: 2, labels: ['area:calendar'],
  }),
  issue('demo-b7.1', 'Drag layer keeps the pointer offset on touch', {
    parent: 'demo-b7', issue_type: 'bug', priority: 1, ready: true, labels: ['area:calendar'],
  }),
  issue('demo-b7.2', 'Snap a dropped booking to the 15-minute grid', {
    parent: 'demo-b7', issue_type: 'feature', priority: 2, status: 'deferred', labels: ['area:calendar'],
  }),
  issue('demo-b7.3', 'Cross-resource move rewrites the wrong slot', {
    parent: 'demo-b7', issue_type: 'bug', priority: 0, status: 'blocked',
    blockers: ['demo-b7.1'], dependency_count: 1, labels: ['area:calendar'],
  }),
  issue('demo-b7.3.1', 'Repro: two resources, overlapping bookings', {
    parent: 'demo-b7.3', issue_type: 'chore', priority: 3, status: 'closed',
  }),

  issue('demo-c2', 'Nightly export to the accounting system', {
    issue_type: 'epic', priority: 3,
  }),
  issue('demo-c2.1', 'Retry policy for a failed export batch', {
    parent: 'demo-c2', issue_type: 'task', priority: 3, ready: true,
  }),
  issue('demo-c2.2', 'Decide: push export or pull by the accounting side', {
    parent: 'demo-c2', issue_type: 'decision', priority: 2, status: 'closed',
  }),
  issue('demo-d9', 'Upgrade the runtime to Node 22', {
    issue_type: 'chore', priority: 4, status: 'deferred', created_at: '2026-05-02T08:00:00Z',
  }),
  issue('demo-e4', 'Search returns closed issues on an empty query', {
    issue_type: 'bug', priority: 2, ready: true, comment_count: 1, created_at: '2026-08-01T10:30:00Z',
  }),
];

const DESCRIPTION = `The owner group always has full access, so it is not editable. Instead of
disabled toggles we show a single check icon meaning **access granted**.

Rules:

- [x] the owner column renders an icon, never a toggle group
- [ ] every other role keeps its tri-state control
- nested detail
  - the effective value for the owner is always \`allow\`

See [the permissions note](https://example.com/notes/permissions) for the background.`;

const DESIGN = `\`apps/web/src/admin/Permissions.tsx\` currently renders a tri-state toggle with
\`disabled={role === "OWNER"}\`. Replace that branch:

\`\`\`tsx
{role === 'OWNER'
  ? <CheckIcon aria-label="access granted" />
  : <ToggleGroup value={value} onChange={onChange} />}
\`\`\`

Keep both layouts (cards on narrow, table on wide) in sync.`;

const CRITERIA = `| case | expected |
|---|---|
| role = OWNER | check icon, no interactive control |
| other roles | toggle group as before |

> A component test asserts both branches; the manual step is a visual check
> that the owner column has icons and no buttons.`;

const NOTES = `## Source

Epic demo-a1, sub-epic B. Owner's wording: "the manager group cannot be edited —
don't disable the buttons, hide them and leave one check icon".

## Related files

- \`apps/web/src/admin/Permissions.tsx\`
- \`apps/web/src/admin/permissionsModel.ts\`

Raw HTML in issue text renders as text: <script>alert('nope')</script>`;

const CARDS = {
  'demo-a1.3': {
    id: 'demo-a1.3',
    title: 'Manager group shows a check icon instead of controls',
    description: DESCRIPTION,
    design: DESIGN,
    acceptance_criteria: CRITERIA,
    notes: NOTES,
    status: 'open',
    priority: 1,
    issue_type: 'task',
    owner: 'sam@example.com',
    assignee: null,
    external_ref: 'ACME-1421',
    spec_id: null,
    labels: ['area:ui', 'sec:roles'],
    created_at: '2026-07-14T12:25:31Z',
    created_by: 'Sam Okoye',
    updated_at: '2026-07-30T09:12:00Z',
    started_at: null,
    closed_at: null,
    close_reason: null,
    defer_until: null,
    parent: 'demo-a1',
    dependency_count: 1,
    dependent_count: 0,
    comment_count: 1,
    ready: false,
    blockers: ['demo-a1.2'],
    mode: 'bd',
    commentsAvailable: true,
    comments: [
      {
        id: 'c1',
        author: 'Alex Perez',
        created_at: '2026-07-29T16:40:00Z',
        text: 'Blocked until the toggle group lands — the icon branch shares its layout.\n\nOnce `demo-a1.2` is merged this is a ~20 line change.',
      },
    ],
    relations: {
      parent: { id: 'demo-a1', type: 'parent-child', title: 'Permissions: one model for object × action', status: 'open', issue_type: 'epic', missing: false },
      children: [],
      blockedBy: [{ id: 'demo-a1.2', type: 'blocks', title: 'Permission matrix: tri-state toggles per role', status: 'in_progress', issue_type: 'feature', missing: false }],
      blocking: [],
      discoveredFrom: [{ id: 'demo-a1.1', type: 'discovered-from', title: 'Audit the entities and write the model spec', status: 'closed', issue_type: 'task', missing: false }],
      discovered: [],
      other: [{ id: 'demo-a1.4', type: 'relates-to', title: 'Roles API returns the effective permission set', status: 'open', issue_type: 'task', missing: false, direction: 'out' }],
    },
  },
};

/**
 * Two more cards so the focus mode has somewhere to go: pinning demo-a1.3 on
 * the left and clicking its parent or its blocker must open a real card, not
 * a "could not load" stub.
 */
CARDS['demo-a1'] = {
  id: 'demo-a1',
  title: 'Permissions: one model for object × action',
  description: `One permission model across the product: every screen is an **object**,
every button an **action**, and a role is a matrix of the two.

Sub-epics:

1. audit and spec
2. the matrix UI
3. the API side`,
  design: null,
  acceptance_criteria: null,
  notes: 'Owner wants the matrix shipped before the API rewrite.',
  status: 'open',
  priority: 1,
  issue_type: 'epic',
  owner: 'sam@example.com',
  assignee: null,
  external_ref: null,
  spec_id: null,
  labels: ['area:ui', 'sec:roles'],
  created_at: '2026-07-14T12:20:00Z',
  created_by: 'Sam Okoye',
  updated_at: '2026-07-30T09:12:00Z',
  started_at: null,
  closed_at: null,
  close_reason: null,
  defer_until: null,
  parent: null,
  dependency_count: 0,
  dependent_count: 0,
  comment_count: 0,
  ready: true,
  blockers: [],
  mode: 'bd',
  commentsAvailable: true,
  comments: [],
  relations: {
    parent: null,
    children: [
      { id: 'demo-a1.1', type: 'parent-child', title: 'Audit the entities and write the model spec', status: 'closed', issue_type: 'task', missing: false },
      { id: 'demo-a1.2', type: 'parent-child', title: 'Permission matrix: tri-state toggles per role', status: 'in_progress', issue_type: 'feature', missing: false },
      { id: 'demo-a1.3', type: 'parent-child', title: 'Manager group shows a check icon instead of controls', status: 'open', issue_type: 'task', missing: false },
      { id: 'demo-a1.4', type: 'parent-child', title: 'Roles API returns the effective permission set', status: 'open', issue_type: 'task', missing: false },
      { id: 'demo-a1.5', type: 'parent-child', title: 'Toggling a permission does not persist on reload', status: 'open', issue_type: 'bug', missing: false },
    ],
    blockedBy: [],
    blocking: [],
    discoveredFrom: [],
    discovered: [],
    other: [],
  },
};

CARDS['demo-a1.2'] = {
  id: 'demo-a1.2',
  title: 'Permission matrix: tri-state toggles per role',
  description: `A row per object, a column per action, a tri-state toggle in each cell:
\`allow\` / \`deny\` / \`inherit\`.

- keyboard reachable, one tab stop per row
- the header row is sticky while the matrix scrolls`,
  design: 'Shares its layout with the check-icon branch of demo-a1.3.',
  acceptance_criteria: null,
  notes: null,
  status: 'in_progress',
  priority: 1,
  issue_type: 'feature',
  owner: 'sam@example.com',
  assignee: 'alex@example.com',
  external_ref: null,
  spec_id: null,
  labels: ['area:ui'],
  created_at: '2026-07-14T12:22:00Z',
  created_by: 'Sam Okoye',
  updated_at: '2026-07-31T08:05:00Z',
  started_at: '2026-07-28T09:00:00Z',
  closed_at: null,
  close_reason: null,
  defer_until: null,
  parent: 'demo-a1',
  dependency_count: 1,
  dependent_count: 1,
  comment_count: 2,
  ready: false,
  blockers: [],
  mode: 'bd',
  commentsAvailable: true,
  comments: [
    { id: 'c2', author: 'Sam Okoye', created_at: '2026-07-28T10:12:00Z', text: 'Started. The sticky header is the fiddly part.' },
    { id: 'c3', author: 'Alex Perez', created_at: '2026-07-31T08:05:00Z', text: 'Matrix renders; the tri-state control still needs its keyboard story.' },
  ],
  relations: {
    parent: { id: 'demo-a1', type: 'parent-child', title: 'Permissions: one model for object × action', status: 'open', issue_type: 'epic', missing: false },
    children: [],
    blockedBy: [],
    blocking: [{ id: 'demo-a1.3', type: 'blocks', title: 'Manager group shows a check icon instead of controls', status: 'open', issue_type: 'task', missing: false }],
    discoveredFrom: [],
    discovered: [],
    other: [],
  },
};

/**
 * An epic whose children have children: the card's own list is one level deep,
 * but the tab holds the tree, so this is what a card of a multi-level branch
 * has to draw — and what the progress bar over the subtree is counted from.
 */
CARDS['demo-b7'] = {
  id: 'demo-b7',
  title: 'Booking calendar: drag & drop between resources',
  description: `Move a booking between resources by dragging it, with the same rules the
form dialog enforces:

- a drop outside working hours is refused, with the reason shown
- an overlapping drop asks before it rewrites anything`,
  design: null,
  acceptance_criteria: null,
  notes: null,
  status: 'open',
  priority: 2,
  issue_type: 'epic',
  owner: 'sam@example.com',
  assignee: null,
  external_ref: null,
  spec_id: null,
  labels: ['area:calendar'],
  created_at: '2026-07-02T09:00:00Z',
  created_by: 'Sam Okoye',
  updated_at: '2026-07-30T09:12:00Z',
  started_at: null,
  closed_at: null,
  close_reason: null,
  defer_until: null,
  parent: null,
  dependency_count: 0,
  dependent_count: 0,
  comment_count: 1,
  ready: false,
  blockers: [],
  mode: 'bd',
  commentsAvailable: true,
  comments: [
    { id: 'c4', author: 'Sam Okoye', created_at: '2026-07-20T11:00:00Z', text: 'Scope: dragging only. Resizing is a separate epic.' },
  ],
  relations: {
    parent: null,
    children: [
      { id: 'demo-b7.1', type: 'parent-child', title: 'Drag layer keeps the pointer offset on touch', status: 'open', issue_type: 'bug', missing: false },
      { id: 'demo-b7.2', type: 'parent-child', title: 'Snap a dropped booking to the 15-minute grid', status: 'deferred', issue_type: 'feature', missing: false },
      { id: 'demo-b7.3', type: 'parent-child', title: 'Cross-resource move rewrites the wrong slot', status: 'blocked', issue_type: 'bug', missing: false },
    ],
    blockedBy: [],
    blocking: [],
    discoveredFrom: [],
    discovered: [],
    other: [],
  },
};

/** Counts computed the same way the backend does. */
function counts(issues) {
  const byStatus = {};
  const byType = {};
  let ready = 0;
  let blocked = 0;
  for (const i of issues) {
    byStatus[i.status] = (byStatus[i.status] || 0) + 1;
    byType[i.issue_type] = (byType[i.issue_type] || 0) + 1;
    if (i.ready) ready++;
    if (i.blockers.length && i.status !== 'closed') blocked++;
  }
  return { total: issues.length, byStatus, byType, ready, blocked };
}

/**
 * A second, larger project used only by the dashboard shots.
 *
 * Kept apart from ISSUES on purpose: every other screenshot is counted off
 * the sixteen issues above, and growing that list would move every frame in
 * the suite. The builder adds this one only when asked for it (team: true).
 *
 * The dates are absolute rather than relative to today, and the shots that
 * use them freeze the clock at TEAM_NOW. A fixture that drifted with the
 * calendar would redraw its own axis every day and stop being a regression
 * fixture at all.
 *
 * Five people who move differently, because a dashboard that cannot tell them
 * apart is not worth drawing: someone steady, someone who works in bursts,
 * someone accumulating work they never close, someone who just arrived, and a
 * backlog nobody owns.
 */
export const TEAM_NOW = '2026-08-31T12:00:00Z';

const TEAM_MS = Date.parse(TEAM_NOW);

/** An absolute timestamp, given as days before TEAM_NOW. */
function ago(days, hour = 10) {
  const d = new Date(TEAM_MS - days * 86400000);
  d.setUTCHours(hour, 15, 0, 0);
  return d.toISOString();
}

/** @param {string} id @param {string} title @param {any} extra */
function teamIssue(id, title, extra = {}) {
  return {
    id, title,
    status: 'open', priority: 2, issue_type: 'task', parent: null,
    labels: [], assignee: null, owner: 'sam@example.com', created_by: null,
    created_at: null, updated_at: null, started_at: null, closed_at: null,
    dependency_count: 0, dependent_count: 0, comment_count: 0, blockers: [], ready: false,
    ...extra,
  };
}

/**
 * Who raised each issue.
 *
 * Deliberately not a copy of the assignee. beads keeps the author in its own
 * field, and on a real project the two are written to different conventions —
 * so the fixture has people who raise their own work, people whose work is
 * raised for them, and a backlog raised by somebody who is on nobody's row.
 * A dashboard that only ever saw author == assignee would not be exercising
 * the case that actually happens.
 *
 * @param {string|null} who the assignee, for the ones who raise their own
 */
function raisedBy(who) {
  if (who === 'dana@example.com' || who === 'ivan@example.com') return who;
  return 'dana@example.com';
}

/** Closed work: created, picked up, finished. */
function done(id, title, who, createdAgo, startedAgo, closedAgo, extra = {}) {
  return teamIssue(id, title, {
    assignee: who, created_by: raisedBy(who), status: 'closed',
    created_at: ago(createdAgo), started_at: startedAgo == null ? null : ago(startedAgo),
    closed_at: ago(closedAgo), updated_at: ago(closedAgo),
    ...extra,
  });
}

/** Work in hand: started, not finished. */
function doing(id, title, who, createdAgo, startedAgo, extra = {}) {
  return teamIssue(id, title, {
    assignee: who, created_by: raisedBy(who), status: 'in_progress',
    created_at: ago(createdAgo), started_at: ago(startedAgo), updated_at: ago(startedAgo),
    ...extra,
  });
}

/** Work not begun. Nobody's backlog is raised by somebody off the list. */
function todo(id, title, who, createdAgo, extra = {}) {
  return teamIssue(id, title, {
    assignee: who, created_by: who ? raisedBy(who) : 'sam@example.com',
    created_at: ago(createdAgo), updated_at: ago(createdAgo), ...extra,
  });
}

const TEAM_TITLES = [
  'Paginate the orders list', 'Cache the currency table', 'Retry a failed webhook',
  'Split the settings screen', 'Warn before leaving a draft', 'Batch the audit writes',
  'Collapse duplicate notifications', 'Move uploads off the request thread',
  'Rename the legacy status codes', 'Index the lookup by tenant',
  'Trim the onboarding checklist', 'Debounce the search box',
  'Backfill the missing thumbnails', 'Guard the import against empty rows',
  'Report the queue depth', 'Drop the unused feature flag',
  'Line up the empty states', 'Explain the expiry rule in place',
  'Keep the filter after a reload', 'Sort the exports by date',
];

const TEAM = [];

// Dana: steady. Two closes a week for ten weeks, the picture of a team that
// keeps up — and the only one whose sparkline should look flat and even.
for (let w = 0; w < 10; w++) {
  for (let n = 0; n < 2; n++) {
    const i = w * 2 + n;
    TEAM.push(done(`demo-td${String(i + 1).padStart(2, '0')}`, TEAM_TITLES[i % TEAM_TITLES.length],
      'dana@example.com', 74 - w * 7 + n, 72 - w * 7 + n, 70 - w * 7 + n,
      { issue_type: n ? 'task' : 'bug', priority: 2, labels: ['area:api'] }));
  }
}
// Ivan: bursts. Nine closes inside one week, then nothing for a month.
for (let i = 0; i < 9; i++) {
  TEAM.push(done(`demo-ti${String(i + 1).padStart(2, '0')}`, `${TEAM_TITLES[(i + 3) % TEAM_TITLES.length]} (${i + 1})`,
    'ivan@example.com', 60 - i, 45, 40 + (i % 5),
    { issue_type: 'chore', priority: 3, labels: ['area:ui'] }));
}
// Mei: taking on more than she finishes — one closed, six still open, the
// oldest held for two months. This is the row the reading exists to surface.
TEAM.push(done('demo-tm00', 'Unify the toast component', 'mei@example.com', 80, 78, 55,
  { issue_type: 'feature', priority: 1, labels: ['area:ui'] }));
for (let i = 0; i < 6; i++) {
  TEAM.push(doing(`demo-tm${String(i + 1).padStart(2, '0')}`, `${TEAM_TITLES[(i + 11) % TEAM_TITLES.length]} (rework)`,
    'mei@example.com', 70 - i * 8, 62 - i * 9,
    { issue_type: i % 2 ? 'bug' : 'feature', priority: i % 3, labels: ['area:ui'] }));
}
// Omar: just arrived. Two closes in the last fortnight and one in hand.
TEAM.push(done('demo-to01', 'Tidy the changelog script', 'omar@example.com', 20, 18, 12,
  { issue_type: 'chore', priority: 4 }));
TEAM.push(done('demo-to02', 'Fix the stale avatar cache', 'omar@example.com', 16, 14, 5,
  { issue_type: 'bug', priority: 2 }));
TEAM.push(doing('demo-to03', 'Document the deploy rollback', 'omar@example.com', 9, 4,
  { issue_type: 'task', priority: 3 }));
// Nobody's: a backlog that keeps growing and never moves.
for (let i = 0; i < 6; i++) {
  TEAM.push(todo(`demo-tb${String(i + 1).padStart(2, '0')}`, `${TEAM_TITLES[(i + 6) % TEAM_TITLES.length]} (backlog)`,
    null, 50 - i * 8, { priority: 3 + (i % 2) }));
}

// The awkward shapes the aggregates promise to survive. Each one is a real
// state beads can be in, not a hypothetical.
TEAM.push(
  // Closed the day it was raised, never marked as started.
  done('demo-tx01', 'Correct a typo in the invoice footer', 'dana@example.com', 25, null, 25,
    { issue_type: 'chore', priority: 4 }),
  // Reopened at some point: the close on record predates the start on record.
  done('demo-tx02', 'Handle a partial refund', 'ivan@example.com', 48, 6, 22,
    { issue_type: 'bug', priority: 1 }),
  // In progress by status, with nothing saying when it began.
  teamIssue('demo-tx03', 'Investigate the slow tenant lookup', {
    assignee: 'mei@example.com', status: 'in_progress',
    created_at: ago(35), updated_at: ago(11), issue_type: 'task', priority: 1,
  }),
  // No creation date at all — left out of every series, and counted as such.
  teamIssue('demo-tx04', 'Imported from the old tracker', {
    assignee: 'omar@example.com', status: 'open', issue_type: 'task', priority: 3,
  }),
  // Blocked, which the flow reads as work already begun.
  teamIssue('demo-tx05', 'Await the vendor SDK update', {
    assignee: 'dana@example.com', status: 'blocked',
    created_at: ago(40), started_at: ago(30), updated_at: ago(30),
    issue_type: 'task', priority: 2, blockers: ['demo-tx03'], dependency_count: 1,
  }),
);

export const TEAM_ISSUES = TEAM;

/** The second project's issues — see FIXTURE.other. */
const OTHER = [
  issue('docs-1', 'Write the getting-started page', { ready: true }),
  issue('docs-2', 'Screenshots for the settings panel', { status: 'in_progress', assignee: 'mei@example.com' }),
];

export const FIXTURE = {
  tree: {
    ok: true,
    mode: 'bd',
    root: '/home/sam/code/demo-shop',
    beadsDir: '/home/sam/code/demo-shop/.beads',
    prefix: 'demo',
    revision: 'preview000000000',
    counts: counts(ISSUES),
    warnings: [],
    issues: ISSUES,
  },
  cards: CARDS,
  /** The dashboard's own, larger project — merged in only when asked for. */
  team: TEAM_ISSUES,
  /**
   * The reader the explorer's frames are drawn for: the assignee of
   * demo-a1.2 and demo-a1.5, and of more with the `mine` fixture option.
   */
  reader: 'alex@example.com',
  /** The moment the dashboard shots pretend it is, so their axes hold still. */
  teamNow: TEAM_NOW,
  /**
   * A second, tiny project for the caching checks: switching to it and back
   * is how they prove an answer for the project just left is not drawn, and
   * that the one returned to comes back from memory without a spinner.
   */
  other: {
    ok: true,
    mode: 'bd',
    root: '/home/sam/code/demo-docs',
    beadsDir: '/home/sam/code/demo-docs/.beads',
    prefix: 'docs',
    revision: 'preview-docs0000',
    counts: counts(OTHER),
    warnings: [],
    issues: OTHER,
  },
  /** The issue the shots open, so the card is on screen in the screenshot. */
  selected: 'demo-a1.3',
  /** Branches the shots expand so the tree is not a flat list of roots. */
  expanded: ['demo-a1', 'demo-b7', 'demo-b7.3', 'demo-c2'],
};
