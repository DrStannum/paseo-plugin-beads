/**
 * The documentation stays whole: every page exists in both languages, every
 * relative link and image resolves, every screenshot is in the gallery on
 * both language pages, and the registry files (manifest icon and media,
 * OVERVIEW) follow the registry's rules.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

/** English page → its Russian mirror. */
const ROOT_PAGES = ["README", "CHANGELOG", "SECURITY", "CONTRIBUTING", "OVERVIEW"];
const DOC_PAGES = fs.readdirSync(path.join(ROOT, "docs")).filter((f) => f.endsWith(".md"));
const PAIRS: [string, string][] = [
  ...ROOT_PAGES.map((p): [string, string] => [`${p}.md`, `${p}.ru.md`]),
  ...DOC_PAGES.map((f): [string, string] => [`docs/${f}`, `docs/ru/${f}`]),
];
const ALL = PAIRS.flat();

test("every English page has its Russian mirror, and back", () => {
  for (const [en, ru] of PAIRS) assert.ok(exists(ru), `${en} has no ${ru}`);
  for (const f of fs.readdirSync(path.join(ROOT, "docs", "ru"))) assert.ok(DOC_PAGES.includes(f), `docs/ru/${f} has no English page`);
});

/** Relative link and image targets of a Markdown page (code spans and blocks skipped). */
function targets(md: string): string[] {
  const text = md.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const out: string[] = [];
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) out.push(m[1]!);
  for (const m of text.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) out.push(m[1]!);
  return out.filter((t) => !/^(https?:|mailto:|#)/.test(t));
}

test("every relative link and image resolves", () => {
  for (const page of ALL) {
    for (const t of targets(read(page))) {
      const file = decodeURIComponent(t.split("#")[0]!);
      const at = path.join(path.dirname(page), file);
      assert.ok(exists(at), `${page}: ${t} → ${at} does not exist`);
    }
  }
});

test("every screenshot is in the gallery, in both languages", () => {
  const pngs = fs.readdirSync(path.join(ROOT, "tests")).filter((f) => /^preview-.*\.png$/.test(f));
  assert.ok(pngs.length > 0);
  for (const gallery of ["docs/screenshots.md", "docs/ru/screenshots.md"]) {
    const md = read(gallery);
    for (const png of pngs) assert.ok(md.includes(`tests/${png}`), `${gallery} does not show ${png}`);
  }
});

test("the manifest's icon and media are PNGs inside the package", () => {
  const manifest = JSON.parse(read("paseo-plugin.json")) as { icon?: string; media?: string[] };
  const pkg = JSON.parse(read("package.json")) as { files: string[] };
  const shipped = (rel: string) => pkg.files.some((f) => (f.endsWith("/") ? rel.startsWith(f) : rel === f));
  assert.ok(manifest.icon && /\.png$/.test(manifest.icon), "icon is a PNG path");
  for (const rel of [manifest.icon!, ...(manifest.media ?? [])]) {
    assert.ok(exists(rel), `${rel} does not exist`);
    assert.ok(shipped(rel), `${rel} is not in package.json files`);
  }
  assert.ok((manifest.media ?? []).length > 0, "media lists something");
  for (const f of ["paseo-plugin.json", "OVERVIEW.md", "OVERVIEW.*.md"]) assert.ok(pkg.files.includes(f), `files lacks ${f}`);
});

test("OVERVIEW follows the registry's rules", () => {
  for (const page of ["OVERVIEW.md", "OVERVIEW.ru.md"]) {
    const md = read(page);
    assert.ok(!md.includes("—"), `${page}: no em dashes`);
    assert.ok(!/<[a-z!]/i.test(md.replace(/`[^`]*`/g, "")), `${page}: no raw HTML`);
    assert.ok(!/paseo plugin install|npm install/.test(md), `${page}: no install commands`);
    assert.ok(!/^#+\s*(license|лицензия|changelog|contributing)/im.test(md), `${page}: no license/changelog/contributing sections`);
    assert.ok(!/!\[[^\]]*\]\(https:\/\/img\.shields/.test(md), `${page}: no badges`);
  }
});
