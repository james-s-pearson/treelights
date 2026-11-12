// Supply-chain checks (see SECURITY.md). Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ALLOWED_IMPORTS, checkGrammars, checksumsFile, embeddedJavaScript, forbiddenImports, root } from "../tools/supply-chain.mjs";

const wasmDir = path.join(root, "build/wasm");
const built = fs.readdirSync(wasmDir).filter((f) => f.endsWith(".wasm")).map((f) => f.slice(0, -5));

// A minimal WebAssembly module that imports one function, env.<name>
const moduleImporting = (mod: string, name: string) => {
  const str = (s: string) => [s.length, ...Buffer.from(s)];
  const body = [1, ...str(mod), ...str(name), 0x00, 0x00]; // 1 import: function of type 0
  return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 4, 1, 0x60, 0, 0, 2, body.length, ...body]);
};

/** A tiny module with one exported function, optionally with a custom section. */
const moduleExporting = (name: string, customSection?: string) => {
  const str = (s: string) => [s.length, ...Buffer.from(s)];
  const exp = [1, ...str(name), 0x00, 0x00];
  const custom = customSection ? [0, str(customSection).length, ...str(customSection)] : [];
  return new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, 1, 4, 1, 0x60, 0, 0, 3, 2, 1, 0, 7, exp.length, ...exp, 10, 4, 1, 2, 0, 0x0b, ...custom]);
};

test("a grammar carrying embedded JavaScript is refused", async () => {
  assert.deepEqual(await embeddedJavaScript(moduleExporting("tree_sitter_demo")), []);
  assert.deepEqual(await embeddedJavaScript(moduleExporting("__em_js__steal")), ["__em_js__steal"]);
  assert.deepEqual(await embeddedJavaScript(moduleExporting("__start_em_asm")), ["__start_em_asm"]);
  assert.deepEqual(await embeddedJavaScript(moduleExporting("tree_sitter_demo", "em_js")), ["em_js section"]);
});

test("every grammar source is pinned to a full commit hash", () => {
  const { grammars } = JSON.parse(fs.readFileSync(path.join(root, "grammars/sources.json"), "utf8"));
  for (const [lang, g] of Object.entries<{ revision?: string; path?: string }>(grammars)) {
    if (g.path) continue; // kept in this repository (see the next test)
    assert.match(g.revision ?? "", /^[0-9a-f]{40}$/, `${lang} is pinned to "${g.revision}", which can be moved`);
  }
});

test("every built grammar matches its fingerprint and the import allow-list", async () => {
  assert.deepEqual(await checkGrammars(built, wasmDir), []);
  const recorded = Object.keys(JSON.parse(fs.readFileSync(checksumsFile, "utf8")).grammars);
  assert.deepEqual(built.sort(), recorded.sort());
});

test("a grammar asking for anything else is caught", async () => {
  assert.deepEqual(await forbiddenImports(moduleImporting("env", "malloc")), []);
  assert.deepEqual(await forbiddenImports(moduleImporting("env", "fetch")), ["env.fetch"]);
  assert.deepEqual(await forbiddenImports(moduleImporting("wasi_snapshot_preview1", "fd_write")), ["wasi_snapshot_preview1.fd_write"]);
  assert.ok(!ALLOWED_IMPORTS.has("fetch"));
});

test("a changed grammar is caught", async () => {
  const tmp = fs.mkdtempSync(path.join(root, "build/tamper-"));
  try {
    const bytes = fs.readFileSync(path.join(wasmDir, "json.wasm"));
    bytes[bytes.length - 1] ^= 1; // one bit
    fs.writeFileSync(path.join(tmp, "json.wasm"), bytes);
    const problems = await checkGrammars(["json"], tmp);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /does not match its fingerprint/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test("grammars kept in this repository ship the same highlight queries", () => {
  const { grammars } = JSON.parse(fs.readFileSync(path.join(root, "grammars/sources.json"), "utf8"));
  for (const [lang, g] of Object.entries<{ path?: string }>(grammars)) {
    if (!g.path) continue;
    for (const kind of ["highlights", "injections"]) {
      const own = path.join(root, g.path, "queries", `${kind}.scm`);
      if (!fs.existsSync(own)) continue;
      assert.equal(fs.readFileSync(path.join(root, "queries", lang, `${kind}.scm`), "utf8"), fs.readFileSync(own, "utf8"),
        `queries/${lang}/${kind}.scm differs from ${g.path}/queries/${kind}.scm`);
    }
  }
});
