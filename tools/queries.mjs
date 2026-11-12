// Resolve a language's query files the way Neovim does: a file starting
// with "; inherits: a,b" includes those languages' files first (parents
// before children, each once). Returns the list of files in order.
import fs from "node:fs";
import path from "node:path";

export function queryFiles(root, lang, kind, seen = new Set()) {
  if (seen.has(lang)) return [];
  seen.add(lang);
  const file = path.join(root, "queries", lang, `${kind}.scm`);
  if (!fs.existsSync(file)) return [];
  const first = fs.readFileSync(file, "utf8").split("\n", 1)[0];
  const m = /^;+\s*inherits\s*:\s*(.+)$/.exec(first);
  const parents = m ? m[1].split(",").map((s) => s.trim().replace(/^\((.*)\)$/, "$1")).filter(Boolean) : [];
  return [...parents.flatMap((p) => queryFiles(root, p, kind, seen)), file];
}
