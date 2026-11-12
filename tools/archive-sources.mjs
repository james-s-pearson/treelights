// Saves every grammar source, exactly as it is at its pinned commit, as
// <repo>-<commit>.tar.gz in a folder, with SHA256SUMS. Builds can then use
// the archive instead of the network (TREELIGHTS_SOURCE_ARCHIVE), so a
// deleted or rewritten upstream repository cannot break or change a build.
// Usage: node tools/archive-sources.mjs <folder>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { root, sha256File } from "./supply-chain.mjs";

const out = process.argv[2];
if (!out) { console.error("Usage: node tools/archive-sources.mjs <folder>"); process.exit(1); }
fs.mkdirSync(out, { recursive: true });
const { grammars } = JSON.parse(fs.readFileSync(path.join(root, "grammars/sources.json"), "utf8"));
const sums = new Map();
for (const g of Object.values(grammars)) {
  if (g.path) continue; // kept in this repository, nothing to archive
  const repo = path.basename(g.url), name = `${repo}-${g.revision}.tar.gz`, file = path.join(out, name);
  if (!fs.existsSync(file)) {
    const repoDir = path.join(root, "build/src", repo);
    const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir }).toString().trim();
    if (head !== g.revision) throw new Error(`${repo} is at ${head}, not the pinned ${g.revision}; run npm run build:grammars first`);
    fs.writeFileSync(file, execFileSync("git", ["archive", "--format=tar.gz", g.revision], { cwd: repoDir, maxBuffer: 1 << 30 }));
  }
  sums.set(name, sha256File(file));
}
fs.writeFileSync(path.join(out, "SHA256SUMS"), [...sums].sort().map(([n, h]) => `${h}  ${n}`).join("\n") + "\n");
console.log(`${sums.size} source archives in ${out}`);
