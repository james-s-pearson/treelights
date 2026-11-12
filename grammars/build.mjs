// Builds Tree-sitter grammars to WebAssembly from pinned sources.
// Usage: node grammars/build.mjs [lang ...] [--update-pins]
//   (default: every grammar)
// Output: build/wasm/<lang>.wasm. Sources are fetched into build/src, or
// taken from a source archive (TREELIGHTS_SOURCE_ARCHIVE, see SECURITY.md).
// Supply-chain checks (tools/supply-chain.mjs) run before and after.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkGrammars, checkTools, sha256File, stopOn } from "../tools/supply-chain.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { grammars } = JSON.parse(fs.readFileSync(path.join(root, "grammars/sources.json"), "utf8"));
const cli = path.join(root, "node_modules/.bin/tree-sitter");
const srcDir = path.join(root, "build/src");
const outDir = path.join(root, "build/wasm");
fs.mkdirSync(srcDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "inherit" });
const update = process.argv.includes("--update-pins");
const wanted = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const langs = wanted.length ? wanted : Object.keys(grammars);

// Pins must be full commit hashes: a tag or branch name can be moved to
// different code by whoever controls the repository.
stopOn(langs.filter((l) => !grammars[l]?.path && !/^[0-9a-f]{40}$/.test(grammars[l]?.revision ?? ""))
  .map((l) => `${l}: revision "${grammars[l]?.revision}" is not a full commit hash`), "pins");
// The compiler toolchain must be the one we recorded (unless updating)
if (!update) stopOn(checkTools(), "build tools");

// Optional offline source archive: <repo>-<commit>.tar.gz files listed
// with their SHA-256 in SHA256SUMS. Used instead of the network when present.
const archiveDir = process.env.TREELIGHTS_SOURCE_ARCHIVE;
const archiveSums = new Map();
if (archiveDir && fs.existsSync(path.join(archiveDir, "SHA256SUMS"))) {
  for (const line of fs.readFileSync(path.join(archiveDir, "SHA256SUMS"), "utf8").split("\n")) {
    const [hash, name] = line.trim().split(/\s+/);
    if (hash && name) archiveSums.set(name, hash);
  }
}
const provenance = {};

for (const lang of langs) {
  const g = grammars[lang];
  if (!g) throw new Error(`No pinned source for ${lang}`);
  if (g.path) { buildLocal(lang, g); continue; }
  const repoDir = path.join(srcDir, path.basename(g.url));
  const archiveName = `${path.basename(g.url)}-${g.revision}.tar.gz`;
  let commit;
  if (archiveSums.has(archiveName)) {
    // from the archive, after checking its fingerprint
    const file = path.join(archiveDir, archiveName);
    if (sha256File(file) !== archiveSums.get(archiveName)) stopOn([`${archiveName}: archive does not match SHA256SUMS`], "source archive");
    fs.rmSync(repoDir, { recursive: true, force: true });
    fs.mkdirSync(repoDir, { recursive: true });
    run("tar", ["-xzf", file, "-C", repoDir]);
    commit = g.revision;
  } else {
    // from the network: git checks the contents against the commit hash
    if (!fs.existsSync(path.join(repoDir, ".git"))) {
      fs.rmSync(repoDir, { recursive: true, force: true });
      run("git", ["init", "-q", repoDir]);
      run("git", ["remote", "add", "origin", g.url], repoDir);
    }
    run("git", ["fetch", "-q", "--depth", "1", "origin", g.revision], repoDir);
    run("git", ["checkout", "-q", "FETCH_HEAD"], repoDir);
    commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir }).toString().trim();
    if (commit !== g.revision) stopOn([`${lang}: got commit ${commit}, pinned ${g.revision}`], "pins");
  }
  let grammarDir = g.location ? path.join(repoDir, g.location) : repoDir;
  const out = path.join(outDir, `${lang}.wasm`);
  let splitDir;
  if (g.splitLexer || g.patch) {
    // Changes are made on a copy of the pinned source, never the source itself
    splitDir = fs.mkdtempSync(path.join(root, "build/split-"));
    fs.cpSync(grammarDir, splitDir, { recursive: true, filter: (f) => !f.includes(`${path.sep}.git`) });
    if (g.patch) {
      // Patch src/grammar.json and regenerate from it, so the upstream
      // grammar's JavaScript never runs (see patch-grammar.mjs)
      run("node", [path.join(root, "grammars/patch-grammar.mjs"), path.join(splitDir, "src/grammar.json"), path.join(root, g.patch)], root);
      fs.rmSync(path.join(splitDir, "grammar.js"), { force: true });
      execFileSync(cli, ["generate", "src/grammar.json"], { cwd: splitDir, stdio: "pipe" });
    }
    // Split an oversized lexer (see split-lexer.mjs)
    if (g.splitLexer) run("node", [path.join(root, "grammars/split-lexer.mjs"), path.join(splitDir, "src/parser.c"), String(g.splitLexer)], root);
    grammarDir = splitDir;
  }
  try { run(cli, ["build", "--wasm", "-o", out], grammarDir); }
  finally { if (splitDir) fs.rmSync(splitDir, { recursive: true, force: true }); }
  provenance[lang] = { url: g.url, revision: g.revision, commit };
  console.log(`built ${lang} (${fs.statSync(out).size} bytes) from ${g.url}@${commit}`);
}
/**
 * A grammar kept in this repository (for example tree-sitter-yara). Its
 * generated parser must be exactly what its grammar.js produces, so the
 * code that runs always matches the definition people can read.
 */
function buildLocal(lang, g) {
  const dir = path.join(root, g.path);
  const tmp = fs.mkdtempSync(path.join(root, "build/regen-"));
  try {
    for (const f of ["grammar.js", "tree-sitter.json", "package.json"]) fs.copyFileSync(path.join(dir, f), path.join(tmp, f));
    execFileSync(cli, ["generate"], { cwd: tmp, stdio: "pipe" });
    const files = (d) => fs.readdirSync(d, { recursive: true }).filter((f) => fs.statSync(path.join(d, f)).isFile()).sort();
    const want = files(path.join(tmp, "src")), got = files(path.join(dir, "src"));
    const differ = [...new Set([...want, ...got])].filter((f) => !want.includes(f) || !got.includes(f)
      || sha256File(path.join(tmp, "src", f)) !== sha256File(path.join(dir, "src", f)));
    if (differ.length) stopOn([`${lang}: ${g.path}/src does not match what grammar.js generates (${differ.join(", ")}); run tree-sitter generate there`], "local grammar");
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const out = path.join(outDir, `${lang}.wasm`);
  run(cli, ["build", "--wasm", "-o", out], dir);
  provenance[lang] = { path: g.path };
  console.log(`built ${lang} (${fs.statSync(out).size} bytes) from ${g.path} (generated parser verified)`);
}

fs.writeFileSync(path.join(outDir, "provenance.json"), JSON.stringify(provenance, null, 2));

// The toolchain may have been downloaded during this build: check it now
// too, then check every grammar just built.
if (update) {
  checkTools({ update: true });
  stopOn(await checkGrammars(langs, outDir, { update: true }), "grammars");
  console.log("Recorded new fingerprints in grammars/checksums.json. Review the diff before committing.");
} else {
  const problems = [...checkTools(), ...(await checkGrammars(langs, outDir))];
  if (problems.length) for (const l of langs) fs.rmSync(path.join(outDir, `${l}.wasm`), { force: true });
  stopOn(problems, "grammars");
}
