// Makes the files for a GitHub release, the same way every time:
// checks the build tools, builds, runs every test, then collects
// main.js, manifest.json and styles.css with their SHA-256 fingerprints.
// Usage: node tools/release.mjs   -> build/release/<version>/
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkTools, root, sha256File, stopOn } from "./supply-chain.mjs";

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const versions = JSON.parse(fs.readFileSync(path.join(root, "versions.json"), "utf8"));
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) stopOn([`manifest version "${manifest.version}" is not x.y.z`], "release");
if (versions[manifest.version] !== manifest.minAppVersion) stopOn([`versions.json has no entry ${manifest.version}: ${manifest.minAppVersion}`], "release");

stopOn(checkTools(), "build tools");
const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, stdio: "inherit" });
run("npm", ["run", "build"]); // checks every grammar's fingerprint and imports
run("npm", ["run", "typecheck"]); // the tests strip types without checking them
run("npm", ["test"]);

const out = path.join(root, "build/release", manifest.version);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const files = ["main.js", "manifest.json", "styles.css"];
for (const f of files) fs.copyFileSync(path.join(root, f), path.join(out, f));
const sums = files.map((f) => `${sha256File(path.join(out, f))}  ${f}`).join("\n") + "\n";
fs.writeFileSync(path.join(out, "SHA256SUMS"), sums);
console.log(`\nRelease ${manifest.version} files in ${path.relative(root, out)}:\n${sums}`);
