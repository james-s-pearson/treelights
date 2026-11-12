// Import Helix editor themes (TOML) as Treelights themes.
//
// The TOML is read with the Tree-sitter TOML grammar Treelights already
// bundles, by a strict converter: any parse error rejects the file. A
// theme is data only: colours and font styles. Nothing in it is run.
//
// Helix and Neovim name highlight scopes slightly differently (Helix says
// "keyword.control.conditional" where Neovim says "keyword.conditional").
// For every capture Treelights uses, the converter finds the Helix scope
// that means the same thing and applies Helix's own rule: the longest
// matching scope wins.

import type { Language, Node } from "web-tree-sitter";
import { Parser } from "web-tree-sitter";
import type { Style, Theme } from "./theme.ts";

export const MAX_THEME_BYTES = 256 * 1024;

export type TomlValue = string | number | boolean | TomlValue[] | TomlTable;
export interface TomlTable { [key: string]: TomlValue }

export class ThemeImportError extends Error {}

// ---------------------------------------------------------------------
// TOML

/** Decode a TOML string node's text (basic, literal or multi-line). */
export function decodeTomlString(raw: string): string {
  if (raw.startsWith("'''")) return raw.slice(3, -3).replace(/^\r?\n/, "");
  if (raw.startsWith("'")) return raw.slice(1, -1);
  const multi = raw.startsWith('"""');
  let body = multi ? raw.slice(3, -3).replace(/^\r?\n/, "") : raw.slice(1, -1);
  if (multi) body = body.replace(/\\\r?\n\s*/g, ""); // line-ending backslash
  return body.replace(/\\(u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|.)/g, (_m, e: string) => {
    switch (e[0]) {
      case "n": return "\n";
      case "t": return "\t";
      case "r": return "\r";
      case "b": return "\b";
      case "f": return "\f";
      case '"': return '"';
      case "\\": return "\\";
      case "u": case "U": return String.fromCodePoint(parseInt(e.slice(1), 16));
      default: throw new ThemeImportError(`Invalid escape \\${e} in a string.`);
    }
  });
}

function keyParts(node: Node): string[] {
  switch (node.type) {
    case "bare_key": return [node.text];
    case "quoted_key": return [decodeTomlString(node.text)];
    case "dotted_key": return node.namedChildren.flatMap((c) => (c ? keyParts(c) : []));
    default: throw new ThemeImportError(`Unexpected key type ${node.type}.`);
  }
}

function valueOf(node: Node): TomlValue {
  switch (node.type) {
    case "string": return decodeTomlString(node.text);
    case "integer": return Number(node.text.replace(/_/g, ""));
    case "float": return Number(node.text.replace(/_/g, ""));
    case "boolean": return node.text === "true";
    case "array": return node.namedChildren.filter((c): c is Node => !!c && c.type !== "comment").map(valueOf);
    case "inline_table": {
      const t: TomlTable = {};
      for (const pair of node.namedChildren) if (pair && pair.type === "pair") assignPair(t, pair);
      return t;
    }
    case "local_date": case "local_time": case "local_date_time": case "offset_date_time":
      return node.text;
    default: throw new ThemeImportError(`Unsupported value type ${node.type}.`);
  }
}

function setPath(table: TomlTable, path: string[], value: TomlValue) {
  let t = table;
  for (const part of path.slice(0, -1)) {
    const next = t[part];
    if (next === undefined) t = (t[part] = {}) as TomlTable;
    else if (typeof next === "object" && !Array.isArray(next)) t = next;
    else throw new ThemeImportError(`Key "${path.join(".")}" conflicts with an earlier value.`);
  }
  t[path[path.length - 1]] = value;
}

function assignPair(table: TomlTable, pair: Node) {
  const [keyNode, valueNode] = pair.namedChildren.filter((c): c is Node => !!c && c.type !== "comment");
  if (!keyNode || !valueNode) throw new ThemeImportError("Incomplete key = value pair.");
  setPath(table, keyParts(keyNode), valueOf(valueNode));
}

