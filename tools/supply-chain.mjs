// Supply-chain checks for Treelights' build. See SECURITY.md.
//
// - Every grammar source is pinned to a full commit hash.
// - Every compiled grammar must match its SHA-256 fingerprint in
//   grammars/checksums.json, and may ask the plugin only for the
//   harmless functions in ALLOWED_IMPORTS (memory, character checks).
// - The build tools that are downloaded at install time (the
//   tree-sitter program and the WASI SDK it compiles with) must match
//   their recorded fingerprints.
//
// A mismatch stops the build. Fingerprints change only when someone runs
// the build with --update-pins on purpose, after reviewing the change.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const checksumsFile = path.join(root, "grammars/checksums.json");
export const platform = `${process.platform}-${process.arch}`;

/**
 * What a compiled grammar may import from the plugin. Anything else (for
 * example a function that could reach files, the network or the page)
 * stops the build. "env" is the only module grammars may import from.
 */
export const ALLOWED_IMPORTS = new Set([
  // memory and the function table the runtime shares with every grammar
  "memory", "__indirect_function_table", "__memory_base", "__table_base", "__stack_pointer",
  // C library: memory, strings, character classes, assertions
  "malloc", "calloc", "realloc", "free", "memcmp", "strcmp", "strlen", "strncpy",
  "iswalnum", "iswalpha", "iswlower", "iswspace", "iswxdigit", "towlower", "towupper",
  "__assert_fail", "abort",
]);

export const sha256 = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
export const sha256File = (file) => sha256(fs.readFileSync(file));

/** Imports a grammar asks for that are not allowed (empty = safe). */
export async function forbiddenImports(wasmBytes) {
  const mod = await WebAssembly.compile(wasmBytes);
  return WebAssembly.Module.imports(mod)
    .filter((i) => i.module !== "env" || !ALLOWED_IMPORTS.has(i.name))
    .map((i) => `${i.module}.${i.name}`);
}

/** One fingerprint for a whole folder: every file's path and contents. */
export function sha256Tree(dir) {
  const lines = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const p = path.join(d, e.name), rel = path.relative(dir, p);
      if (e.isSymbolicLink()) lines.push(`link ${rel} -> ${fs.readlinkSync(p)}`);
      else if (e.isDirectory()) walk(p);
      else if (e.isFile()) lines.push(`file ${rel} ${sha256File(p)}`);
    }
  };
  walk(dir);
  return sha256(lines.join("\n"));
}

export const readChecksums = () =>
  fs.existsSync(checksumsFile) ? JSON.parse(fs.readFileSync(checksumsFile, "utf8")) : { tools: {}, grammars: {} };
export const writeChecksums = (c) => fs.writeFileSync(checksumsFile, JSON.stringify(c, null, 2) + "\n");

export const cliBinary = path.join(root, "node_modules/tree-sitter-cli/tree-sitter");
export const wasiSdk = path.join(os.homedir(), ".cache/tree-sitter/wasi-sdk");

/**
 * Check the downloaded build tools against their fingerprints for this
 * platform. With update=true, record them instead (after review).
 */
export function checkTools({ update = false } = {}) {
  const c = readChecksums();
  const cliVersion = JSON.parse(fs.readFileSync(path.join(root, "node_modules/tree-sitter-cli/package.json"), "utf8")).version;
  const found = {
    "tree-sitter-cli": { version: cliVersion, sha256: sha256File(cliBinary) },
    ...(fs.existsSync(wasiSdk) ? { "wasi-sdk": { sha256: sha256Tree(wasiSdk) } } : {}),
  };
  const problems = [];
  for (const [tool, got] of Object.entries(found)) {
    const want = c.tools?.[tool]?.[platform];
    if (update) { ((c.tools ??= {})[tool] ??= {})[platform] = got; continue; }
    if (!want) problems.push(`${tool}: no fingerprint recorded for ${platform}`);
    else if (want.sha256 !== got.sha256 || want.version !== got.version)
      problems.push(`${tool}: fingerprint does not match the recorded one for ${platform} (got ${got.sha256.slice(0, 12)}…, want ${want.sha256.slice(0, 12)}…)`);
  }
  if (update) writeChecksums(c);
  return problems;
}

/** Check compiled grammars against their fingerprints and the import allow-list. */
export async function checkGrammars(langs, wasmDir, { update = false } = {}) {
  const c = readChecksums();
  const problems = [];
  for (const lang of langs) {
    const bytes = fs.readFileSync(path.join(wasmDir, `${lang}.wasm`));
    const got = sha256(bytes);
    let bad;
    try { bad = await forbiddenImports(bytes); }
    catch (e) { problems.push(`${lang}: not a valid grammar file (${e.message})`); continue; }
    if (bad.length) problems.push(`${lang}: asks for functions outside the allow-list: ${bad.join(", ")}`);
    if (update) { (c.grammars ??= {})[lang] = { sha256: got }; continue; }
    const want = c.grammars?.[lang]?.sha256;
    if (!want) problems.push(`${lang}: no fingerprint recorded`);
    else if (want !== got) problems.push(`${lang}: compiled grammar does not match its fingerprint (got ${got.slice(0, 12)}…, want ${want.slice(0, 12)}…)`);
  }
  if (update) writeChecksums(c);
  return problems;
}

/** Stop with a clear message if there are problems. */
export function stopOn(problems, what) {
  if (!problems.length) return;
  console.error(`\nSupply-chain check failed (${what}):\n  - ${problems.join("\n  - ")}\n`
    + "Nothing was built. If this change is expected, review it (see SECURITY.md, \"Updating\"),\n"
    + "then record the new fingerprints with: npm run build:grammars -- --update-pins\n");
  process.exit(1);
}
