/**
 * A small markdown parser with no dependencies, returning a tree of nodes.
 *
 * The grammar is the CloudCLI tab's renderer (cloudcli-plugin-beads,
 * renderMarkdown in dist/index.js), rule for rule: ATX headings, fenced code,
 * ordered and unordered nested lists with task boxes, blockquotes, horizontal
 * rules, pipe tables, and inline code, links, autolinks, bold, italic and
 * strikethrough. The difference is the output. That renderer built an HTML
 * string from escaped text; this one builds nodes whose text is only ever
 * drawn as text by the client, so issue text has no way to become markup at
 * all — raw HTML in a description is shown as the characters it is.
 *
 * Kept free of Hermes pitfalls: no classes, no lookbehind, no regex v flag.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "code"; v: string }
  | { t: "strong" | "em" | "del"; c: Inline[] }
  | { t: "link"; href: string; c: Inline[] }
  | { t: "image"; alt: string }
  | { t: "br" };

export interface ListItem {
  /** A task-list box: true ☑, false ☐, null when the item has none. */
  box: boolean | null;
  c: Inline[];
  /** Lists nested under this item. */
  sub: Block[];
}

export type Block =
  | { t: "h"; level: number; c: Inline[] }
  | { t: "pre"; lang: string; v: string }
  | { t: "hr" }
  | { t: "quote"; c: Block[] }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] }
  | { t: "list"; ordered: boolean; items: ListItem[] }
  | { t: "p"; c: Inline[] };

/**
 * Allow only schemes that cannot execute. Whitespace and control characters
 * are stripped first so `java\tscript:` cannot smuggle a scheme past the test.
 */
export function safeUrl(raw: string): string | null {
  const flat = raw.replace(/[\s\u0000-\u001f]/g, "");
  if (/^(https?:\/\/|mailto:|\/|#|\.\/|\.\.\/)/i.test(flat)) return flat;
  return null;
}

// ── Inline ─────────────────────────────────────────────────────────────

/** Placeholder for a node already parsed out of the string. */
const SLOT = /\u0000(\d+)\u0000/g;

const EMPHASIS: { re: RegExp; t: "strong" | "em" | "del"; prefixed: boolean }[] = [
  { re: /\*\*([^*]+)\*\*/g, t: "strong", prefixed: false },
  { re: /__([^_]+)__/g, t: "strong", prefixed: false },
  { re: /~~([^~]+)~~/g, t: "del", prefixed: false },
  // The prefix group stands in for a lookbehind: `snake_case` and `2*3*4`
  // must not italicise, so the opening mark needs a non-word character first.
  { re: /(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, t: "em", prefixed: true },
  { re: /(^|[^_\w])_([^_\n]+)_(?!_)/g, t: "em", prefixed: true },
];

/** Plain text, with parsed-out slots put back and newlines as breaks. */
function textNodes(s: string, slots: Inline[]): Inline[] {
  const out: Inline[] = [];
  const pushText = (v: string) => {
    const parts = v.split("\n");
    parts.forEach((part, i) => {
      if (i > 0) out.push({ t: "br" });
      if (part) out.push({ t: "text", v: part });
    });
  };
  let last = 0;
  SLOT.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SLOT.exec(s))) {
    pushText(s.slice(last, m.index));
    const node = slots[Number(m[1])];
    if (node) out.push(node);
    last = m.index + m[0].length;
  }
  pushText(s.slice(last));
  return out;
}

/** Bold, italic and strike, in the reference renderer's order. */
function emphasis(s: string, slots: Inline[], k = 0): Inline[] {
  const rule = EMPHASIS[k];
  if (!rule) return textNodes(s, slots);
  const out: Inline[] = [];
  let last = 0;
  rule.re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = rule.re.exec(s))) {
    const prefix = rule.prefixed ? (m[1] ?? "") : "";
    const inner = (rule.prefixed ? m[2] : m[1]) ?? "";
    out.push(...emphasis(s.slice(last, m.index) + prefix, slots, k + 1));
    out.push({ t: rule.t, c: emphasis(inner, slots, k + 1) });
    last = m.index + m[0].length;
  }
  out.push(...emphasis(s.slice(last), slots, k + 1));
  return out;
}

/** Inline markdown: code spans, images, links, autolinks, emphasis. */
export function parseInline(src: string): Inline[] {
  const slots: Inline[] = [];
  const put = (node: Inline) => `\u0000${slots.push(node) - 1}\u0000`;

  // Code spans first, so their contents are never re-processed.
  let s = src.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g, (_m, _t, code: string) => put({ t: "code", v: code }));

  // Images are not loaded — a remote fetch from issue text is not something
  // this panel should do. The alt text stays so nothing is silently lost.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^)]*")?\)/g, (_m, alt: string) => put({ t: "image", alt }));

  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^)]*")?\)/g, (_m, label: string, url: string) => {
    const href = safeUrl(url);
    return href ? put({ t: "link", href, c: emphasis(label, slots) }) : label;
  });

  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre: string, url: string) => {
    const href = safeUrl(url);
    return href ? pre + put({ t: "link", href, c: [{ t: "text", v: url }] }) : m;
  });

  return emphasis(s, slots);
}

// ── Blocks ─────────────────────────────────────────────────────────────

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const HR = /^\s{0,3}([-*_])\s*(\1\s*){2,}$/;
const QUOTE = /^\s{0,3}>/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;

