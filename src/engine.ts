// Treelights highlighting engine.
//
// Parses code with Tree-sitter and runs Neovim-style highlight and
// injection queries, producing coloured spans. It mirrors how Neovim's
// Tree-sitter highlighter decides which capture wins on each character,
// so a Neovim colour scheme exported to a theme file looks the same.
//
// The engine has no Obsidian dependency: the plugin and the Node tests
// both use it.

import type { Language, Node, Parser, Query, QueryMatch, QueryPredicate } from "web-tree-sitter";

/** A highlighted range in the source text. */
export interface Span {
  start: number; // UTF-16 offset in the source string (inclusive)
  end: number; // exclusive
  capture: string; // for example "keyword.return"
  lang: string; // language whose query produced the capture
  priority: number; // Neovim priority (default 100)
  depth: number; // injection depth: injected code draws on top
  order: number; // tie-breaker: later wins, as in Neovim
}

export interface LanguageEntry {
  language: Language;
  highlights?: Query;
  injections?: Query;
}

/** Supplies languages by name; returns undefined if not available. */
export type LanguageProvider = (name: string) => LanguageEntry | undefined;

const DEFAULT_PRIORITY = 100;

// ---------------------------------------------------------------------
// Query text preparation

/**
 * Convert a Lua pattern (as used by Neovim's #lua-match?) to a JavaScript
 * regular expression source.
 */
export function luaPatternToRegex(pattern: string): string {
  const classes: Record<string, string> = {
    a: "A-Za-z", d: "0-9", l: "a-z", s: "\\s", u: "A-Z", w: "A-Za-z0-9",
    x: "0-9A-Fa-f", p: "!-/:-@\\[-`{-~", c: "\\x00-\\x1f",
  };
  let out = "";
  let inSet = false;
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "%") {
      const next = pattern[++i];
      if (next === undefined) break;
      const lower = next.toLowerCase();
      if (classes[lower]) {
        const body = classes[lower];
        if (next === lower) out += inSet ? body : `[${body}]`;
        else out += inSet ? "" : `[^${body}]`; // negated class outside a set
      } else {
        out += "\\" + next; // escaped literal such as %. or %%
      }
      continue;
    }
    if (inSet) {
      if (ch === "]") inSet = false;
      out += ch === "\\" ? "\\\\" : ch;
      continue;
    }
    switch (ch) {
      case "[": inSet = true; out += "["; break;
      case "-": out += "*?"; break; // Lua's lazy repetition
      case ".": out += "[\\s\\S]"; break;
      case "\\": case "/": case "{": case "}": case "|": out += "\\" + ch; break;
      default: out += ch;
    }
  }
  return out;
}

/**
 * Turn a Neovim query into one web-tree-sitter can compile:
 * - drop ";; extends" / "; inherits" headers (combining is done by the caller)
 * - rewrite #lua-match? as #match? with an equivalent regex
 * - drop Neovim's capture-scoped "#set! @capture key value" (link targets,
 *   comment strings): it has no effect on colours and web-tree-sitter
 *   only accepts "#set! key value"
 */
