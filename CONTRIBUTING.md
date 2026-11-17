# Contributing

**English** · [Русский](CONTRIBUTING.ru.md)

Thanks for taking an interest. This is a small, single-purpose plugin, so the bar
is less about process and more about not breaking the things it promises: that
reads never write, that it never deletes or commits, and that the panel never
renders untrusted text as markup.

## Before you start

- **Bug fixes**: open a pull request straight away.
- **New behaviour**: open an issue first. The panel is deliberately narrow (it
  browses, creates and edits beads issues; it does not delete, commit or manage
  git), and it is kinder to discuss scope before writing code.
- **Questions**: an issue is fine; there is no separate forum.

## Getting set up

```bash
git clone https://github.com/DrStannum/paseo-plugin-beads.git
cd paseo-plugin-beads
npm install
paseo plugin install .
```

You need Paseo 0.15.4 or newer with a running daemon, Node 22.18 or newer, and
[beads](https://github.com/gastownhall/beads) (`bd`) on `PATH`. After a change,
`paseo plugin reload beads` rebuilds the plugin; there is no need to restart the
daemon. The details are in [Development and tests](docs/development.md).

## Tests

```bash
npm test            # typecheck + every tests/*.test.ts
npm run smoke       # just the RPC handlers against a bd stub, in seconds
npm run preview     # every screenshot in the real Paseo web app, about 20 minutes
```

**If you change the UI, re-run the affected screenshots, look at them, and commit
the PNGs**: they are both the documentation's illustrations
([docs/screenshots.md](docs/screenshots.md)) and regression fixtures. Screenshots
render on the synthetic fixture in `tests/fixture/`, never on a real project:
issue text can carry secrets.

## What a change should respect

These are the invariants the tests exist to protect. A pull request that needs to
break one of them needs to say so out loud.

- **Reads and writes stay separate.** Every reading call carries `--readonly`;
  only `beads.edit`, `beads.create`, `beads.comment`, `beads.export` and
  `beads.sync` may run a writing subcommand, and the set of writing subcommands is
  closed (`create`/`update`/`close`/`reopen`/`export`/`import`/`comment`).
  `delete` is not in it and should not be added.
- **No git commits, ever.** The plugin never runs `git add`/`git commit` and never
  turns Dolt auto-commit on.
- **The workspace is resolved by the daemon.** RPCs take a workspace id, never a
  path.
- **No raw markup from data.** No `dangerouslySetInnerHTML`, `innerHTML` or `eval`
  with issue text: Markdown is parsed into a tree and drawn with components. Links
  are limited to `http(s)`, `mailto` and relative paths. `tests/markdown.test.ts`
  is the guard; extend it when you touch the renderer.
- **No runtime dependencies.** Only what the Paseo host provides (`react`,
  `react-native`, `@tanstack/react-query`, `zod`, `@getpaseo/plugin`) and `node:*`
  on the server.
- **Hermes-safe client code.** No `class`, no `toSorted`, no regex lookbehind or
  `v` flag, no `Intl.Segmenter`.
- **Both languages.** A new visible string needs both `en` and `ru`
  (`client/i18n/strings.ts`). The same goes for the documentation: English is the
  source of truth, and the Russian page beside it (`*.ru.md`, `docs/ru/`) is
  updated in the same commit.
- **Logs carry no issue text.** Diagnostics print codes, counts and commands
  without user arguments, never titles, texts or comments.

## Commits and pull requests

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, with `!` for a breaking
change. Keep the subject in the imperative mood and under ~72 characters; explain
the *why* in the body.

A pull request should:

- do one thing, and say what and why in the description;
- keep `npm test` green;
- include the re-shot screenshots for anything visible.
