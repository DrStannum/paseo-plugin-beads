# Privacy and issue text

**English** · [Русский](ru/privacy.md)

What leaves the host, and the rules that keep issue text out of markup, logs and screenshots.

**What leaves the host.** Nothing, beyond what Paseo itself carries. The plugin's
server half runs inside the Paseo daemon and talks to `bd` on the same machine;
the panel talks to the daemon over the client connection Paseo already has open,
the same one the rest of the app uses. The plugin opens no port, calls no outside
service, sends no telemetry and has no runtime dependencies of its own. The issue
text a panel shows travels over that connection to that client, and only on
request: the tree carries the light fields, full text arrives one card at a time,
and the heavy texts are searched on the daemon rather than shipped to the client.

Issue texts come from a repository and can contain anything, secrets included.
Hence these rules, baked into the code:

- **Logs carry no issue text.** The plugin's diagnostics (`paseo plugin logs
  beads`, the daemon log) are one line per event: an error code, an exit status, a
  count, a command without its user arguments, and at most the first line of
  `bd`'s stderr capped at 200 characters. Never a title, a description or a
  comment.
- **No raw markup from data.** There is no `dangerouslySetInnerHTML`, `innerHTML`
  or `eval` anywhere in the panel. The Markdown renderer parses text into a tree
  and draws it with components, so a `<script>` or `<img onerror=…>` in a
  description reaches the screen as text. Only `http(s)`, `mailto` and relative
  links are kept (`javascript:`, `data:`, `vbscript:` are dropped, along with
  bypasses like `java\tscript:`); `http(s)` links open through Paseo's own
  external-link handler. Images are not loaded, only their alt text remains. The
  renderer's tests cover the hostile cases.
- **Issue keys become links without becoming markup.** A key written in a
  description becomes a pressable element carrying the key as text, and only for
  keys the project actually holds, never inside code or an existing link.
- **Chart pictures are built from numbers.** On iOS and Android a chart is an SVG
  document drawn from the aggregated numbers and labels; every text in it is
  escaped, it carries no scripts or event handlers, and the tests run real chart
  documents through the host's own SVG icon validator.
- **Nothing is persisted on the client.** The issue cache lives in memory for as
  long as the app is open. The panel's tab state keeps only ids, filters and
  layout, and the draft of a comment lives only until the panel is closed.
- **The host keeps the last good list of each project.** So that a plugin
  reload or a daemon restart shows the issues at once, the daemon saves the last
  full list it read from `bd` under `~/.paseo/plugin-data/beads/` (under
  `$PASEO_HOME` if that is set). The directory and every file in it are readable
  by their owner only (0700 and 0600), and a file is named by a hash of the
  project's path, not by the project. A project not opened for 30 days goes, and
  past 256 MB in all the least recently used ones go; archiving a workspace in
  Paseo removes its project's file. Removing the plugin does not empty the
  directory: delete it by hand.
- **The settings stay on the host.** Your name and the refresh interval live in
  the daemon's plugin settings, not in the project.
- **The fixture is synthetic.** Every screenshot is rendered on a made-up set of
  issues (`tests/fixture/`), never on a live project, so the PNGs contain nothing
  real. Performance measurements run on synthetic data too.

---

[← Documentation index](README.md) · [Project README](../README.md)