/** Parse TOML text into plain data. Rejects anything that does not parse cleanly. */
export function parseToml(text: string, toml: Language): TomlTable {
  if (text.length > MAX_THEME_BYTES) throw new ThemeImportError("The file is too large to be a theme.");
  const parser = new Parser();
  try {
    parser.setLanguage(toml);
    const tree = parser.parse(text);
    if (!tree) throw new ThemeImportError("The file could not be read.");
    try {
      if (tree.rootNode.hasError) {
        const bad = findError(tree.rootNode);
        throw new ThemeImportError(`Not valid TOML${bad ? ` (line ${bad.startPosition.row + 1})` : ""}.`);
      }
      const root: TomlTable = {};
      for (const child of tree.rootNode.namedChildren) {
        if (!child || child.type === "comment") continue;
        if (child.type === "pair") assignPair(root, child);
        else if (child.type === "table" || child.type === "table_array_element") {
          const items = child.namedChildren.filter((c): c is Node => !!c && c.type !== "comment");
          const header = keyParts(items[0]);
          const section: TomlTable = {};
          for (const pair of items.slice(1)) if (pair.type === "pair") assignPair(section, pair);
          if (child.type === "table") {
            setPath(root, header, { ...(getPath(root, header) as TomlTable | undefined), ...section });
          } else {
            const list = (getPath(root, header) as TomlValue[] | undefined) ?? [];
            setPath(root, header, [...list, section]);
          }
        }
      }
      return root;
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }
}

function getPath(table: TomlTable, path: string[]): TomlValue | undefined {
  let v: TomlValue | undefined = table;
  for (const p of path) v = v && typeof v === "object" && !Array.isArray(v) ? v[p] : undefined;
  return v;
}

function findError(node: Node): Node | undefined {
  if (node.type === "ERROR" || node.isMissing) return node;
  for (const c of node.children) {
    const hit = c && findError(c);
    if (hit) return hit;
  }
  return undefined;
}

// ---------------------------------------------------------------------
// Helix -> Treelights

/** Helix's default palette: the 16 terminal colours (xterm defaults). */
const TERMINAL: Record<string, string> = {
  black: "#000000", red: "#cd0000", green: "#00cd00", yellow: "#cdcd00",
  blue: "#0000ee", magenta: "#cd00cd", cyan: "#00cdcd", gray: "#7f7f7f",
  "light-red": "#ff0000", "light-green": "#00ff00", "light-yellow": "#ffff00",
  "light-blue": "#5c5cff", "light-magenta": "#ff00ff", "light-cyan": "#00ffff",
  "light-gray": "#e5e5e5", white: "#ffffff",
};

/**
 * Neovim capture prefix -> Helix scope prefix, longest first. Captures
 * not listed use the same name in both editors.
 */
const NVIM_TO_HELIX: Array<[string, string]> = [
  ["keyword.conditional", "keyword.control.conditional"],
  ["keyword.repeat", "keyword.control.repeat"],
  ["keyword.import", "keyword.control.import"],
  ["keyword.return", "keyword.control.return"],
  ["keyword.exception", "keyword.control.exception"],
  ["keyword.coroutine", "keyword.control"],
  ["keyword.debug", "keyword.control"],
  ["keyword.type", "keyword.storage.type"],
  ["keyword.modifier", "keyword.storage.modifier"],
  ["variable.member", "variable.other.member"],
  ["module.builtin", "namespace"],
  ["module", "namespace"],
  ["number.float", "constant.numeric.float"],
  ["number", "constant.numeric.integer"],
  ["boolean", "constant.builtin.boolean"],
  ["character.special", "constant.character"],
  ["character", "constant.character"],
  ["string.escape", "constant.character.escape"],
  ["comment.documentation", "comment.block.documentation"],
  ["markup.strong", "markup.bold"],
  ["markup.link.label", "markup.link.label"],
  ["tag.attribute", "attribute"],
  ["tag.delimiter", "punctuation.bracket"],
];

const HELIX_MODIFIERS = new Set(["bold", "dim", "italic", "underlined", "slow_blink",
  "rapid_blink", "reversed", "hidden", "crossed_out"]);
const UNDERLINE_STYLES = new Set(["line", "curl", "dashed", "dotted", "double_line"]);

/** The Helix scope for a Neovim capture name. */
export function helixScopeFor(capture: string): string {
  for (const [nvim, helix] of NVIM_TO_HELIX) {
    if (capture === nvim || capture.startsWith(nvim + ".")) return helix + capture.slice(nvim.length);
  }
  return capture;
}

export interface HelixSource {
  name: string; // the file name without .toml, as Helix themes refer to each other
  data: TomlTable;
}

/** Merge a theme with the themes it inherits from (base first). */
function flatten(source: HelixSource, library: (name: string) => HelixSource | undefined,
  missing: Set<string>, seen = new Set<string>()): TomlTable {
  if (seen.has(source.name)) throw new ThemeImportError(`"${source.name}" inherits from itself.`);
  seen.add(source.name);
  const parentName = typeof source.data.inherits === "string" ? source.data.inherits : undefined;
  const parent = parentName ? library(parentName) : undefined;
  if (parentName && !parent) missing.add(parentName);
  const base = parent ? flatten(parent, library, missing, seen) : {};
  const own = { ...source.data };
  delete own.inherits;
  const palette = { ...((base.palette as TomlTable) ?? {}), ...((own.palette as TomlTable) ?? {}) };
  return { ...base, ...own, palette };
}

function colour(value: TomlValue | undefined, palette: TomlTable): string | undefined {
  if (typeof value !== "string") return undefined;
  const named = palette[value];
  const resolved = typeof named === "string" ? named : TERMINAL[value] ?? value;
  return /^#[0-9a-fA-F]{6}$/.test(resolved) ? resolved.toLowerCase() : undefined;
}

function styleOf(value: TomlValue, palette: TomlTable): Style | undefined {
  if (typeof value === "string") {
    const fg = colour(value, palette);
    return fg ? { fg } : undefined;
  }
  if (typeof value !== "object" || Array.isArray(value)) return undefined;
  const s: Style = {};
  const fg = colour(value.fg, palette);
  const bg = colour(value.bg, palette);
  if (fg) s.fg = fg;
  if (bg) s.bg = bg;
  const mods = Array.isArray(value.modifiers) ? value.modifiers.filter((m): m is string => typeof m === "string" && HELIX_MODIFIERS.has(m)) : [];
  if (mods.includes("bold")) s.bold = true;
  if (mods.includes("italic")) s.italic = true;
  if (mods.includes("crossed_out")) s.strikethrough = true;
  if (mods.includes("underlined")) s.underline = true;
  const ul = value.underline;
  if (ul && typeof ul === "object" && !Array.isArray(ul)) {
    const style = typeof ul.style === "string" && UNDERLINE_STYLES.has(ul.style) ? ul.style : "line";
    if (style === "curl") s.undercurl = true; else s.underline = true;
  }
  return Object.keys(s).length ? s : undefined;
}

function relativeLuminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

export interface ImportResult {
  theme: Theme;
  missingParents: string[]; // themes it inherits from that are not available
  mappedCaptures: number;
}

/**
 * Turn a Helix theme into a Treelights theme for the given capture names
 * (every capture used by Treelights' queries).
 */
export function helixToTheme(source: HelixSource, captures: string[],
  library: (name: string) => HelixSource | undefined): ImportResult {
  const missing = new Set<string>();
  const data = flatten(source, library, missing);
  const palette = (data.palette as TomlTable) ?? {};
  const scopes = new Map<string, Style>();
  for (const [key, value] of Object.entries(data)) {
    if (key === "palette" || key.startsWith("ui.")) continue;
    const s = styleOf(value, palette);
    if (s) scopes.set(key, s);
  }
  // Helix's rule: the longest matching scope wins
  const lookup = (scope: string): Style | undefined => {
    const parts = scope.split(".");
    for (let n = parts.length; n > 0; n--) {
      const s = scopes.get(parts.slice(0, n).join("."));
      if (s) return s;
    }
    return undefined;
  };
  const out: Record<string, Style> = {};
  for (const capture of captures) {
    const s = lookup(helixScopeFor(capture));
    if (s) out[capture] = s;
  }
  const bgStyle = styleOf(data["ui.background"] ?? "", palette);
  const textStyle = styleOf(data["ui.text"] ?? "", palette);
  const background = bgStyle?.bg ?? bgStyle?.fg;
  const foreground = textStyle?.fg;
  const type: "dark" | "light" = background && relativeLuminance(background) > 0.4 ? "light" : "dark";
  return {
    theme: { name: `${source.name} (Helix)`, type, background, foreground, captures: out },
    missingParents: [...missing],
    mappedCaptures: Object.keys(out).length,
  };
}
