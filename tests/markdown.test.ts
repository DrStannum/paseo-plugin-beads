/**
 * The markdown parser, against the cases the CloudCLI tab's renderer was held
 * to (cloudcli-plugin-beads, tests/markdown.mjs), restated for a tree of
 * nodes: hostile text must come out as text nodes, and no link may carry a
 * scheme that can execute.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseInline, parseMarkdown, safeUrl, splitIssueKeys, type Block, type Inline } from "../shared/markdown.ts";

type Node = Block | Inline;

/** Every node in the tree, depth first. */
function walk(blocks: Node[]): Node[] {
  const out: Node[] = [];
  const visit = (n: Node) => {
    out.push(n);
    if ("c" in n && Array.isArray(n.c)) (n.c as Node[]).forEach(visit);
    if (n.t === "table") [...n.head, ...n.rows.flat()].flat().forEach(visit);
    if (n.t === "list") n.items.forEach((it) => { it.c.forEach(visit); it.sub.forEach(visit); });
  };
  blocks.forEach(visit);
  return out;
}
const links = (b: Node[]) => walk(b).filter((n): n is Inline & { t: "link" } => n.t === "link");
const kinds = (b: Node[]) => walk(b).map((n) => n.t);
/** All visible text, as the client would draw it. */
function text(b: Node[]): string {
  return walk(b).map((n) => (n.t === "text" || n.t === "code" ? n.v : n.t === "pre" ? n.v : n.t === "image" ? n.alt : n.t === "br" ? "\n" : "")).join("");
}

// ── Hostile input ──────────────────────────────────────────────────────

test("raw <script> is text", () => {
  const b = parseMarkdown("before <script>alert(1)</script> after");
  assert.deepEqual(kinds(b), ["p", "text"]);
  assert.equal(text(b), "before <script>alert(1)</script> after");
});

test("<img onerror> is text", () => {
  const b = parseMarkdown("<img src=x onerror=alert(1)>");
  assert.equal(text(b), "<img src=x onerror=alert(1)>");
  assert.equal(links(b).length, 0);
});

for (const [name, src] of [
  ["javascript:", "[click](javascript:alert(1))"],
  ["JaVa\\tScRiPt: with padding", "[x](  JaVa\tScRiPt:alert(1))"],
  ["data:", "[x](data:text/html;base64,PHNjcmlwdD4=)"],
  ["vbscript:", "[x](vbscript:msgbox(1))"],
  ["entity-encoded javascript", "[x](&#106;avascript:alert(1))"],
] as const) {
  test(`${name} link loses its link`, () => {
    const b = parseMarkdown(src);
    assert.equal(links(b).length, 0, JSON.stringify(b));
  });
}

test("javascript: link keeps its label as text", () => {
  // The url stops at the first ")", as in the reference, so a stray ")" stays.
  assert.ok(text(parseMarkdown("[click](javascript:alert(1))")).startsWith("click"));
});

test("a quote in a link cannot smuggle an attribute", () => {
  const b = parseMarkdown('[a](https://example.com/") onmouseover="alert(1))');
  for (const l of links(b)) assert.ok(!l.href.includes(" "), l.href);
  assert.ok(text(b).includes('onmouseover="alert(1))'), "the rest stays visible as text");
});

test("html in a fenced block, a table cell and a heading stays text", () => {
  const pre = parseMarkdown("```\n<script>alert(1)</script>\n```");
  assert.deepEqual(pre, [{ t: "pre", lang: "", v: "<script>alert(1)</script>" }]);
  const table = parseMarkdown("| a | b |\n|---|---|\n| <script>x</script> | 2 |");
  assert.equal(table[0]?.t, "table");
  assert.ok(text(table).includes("<script>x</script>"));
  const h = parseMarkdown("# <svg onload=alert(1)>");
  assert.equal(h[0]?.t, "h");
  assert.equal(text(h), "<svg onload=alert(1)>");
});

test("a markdown image is never loaded, its alt text stays", () => {
  const b = parseMarkdown("![alt](https://example.com/a.png)");
  assert.deepEqual(walk(b).filter((n) => n.t === "image"), [{ t: "image", alt: "alt" }]);
  assert.equal(links(b).length, 0);
});

test("safeUrl allows only inert schemes", () => {
  assert.equal(safeUrl("https://x.y/a?b=1&c=2"), "https://x.y/a?b=1&c=2");
  assert.equal(safeUrl("mailto:a@b.c"), "mailto:a@b.c");
  assert.equal(safeUrl("./docs/a.md"), "./docs/a.md");
  assert.equal(safeUrl("java\nscript:x"), null);
  // Relative paths pass, as in the reference; the client never navigates
  // them (only http(s) and mailto open), so "//host" cannot leave the app.
  assert.equal(safeUrl("../x"), "../x");
});

