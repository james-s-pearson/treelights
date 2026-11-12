// Builds Treelights' own theme files from named colour roles:
// - Neon Alley (dark and light), in the palette of the Neon Alley
//   Obsidian theme
// - Follow Obsidian theme: uses the code colours of whatever Obsidian
//   theme is active (the --code-* variables), assigned the way Obsidian's
//   own highlighter assigns them
// Usage: node tools/make-themes.mjs   (writes themes/*.json)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Capture -> colour role (plus style), shared by every generated theme. */
const ROLES = {
  variable: "text",
  "variable.builtin": "builtin",
  "variable.parameter": "parameter",
  "variable.member": "field",
  property: "field",
  constant: "value",
  "constant.builtin": "builtin",
  boolean: "value",
  number: "value",
  string: "string",
  character: "string",
  "string.escape": "special",
  "string.regexp": "special",
  "string.special": "special",
  "character.special": "special",
  keyword: "keyword",
  "keyword.operator": "keyword",
  function: "function",
  "function.builtin": "function",
  constructor: "type",
  type: "type",
  "type.builtin": "type",
  module: "type",
  "module.builtin": "builtin",
  attribute: "parameter",
  label: "function",
  operator: "operator",
  punctuation: "punctuation",
  "punctuation.special": "keyword",
  comment: ["comment", { italic: true }],
  "comment.error": "builtin",
  "comment.warning": "parameter",
  "comment.todo": "function",
  "comment.note": "type",
  tag: "builtin",
  "tag.attribute": "parameter",
  "tag.delimiter": "punctuation",
  "markup.heading": ["value", { bold: true }],
  "markup.strong": [null, { bold: true }],
  "markup.italic": [null, { italic: true }],
  "markup.strikethrough": [null, { strikethrough: true }],
  "markup.link": ["type", { underline: true }],
  "markup.link.label": "function",
  "markup.raw": "string",
  "markup.list": "keyword",
  "markup.quote": ["comment", { italic: true }],
  "diff.plus": "string",
  "diff.minus": "builtin",
  "diff.delta": "parameter",
  error: "builtin",
};

function build(name, type, palette, extra = {}) {
  const captures = {};
  for (const [capture, spec] of Object.entries(ROLES)) {
    const [role, style] = Array.isArray(spec) ? spec : [spec, {}];
    const fg = role ? palette[role] : undefined;
    captures[capture] = { ...(fg ? { fg } : {}), ...style };
  }
  return { name, type, ...extra, source: "Treelights (tools/make-themes.mjs)", captures };
}

// Neon Alley palettes (from the Neon Alley theme's dark and light colours)
const neonDark = {
  text: "#eceef2", comment: "#8c93a0", operator: "#a0a6b2", punctuation: "#a0a6b2",
  keyword: "#ff3fd2", function: "#3de0ff", type: "#4da3ff", string: "#b6ff3b",
  value: "#ff6b1a", parameter: "#ffc83d", field: "#2fd6c3", builtin: "#ff4545",
  special: "#ff3fd2",
};
const neonLight = {
  text: "#15181d", comment: "#5c6370", operator: "#4b5260", punctuation: "#4b5260",
  keyword: "#b0129a", function: "#00728b", type: "#1d67c1", string: "#427300",
  value: "#b54200", parameter: "#915c00", field: "#00756a", builtin: "#c81e1e",
  special: "#b0129a",
};

// Obsidian's code colour variables, assigned as Obsidian assigns them to
// its own highlighter's tokens (function, keyword, string, value, ...)
const obsidian = {
  text: "var(--code-normal)", comment: "var(--code-comment)", operator: "var(--code-operator)",
  punctuation: "var(--code-punctuation)", keyword: "var(--code-keyword)", function: "var(--code-function)",
  type: "var(--code-function)", string: "var(--code-string)", value: "var(--code-value)",
  parameter: "var(--code-property)", field: "var(--code-property)", builtin: "var(--code-tag)",
  special: "var(--code-important)",
};

const themes = [
  build("Neon Alley (dark)", "dark", neonDark, { background: "#0c0d10", foreground: neonDark.text }),
  build("Neon Alley (light)", "light", neonLight, { background: "#e8ebf0", foreground: neonLight.text }),
  // no background or foreground: the Obsidian theme's own are kept
  build("Follow Obsidian theme", "any", obsidian),
];
const files = ["neon-alley-dark.json", "neon-alley-light.json", "obsidian.json"];
themes.forEach((t, i) => fs.writeFileSync(path.join(root, "themes", files[i]), JSON.stringify(t, null, 2) + "\n"));
console.log(`wrote ${files.map((f) => `themes/${f}`).join(", ")}`);
