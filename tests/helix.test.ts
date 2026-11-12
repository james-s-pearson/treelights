// Tests for Helix theme import. Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { Language, Parser } from "web-tree-sitter";
import { decodeTomlString, helixScopeFor, helixToTheme, parseToml, ThemeImportError, type HelixSource } from "../src/helix.ts";

const root = path.resolve(import.meta.dirname, "..");
await Parser.init();
const toml = await Language.load(path.join(root, "build/wasm/toml.wasm"));

const CAPTURES = ["keyword", "keyword.conditional", "keyword.return", "keyword.function", "number", "number.float",
  "boolean", "string", "string.escape", "comment", "comment.documentation", "variable.member", "module",
  "function.method.call", "type.builtin", "tag.attribute", "punctuation.bracket", "markup.strong"];

const BASE = `
"ui.background" = { bg = "bg" }
"ui.text" = "fg"
keyword = { fg = "purple", modifiers = ["italic"] }
"keyword.control" = "magenta"
"keyword.control.conditional" = { fg = "#AABBCC", modifiers = ["bold", "not-a-modifier"] }
"constant.numeric" = "orange"
"constant.builtin.boolean" = "orange"
string = "green"
"constant.character.escape" = "cyan"
comment = { fg = "grey", underline = { color = "red", style = "curl" } }
"comment.block.documentation" = "yellow"
"variable.other.member" = "teal"
namespace = "cyan"
function = "blue"
"type.builtin" = "not-a-colour"
attribute = "teal"
punctuation = "grey"
"markup.bold" = { modifiers = ["bold"] }

[palette]
bg = "#222436"
fg = "#c8d3f5"
purple = "#fca7ea"
orange = "#ff966c"
green = "#c3e88d"
cyan = "#86e1fc"
grey = "#828bb8"
yellow = "#ffc777"
teal = "#4fd6be"
blue = "#82aaff"
`;

const parse = (text: string) => parseToml(text, toml);
const none = () => undefined;

test("palette, terminal colours and Helix's longest-match fallback", () => {
  const { theme, missingParents } = helixToTheme({ name: "base", data: parse(BASE) }, CAPTURES, none);
  const c = theme.captures;
  assert.deepEqual(missingParents, []);
  assert.equal(theme.background, "#222436");
  assert.equal(theme.foreground, "#c8d3f5");
  assert.equal(theme.type, "dark");
  assert.deepEqual(c["keyword"], { fg: "#fca7ea", italic: true });
  assert.deepEqual(c["keyword.conditional"], { fg: "#aabbcc", bold: true }); // unknown modifier ignored
  assert.deepEqual(c["keyword.return"], { fg: "#cd00cd" }); // falls back to keyword.control ("magenta" terminal colour)
  assert.deepEqual(c["keyword.function"], { fg: "#fca7ea", italic: true }); // falls back to keyword
  assert.deepEqual(c["number"], { fg: "#ff966c" });
  assert.deepEqual(c["number.float"], { fg: "#ff966c" });
  assert.deepEqual(c["boolean"], { fg: "#ff966c" });
  assert.deepEqual(c["string.escape"], { fg: "#86e1fc" });
  assert.deepEqual(c["comment"], { fg: "#828bb8", undercurl: true });
  assert.deepEqual(c["comment.documentation"], { fg: "#ffc777" });
  assert.deepEqual(c["variable.member"], { fg: "#4fd6be" });
  assert.deepEqual(c["module"], { fg: "#86e1fc" });
  assert.deepEqual(c["function.method.call"], { fg: "#82aaff" });
  assert.equal(c["type.builtin"], undefined); // invalid colour is ignored
  assert.deepEqual(c["tag.attribute"], { fg: "#4fd6be" });
  assert.deepEqual(c["markup.strong"], { bold: true });
});

