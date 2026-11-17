# Security policy

**English** · [Русский](SECURITY.ru.md)

## Supported versions

The latest release on `main` is the only supported version. There are no
maintenance branches.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private reporting instead:
[**Report a vulnerability**](https://github.com/DrStannum/paseo-plugin-beads/security/advisories/new).

What helps: the version or commit, the Paseo version, and the smallest input that
reproduces it. You will get an acknowledgement within a few days, a fix or an
explanation of why it is not one, and credit in the advisory unless you would
rather stay anonymous.

## What this plugin is trusted with

Paseo plugins are trusted code: installing one runs its server half inside the
Paseo daemon, with the daemon's permissions. This one, specifically:

- **Runs the `bd` binary** as a subprocess, always with an explicit argv array and
  never through a shell, so issue text cannot become a command.
- **Reads and writes a beads database** in the project of a workspace the daemon
  has open. It can create issues, edit their fields, close and reopen them and
  post comments. It cannot delete an issue: `delete` is not in the closed set of
  subcommands the write path will run, and the set is checked before `bd` starts.
- **Never touches git.** No `git add`, no `git commit`, and Dolt auto-commit is
  explicitly turned off on every write. (`bd import`, run by the Sync button,
  writes a Dolt commit of its own inside `.beads`; beads offers no flag to
  suppress that. Git stays untouched either way.)
- **Never takes a path from the client.** Every RPC names a workspace by id; the
  daemon resolves its directory, and the plugin walks up from there to `.beads`.
  The RPCs cannot be turned into "run `bd` anywhere".
- **Opens no port and calls no outside service.** It talks to the panel only
  through Paseo's own RPC channel.
- **Has no runtime dependencies** beyond what the Paseo host provides.

## Handling of issue text

Issue text comes from a repository and can contain anything, secrets included:

- there is no raw markup anywhere: the Markdown renderer builds components from a
  parsed tree, so `<script>` or `<img onerror=…>` from a description reaches the
  screen as text; the cases are unit-tested in `tests/markdown.test.ts`;
- only `http(s)`, `mailto` and relative links survive; `javascript:`, `data:` and
  `vbscript:` are dropped, including obfuscated forms like `java\tscript:`;
- images are not loaded, only their alt text is rendered;
- the plugin's logs carry codes, counts and the first line of `bd`'s stderr,
  never issue text;
- heavy text (descriptions, design, criteria, notes) is searched on the daemon
  and never shipped to the client wholesale;
- nothing is written to client storage; the issue cache lives in memory;
- the committed screenshots render a synthetic fixture, not a real project.
