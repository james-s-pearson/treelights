// Treelights' own themes (tools/make-themes.mjs). Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const load = (f: string) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "themes", f), "utf8"));
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test("Neon Alley themes: every colour reaches 4.5:1 on the background", () => {
  for (const f of ["neon-alley-dark.json", "neon-alley-light.json"]) {
    const t = load(f);
    for (const [capture, s] of Object.entries<{ fg?: string }>(t.captures)) {
      if (!s.fg) continue;
      const c = contrast(s.fg, t.background);
      assert.ok(c >= 4.5, `${t.name}: ${capture} ${s.fg} is ${c.toFixed(2)}:1`);
    }
  }
});

test("Follow Obsidian theme uses only Obsidian's code colours and keeps its background", () => {
  const t = load("obsidian.json");
  assert.equal(t.background, undefined);
  assert.equal(t.foreground, undefined);
  for (const [capture, s] of Object.entries<{ fg?: string }>(t.captures)) {
    if (s.fg) assert.match(s.fg, /^var\(--code-[a-z]+\)$/, capture);
  }
});

test("styles.css has as many style slots as the plugin uses", async () => {
  const { STYLE_SLOTS } = await import("../src/main.ts").catch(() => ({ STYLE_SLOTS: undefined }));
  const css = fs.readFileSync(path.join(import.meta.dirname, "..", "styles.css"), "utf8");
  const slots = new Set([...css.matchAll(/\.tl-(\d+)::before/g)].map((m) => m[1])).size;
  const src = fs.readFileSync(path.join(import.meta.dirname, "..", "src/main.ts"), "utf8");
  const declared = Number(/export const STYLE_SLOTS = (\d+);/.exec(src)?.[1]);
  assert.equal(slots, declared, `styles.css has ${slots} slots, main.ts declares ${declared}`);
  void STYLE_SLOTS;
});

test("no <style> elements and no inline style assignments in the plugin source", () => {
  const src = fs.readFileSync(path.join(import.meta.dirname, "..", "src/main.ts"), "utf8");
  assert.doesNotMatch(src, /createEl\("style"|createElement\("style"\)/, "Obsidian does not allow plugins to create <style> elements");
  assert.doesNotMatch(src, /\.style\.[a-zA-Z]+\s*=/, "use CSS classes or setCssProps instead of element.style");
});

test("styles.css uses no !important (selector weight is used instead)", () => {
  const css = fs.readFileSync(path.join(import.meta.dirname, "..", "styles.css"), "utf8");
  assert.doesNotMatch(css, /!important/);
});

test("the built main.js has no network, file-system or eval code except the Cmd-click link", { skip: !fs.existsSync(path.join(import.meta.dirname, "..", "main.js")) }, () => {
  const js = fs.readFileSync(path.join(import.meta.dirname, "..", "main.js"), "utf8");
  for (const pattern of [/\bfetch\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /require\("(fs|path|url|module)"\)/, /\beval\(/, /new Function\(/]) {
    assert.doesNotMatch(js, pattern);
  }
  assert.equal(js.match(/window\.open\(/g)?.length, 1, "only the Cmd-click on a CVE, CWE or ATT&CK badge opens a web page");
});

test("every grammar has its highlight rules", () => {
  const registry = fs.readFileSync(path.join(import.meta.dirname, "..", "src/generated/registry.ts"), "utf8");
  const missing = [...registry.matchAll(/^\s*"([\w-]+)": \{ wasm: \w+, highlights: undefined/gm)].map((m) => m[1]);
  assert.deepEqual(missing, [], `grammars without highlight rules: ${missing.join(", ")}`);
});
