import assert from "node:assert/strict";
import { test } from "node:test";
import { STRINGS, ruPlural, stringsFor } from "../client/i18n/strings.ts";

const SAMPLE: Record<string, unknown> = { step: "week", value: 3, when: "Jul 2026", parts: "a 1" };

function sampleArgs(fn: Function): unknown[] {
  const names = /^\s*\(?([^)=]*)\)?\s*=>/.exec(fn.toString())?.[1] ?? "";
  return names.split(",").map((n) => n.trim()).filter(Boolean)
    .map((n) => (n in SAMPLE ? SAMPLE[n] : /^(name|label|col|id|title|who|l|scope)$/.test(n) ? "X" : 2));
}

test("Russian has exactly the English keys, with the same kind of entry", () => {
  assert.deepEqual(Object.keys(STRINGS.ru).sort(), Object.keys(STRINGS.en).sort());
  for (const key of Object.keys(STRINGS.en) as (keyof typeof STRINGS.en)[]) {
    assert.equal(typeof STRINGS.ru[key], typeof STRINGS.en[key], key);
  }
});

test("every function entry renders a non-empty string in both languages", () => {
  for (const lang of ["en", "ru"] as const) {
    for (const [key, entry] of Object.entries(STRINGS[lang])) {
      if (typeof entry !== "function") continue;
      const out = (entry as (...a: unknown[]) => unknown)(...sampleArgs(entry));
      assert.equal(typeof out, "string", `${lang}.${key}`);
      assert.ok((out as string).length > 0, `${lang}.${key}`);
      assert.ok(!(out as string).includes("undefined"), `${lang}.${key}: ${out}`);
    }
  }
});

test("Russian plurals and locale fallback", () => {
  assert.deepEqual([1, 2, 5, 11, 21, 22, 25].map((n) => ruPlural(n, ["a", "b", "c"])), ["a", "b", "c", "c", "a", "b", "c"]);
  assert.equal(stringsFor("ru-RU"), STRINGS.ru);
  assert.equal(stringsFor("ru"), STRINGS.ru);
  assert.equal(stringsFor("de"), STRINGS.en);
  assert.equal(stringsFor(undefined), STRINGS.en);
});

test("the host's labels (panel tab, Command Center) exist in both languages", async () => {
  const { messages } = await import("../client/i18n/messages.ts");
  const { en, ru } = (messages as unknown as { resources: Record<"en" | "ru", Record<string, string>> }).resources;
  assert.deepEqual(Object.keys(ru).sort(), Object.keys(en).sort());
  for (const key of Object.keys(en)) assert.ok(en[key] && ru[key], key);
  assert.equal(en.openBoard, "Open Beads board");
});
