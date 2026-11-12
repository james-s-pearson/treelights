// Highlight one code sample and report timing (used to find hangs).
// Usage: PACKS=lazyvim node tools/stress.ts <lang> <file>
import fs from "node:fs";
import path from "node:path";
import { Language, Parser, Query } from "web-tree-sitter";
import { highlight, prepareQuery, type LanguageEntry } from "../src/engine.ts";
import { queryFiles } from "./queries.mjs";

const [lang, file] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, "..");
await Parser.init();
const parser = new Parser();
const packs = (process.env.PACKS ?? "").split(",").filter(Boolean);
const cache = new Map<string, LanguageEntry>();
for (const f of fs.readdirSync(path.join(root, "build/wasm")).filter((f) => f.endsWith(".wasm"))) {
  const name = f.slice(0, -5);
  const language = await Language.load(path.join(root, "build/wasm", f));
  const q = (kind: string) => {
    const parts = [...queryFiles(root, name, kind),
      ...packs.map((p) => path.join(root, "query-packs", p, name, `${kind}.${p}.scm`)).filter((p) => fs.existsSync(p))];
    return parts.length ? new Query(language, prepareQuery(parts.map((p) => fs.readFileSync(p, "utf8")).join("\n"))) : undefined;
  };
  cache.set(name, { language, highlights: q("highlights"), injections: q("injections") });
}
const text = fs.readFileSync(file, "utf8");
const t0 = performance.now();
const spans = highlight(text, lang, (n) => cache.get(n), parser);
process.stdout.write(`${path.basename(file)}: ${text.length} chars, ${spans.length} spans, ${Math.round(performance.now() - t0)} ms\n`);
