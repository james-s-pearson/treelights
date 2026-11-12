// The Vim grammar's lexer is split into smaller functions at build time
// (grammars/split-lexer.mjs) so Obsidian's V8 can compile it. The split
// must not change how anything parses: tests/samples/sample.vim must give
// exactly the tree the original, unsplit grammar gives (recorded below
// from the unsplit build; checked on 1,779 Vim files, 2,027,265 nodes,
// when the split was introduced). Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Language, Parser } from "web-tree-sitter";

const root = path.resolve(import.meta.dirname, "..");
const ORIGINAL_TREE = { nodes: 191, sha256: "2634be5d9902443289d3d01cee482f4bf029e9689dd99edc0b8803440272327b" };

test("the split Vim grammar parses exactly like the original", async () => {
  await Parser.init();
  const parser = new Parser();
  parser.setLanguage(await Language.load(path.join(root, "build/wasm/vim.wasm")));
  const tree = parser.parse(fs.readFileSync(path.join(root, "tests/samples/sample.vim"), "utf8"))!;
  const c = tree.walk();
  const nodes: string[] = [];
  let depth = 0;
  for (;;) {
    const n = c.currentNode;
    nodes.push(`${depth}|${c.currentFieldName ?? ""}|${n.type}|${n.startIndex}|${n.endIndex}`);
    if (c.gotoFirstChild()) { depth++; continue; }
    let done = false;
    while (!c.gotoNextSibling()) { if (!c.gotoParent()) { done = true; break; } depth--; }
    if (done) break;
  }
  assert.equal(tree.rootNode.hasError, false);
  assert.deepEqual({ nodes: nodes.length, sha256: crypto.createHash("sha256").update(nodes.join("\n")).digest("hex") }, ORIGINAL_TREE);
});

test("no compiled grammar has a function too large for Obsidian's V8", () => {
  // The unsplit Vim lexer was about 813 KB and crashed V8 13.8; the
  // largest function that is known to work is about 449 KB (PowerShell).
  const LIMIT = 460 * 1024;
  for (const f of fs.readdirSync(path.join(root, "build/wasm")).filter((f) => f.endsWith(".wasm"))) {
    const buf = fs.readFileSync(path.join(root, "build/wasm", f));
    let p = 8;
    const u = () => { let r = 0, s = 0, b; do { b = buf[p++]; r |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return r >>> 0; };
    let largest = 0;
    while (p < buf.length) {
      const id = buf[p++], size = u(), end = p + size;
      if (id === 10) { const n = u(); for (let i = 0; i < n; i++) { const s = u(); largest = Math.max(largest, s); p += s; } }
      p = end;
    }
    assert.ok(largest <= LIMIT, `${f}: a function of ${Math.round(largest / 1024)} KB (limit ${LIMIT / 1024} KB)`);
  }
});