/** Indentation width, tabs as 4. */
function indentOf(s: string): number {
  return s.replace(/\t/g, "    ").length;
}

function parseBlocks(lines: string[]): Block[] {
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i] ?? "";

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = /^\s*(```+|~~~+)\s*([\w+-]*)\s*$/.exec(line);
    if (fence) {
      const close = (fence[1] ?? "`").startsWith("`") ? /^\s*```+\s*$/ : /^\s*~~~+\s*$/;
      const body: string[] = [];
      i++;
      while (i < lines.length && !close.test(lines[i] ?? "")) body.push(lines[i++] ?? "");
      i++; // the closing fence, or the end of input
      out.push({ t: "pre", lang: fence[2] ?? "", v: body.join("\n") });
      continue;
    }

    const head = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (head) {
      // Levels start two below the card title, which a h1 would fight with.
      out.push({ t: "h", level: Math.min(6, (head[1] ?? "#").length + 2), c: parseInline(head[2] ?? "") });
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.push({ t: "hr" });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && (QUOTE.test(lines[i] ?? "") || (body.length && (lines[i] ?? "").trim()))) {
        body.push((lines[i] ?? "").replace(/^\s{0,3}>\s?/, ""));
        i++;
      }
      out.push({ t: "quote", c: parseBlocks(body) });
      continue;
    }

    if (TABLE_ROW.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map((c) => parseInline(c.trim()));
      const headCells = cells(line);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && TABLE_ROW.test(lines[i] ?? "")) rows.push(cells(lines[i++] ?? ""));
      out.push({ t: "table", head: headCells, rows });
      continue;
    }

    if (LIST_ITEM.test(line)) {
      const [list, next] = parseList(lines, i);
      out.push(list);
      i = next;
      continue;
    }

    // A paragraph. Single newlines stay line breaks: in issue notes they are
    // breaks the author meant, not soft wrapping.
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (!l.trim() || /^\s*(```+|~~~+)/.test(l) || /^\s{0,3}#{1,6}\s/.test(l) || QUOTE.test(l) || LIST_ITEM.test(l) || HR.test(l)) break;
      para.push(l.trim());
      i++;
    }
    if (para.length) out.push({ t: "p", c: parseInline(para.join("\n")) });
  }
  return out;
}

/**
 * A run of list items starting at `from`. Nesting comes from indentation,
 * not from guessing; a blank line between two items does not end the list.
 */
function parseList(lines: string[], from: number): [Block & { t: "list" }, number] {
  type Open = { indent: number; list: Block & { t: "list" } };
  const stack: Open[] = [];
  let root: (Block & { t: "list" }) | null = null;
  let i = from;

  while (i < lines.length) {
    const item = LIST_ITEM.exec(lines[i] ?? "");
    if (!item) {
      if (!(lines[i] ?? "").trim() && i + 1 < lines.length && /^(\s*)([-*+]|\d+[.)])\s+/.test(lines[i + 1] ?? "")) {
        i++;
        continue;
      }
      break;
    }
    const indent = indentOf(item[1] ?? "");
    const ordered = /\d/.test(item[2] ?? "");
    while (stack.length > 1 && indent < (stack[stack.length - 1]?.indent ?? 0)) stack.pop();

    const top = stack[stack.length - 1];
    if (!top || indent > top.indent) {
      const list: Block & { t: "list" } = { t: "list", ordered, items: [] };
      const parentItem = top?.list.items[top.list.items.length - 1];
      if (parentItem) parentItem.sub.push(list);
      else if (!root) root = list;
      stack.push({ indent, list });
    }

    let text = item[3] ?? "";
    let box: boolean | null = null;
    if (/^\[ \]\s+/.test(text)) {
      box = false;
      text = text.replace(/^\[ \]\s+/, "");
    } else if (/^\[[xX]\]\s+/.test(text)) {
      box = true;
      text = text.replace(/^\[[xX]\]\s+/, "");
    }
    stack[stack.length - 1]?.list.items.push({ box, c: parseInline(text), sub: [] });
    i++;
  }
  return [root ?? { t: "list", ordered: false, items: [] }, i];
}

/** Parse issue text into blocks; anything that is not non-empty text gives []. */
export function parseMarkdown(src: unknown): Block[] {
  if (typeof src !== "string" || !src.trim()) return [];
  return parseBlocks(src.replace(/\r\n?/g, "\n").split("\n"));
}

// ── Issue keys ─────────────────────────────────────────────────────────

/**
 * Shape of a bd id — `prefix-suffix`, the suffix optionally split further by
 * dots for a subtask (`demo-a1.3`). Deliberately loose: a candidate finder,
 * not a validator. Whatever it catches that is not a real id in this project
 * is dropped by the caller's lookup and never becomes a link.
 */
const ISSUE_KEY_CANDIDATE = /\b[A-Za-z][A-Za-z0-9_]*-[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)*\b/g;

/**
 * Split plain text around the real issue keys in it. Callers apply this to
 * text nodes only — never inside links or code, where a key is the author
 * quoting, not a place to click.
 */
export function splitIssueKeys(text: string, isKey: (id: string) => boolean): ({ text: string } | { key: string })[] {
  const out: ({ text: string } | { key: string })[] = [];
  let last = 0;
  ISSUE_KEY_CANDIDATE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ISSUE_KEY_CANDIDATE.exec(text))) {
    if (!isKey(m[0])) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ key: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length || !out.length) out.push({ text: text.slice(last) });
  return out;
}
