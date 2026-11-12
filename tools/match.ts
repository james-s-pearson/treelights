// Compare Treelights with Neovim, character by character.
//
// Usage: node tools/match.ts <lang> <source-file> <nvim-dump> <theme.json> [queries-dir]
// The Neovim dump has one line per character: row, column, colour, italic
// (made by tools/dump-nvim.lua). Prints the match percentage and the most
// common differences.
import fs from "node:fs";
import path from "node:path";
import { Language, Parser, Query } from "web-tree-sitter";
import { highlight, paint, prepareQuery, type LanguageEntry } from "../src/engine.ts";
import { resolveStyle, type Theme } from "../src/theme.ts";
import { queryFiles } from "./queries.mjs";

const [lang, srcFile, dumpFile, themeFile, queriesDir = "queries"] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, "..");
await Parser.init();
const parser = new Parser();
const cache = new Map<string, LanguageEntry | undefined>();

function readQuery(name: string, kind: string): string | undefined {
  const packs = (process.env.PACKS ?? "").split(",").filter(Boolean);
  const extra = packs.flatMap((pack) => {
    const pdir = path.join(root, "query-packs", pack, name);
    return fs.existsSync(pdir) ? fs.readdirSync(pdir).filter((f) => f.startsWith(`${kind}.`)).map((f) => path.join(pdir, f)) : [];
  });
  const files = [...queryFiles(root, name, kind), ...extra];
  return files.length ? files.map((f) => fs.readFileSync(f, "utf8")).join("\n") : undefined;
}

async function load(name: string): Promise<LanguageEntry | undefined> {
  const wasm = path.join(root, "build/wasm", `${name}.wasm`);
  if (!fs.existsSync(wasm)) return undefined;
  const language = await Language.load(wasm);
  const mk = (kind: string) => {
    const text = readQuery(name, kind);
    return text ? new Query(language, prepareQuery(text)) : undefined;
  };
  return { language, highlights: mk("highlights"), injections: mk("injections") };
}

const names = fs.readdirSync(path.join(root, "build/wasm")).filter((f) => f.endsWith(".wasm")).map((f) => f.slice(0, -5));
for (const n of names) cache.set(n, await load(n));

const theme: Theme = JSON.parse(fs.readFileSync(themeFile, "utf8"));
// keep the final newline: Neovim hands the parser complete lines
const raw = fs.readFileSync(srcFile, "utf8");
const text = raw.endsWith("\n") ? raw : raw + "\n";
const spans = highlight(text, lang, (n) => cache.get(n), parser);
const styleOf = (i: number) => (i < 0 ? undefined : resolveStyle(theme, spans[i].capture, spans[i].lang));
const win = paint(text, spans, (s) => !!resolveStyle(theme, s.capture, s.lang)?.fg);

const nv = new Map<string, [string, boolean]>();
for (const line of fs.readFileSync(dumpFile, "utf8").split("\n")) {
  if (!line) continue;
  const [r, c, col, it] = line.split("\t");
  nv.set(`${r}:${c}`, [col || (theme.foreground ?? ""), it === "true"]);
}

let total = 0, same = 0;
const diffs = new Map<string, number>();
let row = 0, col = 0;
for (let i = 0; i < text.length; i++) {
  const ch = text[i];
  if (ch === "\n") { row++; col = 0; continue; }
  if (ch.trim()) {
    const want = nv.get(`${row}:${col}`);
    const s = styleOf(win[i]);
    const got: [string, boolean] = [s?.fg ?? theme.foreground ?? "", !!s?.italic];
    if (want) {
      total++;
      if (want[0].toLowerCase() === got[0].toLowerCase() && want[1] === got[1]) same++;
      else {
        const word = text.slice(i, i + 12).split(/[\s(){}\[\],.:="']/)[0] || ch;
        const cap = win[i] >= 0 ? spans[win[i]].capture : "-";
        const key = `${JSON.stringify(word)} nvim ${want[0]}${want[1] ? " i" : ""}  treelights ${got[0]}${got[1] ? " i" : ""} (${cap})`;
        diffs.set(key, (diffs.get(key) ?? 0) + 1);
      }
    }
  }
  col += Buffer.byteLength(ch, "utf8"); // Neovim columns are bytes
}
console.log(`${lang}: ${same}/${total} characters match (${((100 * same) / total).toFixed(2)}%)`);
for (const [k, v] of [...diffs].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(String(v).padStart(4), k);