// ── Rendering ──────────────────────────────────────────────────────────

test("headings start two levels below the card title", () => {
  const b = parseMarkdown("## Source\ntext");
  assert.deepEqual(b[0], { t: "h", level: 4, c: [{ t: "text", v: "Source" }] });
});

test("safe links keep their url intact", () => {
  assert.equal(links(parseMarkdown("[docs](https://example.com/x?a=1&b=2)"))[0]?.href, "https://example.com/x?a=1&b=2");
});

test("bare urls autolink", () => {
  assert.equal(links(parseMarkdown("see https://example.com/page for more"))[0]?.href, "https://example.com/page");
});

test("inline code is not re-processed", () => {
  const inl = parseInline("use `**not bold** <b>x</b>` here");
  assert.deepEqual(inl, [{ t: "text", v: "use " }, { t: "code", v: "**not bold** <b>x</b>" }, { t: "text", v: " here" }]);
});

test("bold, italic and strike", () => {
  const k = kinds(parseMarkdown("**b** and *i* and ~~s~~"));
  for (const t of ["strong", "em", "del"]) assert.ok(k.includes(t as Node["t"]), t);
});

test("snake_case is not italicised", () => {
  assert.ok(!kinds(parseMarkdown("field acceptance_criteria here")).includes("em"));
});

test("nested lists nest under their item", () => {
  const b = parseMarkdown("- a\n  - b\n- c");
  assert.equal(b.length, 1);
  const list = b[0] as Block & { t: "list" };
  assert.equal(list.items.length, 2);
  assert.equal(list.items[0]?.sub.length, 1);
  assert.equal(kinds(b).filter((t) => t === "list").length, 2);
});

test("ordered lists are ordered", () => {
  assert.deepEqual((parseMarkdown("1. one\n2. two")[0] as Block & { t: "list" }).ordered, true);
});

test("task list boxes", () => {
  const list = parseMarkdown("- [x] done\n- [ ] todo")[0] as Block & { t: "list" };
  assert.deepEqual(list.items.map((i) => i.box), [true, false]);
  assert.equal(text([list]), "donetodo");
});

test("a blockquote holds markdown", () => {
  const b = parseMarkdown("> **loud**\n> quiet");
  assert.equal(b[0]?.t, "quote");
  assert.ok(kinds(b).includes("strong"));
});

test("fenced code keeps its language and its newlines", () => {
  assert.deepEqual(parseMarkdown("```ts\nconst a = 1;\nconst b = 2;\n```"), [{ t: "pre", lang: "ts", v: "const a = 1;\nconst b = 2;" }]);
});

test("horizontal rule", () => {
  assert.deepEqual(parseMarkdown("---"), [{ t: "hr" }]);
});

test("single newlines inside a paragraph are breaks", () => {
  assert.deepEqual(parseMarkdown("line one\nline two"), [{ t: "p", c: [{ t: "text", v: "line one" }, { t: "br" }, { t: "text", v: "line two" }] }]);
});

test("empty and non-string input is harmless", () => {
  for (const v of ["", "   ", null, 42, undefined]) assert.deepEqual(parseMarkdown(v), []);
});

test("a long unterminated fence does not hang", () => {
  const b = parseMarkdown("```\n<b>x</b>\nno closing fence");
  assert.deepEqual(b, [{ t: "pre", lang: "", v: "<b>x</b>\nno closing fence" }]);
});

test("pathological input stays fast", () => {
  const started = Date.now();
  parseMarkdown("*".repeat(20000) + "\n" + "_a".repeat(10000) + "\n" + "[".repeat(5000) + "](" + ")".repeat(5000));
  assert.ok(Date.now() - started < 1000, `${Date.now() - started} ms`);
});

// ── Issue keys ─────────────────────────────────────────────────────────

test("only real issue keys split out", () => {
  const ids = new Set(["demo-a1.3", "demo-b7"]);
  assert.deepEqual(splitIssueKeys("see demo-a1.3 and well-known, then demo-b7.", (id) => ids.has(id)), [
    { text: "see " }, { key: "demo-a1.3" }, { text: " and well-known, then " }, { key: "demo-b7" }, { text: "." },
  ]);
  assert.deepEqual(splitIssueKeys("nothing here", () => false), [{ text: "nothing here" }]);
});