test("inherits: child keys and palette override the parent's", () => {
  const library = (n: string): HelixSource | undefined => (n === "base" ? { name: "base", data: parse(BASE) } : undefined);
  const child = parse(`inherits = "base"\nstring = "pink"\n[palette]\npink = "#ff00aa"\nbg = "#e1e2e7"\n`);
  const { theme, missingParents } = helixToTheme({ name: "child", data: child }, CAPTURES, library);
  assert.deepEqual(missingParents, []);
  assert.deepEqual(theme.captures["string"], { fg: "#ff00aa" });
  assert.deepEqual(theme.captures["number"], { fg: "#ff966c" }); // from the parent
  assert.equal(theme.background, "#e1e2e7"); // parent's key, child's palette
  assert.equal(theme.type, "light");
  assert.equal(theme.name, "child (Helix)");
});

test("inherits: a missing parent is reported, not fatal", () => {
  const { missingParents, mappedCaptures } = helixToTheme(
    { name: "orphan", data: parse(`inherits = "nowhere"\nstring = "#123456"\n`) }, CAPTURES, none);
  assert.deepEqual(missingParents, ["nowhere"]);
  assert.equal(mappedCaptures, 1);
});

test("inherits: a loop is rejected", () => {
  const a: HelixSource = { name: "a", data: parse(`inherits = "b"`) };
  const b: HelixSource = { name: "b", data: parse(`inherits = "a"`) };
  assert.throws(() => helixToTheme(a, CAPTURES, (n) => (n === "a" ? a : b)), ThemeImportError);
});

test("broken TOML and oversized files are rejected", () => {
  assert.throws(() => parse(`keyword = { fg = "#ffffff"`), ThemeImportError);
  assert.throws(() => parse(`= "no key"`), ThemeImportError);
  assert.throws(() => parse("a".repeat(256 * 1024 + 1)), ThemeImportError);
});

test("string decoding follows TOML", () => {
  assert.equal(decodeTomlString(`"a\\tb\\u00e9\\"q\\""`), 'a\tbé"q"');
  assert.equal(decodeTomlString(`'C:\\path'`), "C:\\path");
  assert.equal(decodeTomlString(`"""\nline1\nline2"""`), "line1\nline2");
  assert.throws(() => decodeTomlString(`"bad \\q"`), ThemeImportError);
});

test("Neovim captures map to Helix scopes", () => {
  assert.equal(helixScopeFor("keyword.conditional.ternary"), "keyword.control.conditional.ternary");
  assert.equal(helixScopeFor("number.float"), "constant.numeric.float");
  assert.equal(helixScopeFor("variable.member"), "variable.other.member");
  assert.equal(helixScopeFor("function.call"), "function.call");
});

test("every bundled Helix theme converts to a usable theme", async () => {
  const { bundledHelix } = await import("../src/generated/helix-themes.ts");
  const { captureNames } = await import("../src/generated/captures.ts");
  const lib = (n: string) => bundledHelix.find((h) => h.name === n);
  assert.ok(bundledHelix.length >= 9);
  for (const h of bundledHelix) {
    const { theme, missingParents, mappedCaptures } = helixToTheme(h, captureNames, lib);
    assert.deepEqual(missingParents, [], `${h.name} is missing a parent`);
    assert.ok(mappedCaptures > 40, `${h.name}: only ${mappedCaptures} captures`);
    assert.match(theme.background ?? "", /^#[0-9a-f]{6}$/, `${h.name} has no background`);
    assert.ok(theme.captures["keyword"]?.fg && theme.captures["string"]?.fg && theme.captures["comment"]?.fg, `${h.name} lacks basics`);
  }
  const storm = helixToTheme(lib("tokyonight_storm")!, captureNames, lib).theme;
  const night = helixToTheme(lib("tokyonight")!, captureNames, lib).theme;
  assert.notEqual(storm.background, night.background); // storm overrides the background
  assert.deepEqual(storm.captures["keyword"], night.captures["keyword"]); // and inherits the rest
});