export function prepareQuery(text: string): string {
  return text
    .replace(/\(#set!\s+@[\w.]+\s+(?:"(?:[^"\\]|\\.)*"|[^\s)"]+)(?:\s+(?:"(?:[^"\\]|\\.)*"|[^\s)"]+))?\s*\)/g, "")
    .replace(/^\s*;+\s*(extends|inherits:.*)\s*$/gm, "")
    .replace(/\(#(not-)?lua-match\?\s+(@[\w.]+)\s+"((?:[^"\\]|\\.)*)"\)/g,
      (_m: string, not: string | undefined, cap: string, pat: string) => {
        const lua = pat.replace(/\\(.)/g, "$1");
        const re = luaPatternToRegex(lua).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return `(#${not ? "not-" : ""}match? ${cap} "${re}")`;
      });
}

// ---------------------------------------------------------------------
// Neovim-specific predicates and directives that web-tree-sitter leaves
// to the caller

function nodeFor(match: QueryMatch, name: string): Node | undefined {
  return match.captures.find((c) => c.name === name)?.node;
}

function passesCustomPredicates(match: QueryMatch, preds: QueryPredicate[]): boolean {
  for (const p of preds) {
    const op = p.operator;
    if (op === "has-parent?" || op === "not-has-parent?") {
      const [capArg, ...types] = p.operands;
      const node = capArg && "name" in capArg ? nodeFor(match, capArg.name) : undefined;
      const parentType = node?.parent?.type;
      const hit = types.some((t) => "value" in t && t.value === parentType);
      if ((op === "has-parent?") !== hit) return false;
    } else if (op === "has-ancestor?" || op === "not-has-ancestor?") {
      const [capArg, ...types] = p.operands;
      let node = capArg && "name" in capArg ? nodeFor(match, capArg.name)?.parent : undefined;
      let hit = false;
      while (node) {
        if (types.some((t) => "value" in t && t.value === node!.type)) { hit = true; break; }
        node = node.parent;
      }
      if ((op === "has-ancestor?") !== hit) return false;
    } else if (op === "contains?") {
      const [capArg, ...words] = p.operands;
      const text = capArg && "name" in capArg ? nodeFor(match, capArg.name)?.text ?? "" : "";
      if (!words.some((w) => "value" in w && text.includes(w.value))) return false;
    }
    // Directives (offset!, gsub!, trim!) are applied where they matter.
  }
  return true;
}

/** Range of a captured node after any #offset! directive for it. */
function rangeFor(match: QueryMatch, name: string, node: Node, preds: QueryPredicate[],
  text: string, lineStarts: number[]): [number, number] {
  let start = node.startIndex;
  let end = node.endIndex;
  for (const p of preds) {
    if (p.operator !== "offset!") continue;
    const [capArg, sr, sc, er, ec] = p.operands;
    if (!capArg || !("name" in capArg) || capArg.name !== name) continue;
    const n = (o: (typeof p.operands)[number]) => Number("value" in o ? o.value : 0);
    const startRow = node.startPosition.row + n(sr);
    const endRow = node.endPosition.row + n(er);
    start = (lineStarts[startRow] ?? 0) + node.startPosition.column + n(sc);
    end = (lineStarts[endRow] ?? 0) + node.endPosition.column + n(ec);
    if (startRow !== node.startPosition.row || endRow !== node.endPosition.row) {
      // rare multi-row offsets: fall back to byte arithmetic
      start = node.startIndex + n(sc);
      end = node.endIndex + n(ec);
    }
  }
  void match; void text;
  return [Math.max(0, start), Math.max(start, end)];
}

function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

// ---------------------------------------------------------------------
// Highlighting

export interface HighlightOptions {
  maxDepth?: number; // nested injections (default 4)
}

/**
 * Highlight `text` written in `lang`. Returns spans in the order Neovim
 * would draw them; use paint() to resolve them per character.
 */
export function highlight(text: string, lang: string, provider: LanguageProvider,
  parser: Parser, options: HighlightOptions = {}): Span[] {
  const spans: Span[] = [];
  let order = 0;
  const maxDepth = options.maxDepth ?? 4;

  const visit = (source: string, offset: number, name: string, depth: number, parentLang = name) => {
    const entry = provider(name);
    if (!entry) return;
    parser.setLanguage(entry.language);
    const tree = parser.parse(source);
    if (!tree) return;
    const lineStarts = lineStartsOf(source);

    if (entry.highlights) {
      const q = entry.highlights;
      // captures() yields captures in document order and, for the same
      // node, in pattern order: the order Neovim draws them in.
      for (const cap of q.captures(tree.rootNode)) {
        if (cap.name.startsWith("_") || cap.name === "spell" || cap.name === "nospell") continue;
        const preds = q.predicatesForPattern(cap.patternIndex);
        const match = { patternIndex: cap.patternIndex, captures: [cap] } as unknown as QueryMatch;
        if (!passesCustomPredicates(match, preds)) continue;
        const pri = Number(cap.setProperties?.priority ?? DEFAULT_PRIORITY);
        const [s, e] = rangeFor(match, cap.name, cap.node, preds, source, lineStarts);
        if (e <= s) continue;
        spans.push({ start: offset + s, end: offset + e, capture: cap.name, lang: name,
          priority: pri, depth, order: order++ });
      }
    }

    if (entry.injections && depth < maxDepth) {
      const q = entry.injections;
      const combined = new Map<string, Array<[number, number]>>();
      for (const match of q.matches(tree.rootNode)) {
        const preds = q.predicatesForPattern(match.patternIndex);
        if (!passesCustomPredicates(match, preds)) continue;
        let injLang = match.setProperties?.["injection.language"] as string | undefined;
        const langNode = nodeFor(match, "injection.language");
        if (langNode) injLang = langNode.text;
        if (match.setProperties && "injection.self" in match.setProperties) injLang = name;
        if (match.setProperties && "injection.parent" in match.setProperties) injLang = parentLang;
        const content = match.captures.find((c) => c.name === "injection.content");
        if (!content || !injLang) continue;
        injLang = normaliseLanguage(injLang);
        const [s, e] = rangeFor(match, "injection.content", content.node, preds, source, lineStarts);
        if (e <= s) continue;
        if (match.setProperties && "injection.combined" in match.setProperties) {
          const list = combined.get(injLang) ?? [];
          list.push([s, e]);
          combined.set(injLang, list);
        } else {
          visit(source.slice(s, e), offset + s, injLang, depth + 1, name);
        }
      }
      // Combined injections: parse the pieces as one document. Each piece
      // keeps its own position; text between pieces is blanked out.
      for (const [injLang, ranges] of combined) {
        const chars: string[] = source.split("").map((c) => (c === "\n" ? "\n" : " "));
        for (const [s, e] of ranges) for (let i = s; i < e; i++) chars[i] = source[i];
        visit(chars.join(""), offset, injLang, depth + 1, name);
      }
      parser.setLanguage(entry.language);
    }
    tree.delete();
  };

  visit(text, 0, lang, 0);
  return spans;
}

/** Map code-fence and injection names to Tree-sitter language names. */
export function normaliseLanguage(name: string): string {
  const n = name.toLowerCase();
  return LANGUAGE_ALIASES[n] ?? n;
}

/** Other code-fence names that select a grammar. */
export const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript", mjs: "javascript", cjs: "javascript", jsx: "javascript",
  ts: "typescript", py: "python", python3: "python",
  sh: "bash", shell: "bash", zsh: "bash", shellscript: "bash",
  kql: "kusto", yar: "yara",
  md: "markdown", vimscript: "vim", viml: "vim",
  h: "c", "c++": "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
  yml: "yaml", jsonc: "json", htm: "html", svg: "xml",
  ps1: "powershell", pwsh: "powershell", ps: "powershell",
  docker: "dockerfile", tf: "terraform", tfvars: "terraform",
  gitconfig: "git_config", patch: "diff", cfg: "ini", conf: "ini",
};

/**
 * Resolve spans to one capture per character, the way Neovim stacks
 * extmarks: higher priority wins, then injected code over its host, then
 * the later capture. Returns, for each character, the winning span index
 * (or -1), considering only captures that the `hasStyle` callback says
 * actually set a style (captures without a colour let lower ones show).
 */
export function paint(text: string, spans: Span[], hasStyle: (s: Span) => boolean): Int32Array {
  const winner = new Int32Array(text.length).fill(-1);
  const ranked = spans
    .map((s, i) => [s, i] as const)
    .filter(([s]) => hasStyle(s))
    .sort(([a], [b]) => a.priority - b.priority || a.depth - b.depth || a.order - b.order);
  for (const [s, i] of ranked) {
    for (let c = s.start; c < s.end && c < text.length; c++) winner[c] = i;
  }
  return winner;
}
