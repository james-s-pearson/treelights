// Splits a generated parser's lexer function (ts_lex) into several
// smaller functions, without changing what it does.
//
// Why: V8 13.8 (Obsidian 1.15 / Electron 37) runs out of compiler memory
// when its optimising compiler (TurboFan) compiles a very large
// WebAssembly function, and that kills the whole Obsidian window. The Vim
// grammar's ts_lex is one function of about 36,000 lines (3,504 states,
// about 800 KB of WebAssembly). Split into parts of a few hundred states,
// each part is small enough to compile safely.
//
// How: ts_lex is a loop around `switch (state)`. Each state ends with one
// of the lexer macros: ADVANCE/SKIP/ADVANCE_MAP (go to another state),
// END_STATE (stop) or ACCEPT_TOKEN (record a token). The states are moved,
// unchanged, into part functions in which those macros report the next
// state to the caller instead of jumping to it; ts_lex keeps the loop and
// calls the part that holds the current state. The same steps run in the
// same order.
//
// The script checks the shape of the generated code and stops if it is
// not what it expects.
//
// Usage: node grammars/split-lexer.mjs <parser.c> <parts>
import fs from "node:fs";

const [file, partsArg] = process.argv.slice(2);
const parts = Number(partsArg);
if (!file || !(parts >= 2)) { console.error("Usage: node grammars/split-lexer.mjs <parser.c> <parts>"); process.exit(1); }

const fail = (msg) => { console.error(`split-lexer: ${msg}; ${file} left unchanged`); process.exit(1); };
const src = fs.readFileSync(file, "utf8");
const lines = src.split("\n");

const head = "static bool ts_lex(TSLexer *lexer, TSStateId state) {";
const start = lines.indexOf(head);
if (start < 0) fail("no ts_lex function");
if (lines.indexOf(head, start + 1) >= 0) fail("more than one ts_lex");
const expect = (i, text) => { if (lines[i] !== text) fail(`line ${i + 1}: expected "${text}", found "${lines[i]}"`); };
expect(start + 1, "  START_LEXER();");
expect(start + 2, "  eof = lexer->eof(lexer);");
expect(start + 3, "  switch (state) {");

// the cases, each from "    case N:" to the next one
let i = start + 4;
const cases = [];
while (true) {
  const m = /^    case (\d+):$/.exec(lines[i]);
  if (!m) break;
  let j = i + 1;
  while (!/^    (case \d+|default):$/.test(lines[j])) {
    if (j >= lines.length || /^}/.test(lines[j])) fail(`unterminated case ${m[1]}`);
    j++;
  }
  cases.push({ state: Number(m[1]), body: lines.slice(i, j) });
  i = j;
}
expect(i, "    default:");
expect(i + 1, "      return false;");
expect(i + 2, "  }");
expect(i + 3, "}");
const end = i + 3;
if (!cases.length) fail("no cases");
cases.forEach((c, k) => { if (c.state !== k) fail(`states are not numbered 0..n in order (found ${c.state} at ${k})`); });

// Only the lexer macros may control flow; anything else is unexpected
const body = cases.flatMap((c) => c.body).join("\n");
if (/\b(goto|return)\b/.test(body.replace(/\b(ADVANCE|SKIP|ADVANCE_MAP|END_STATE)\b/g, ""))) fail("a state uses goto or return directly");
if (/\b(result|skip|state)\b/.test(body.replace(/\b(ADVANCE|SKIP|ADVANCE_MAP|END_STATE|ACCEPT_TOKEN)\([^)]*\)/g, ""))) fail("a state uses the loop's variables directly");

const per = Math.ceil(cases.length / parts);
const groups = [];
for (let k = 0; k < cases.length; k += per) groups.push(cases.slice(k, k + per));

const out = [];
out.push(
  `// ts_lex split into ${groups.length} parts by grammars/split-lexer.mjs (Treelights):`,
  "// each part returns 1 to go to *next, 0 to stop (return result) or 2 to",
  "// return false, exactly as the original single function did.",
  ...["ADVANCE", "SKIP", "ADVANCE_MAP", "ACCEPT_TOKEN", "END_STATE"].map((m) => `#pragma push_macro("${m}")`),
  "#undef ADVANCE", "#undef SKIP", "#undef ADVANCE_MAP", "#undef ACCEPT_TOKEN", "#undef END_STATE",
  "#define ADVANCE(state_value) { *next = (state_value); *skip = false; return 1; }",
  "#define SKIP(state_value) { *next = (state_value); *skip = true; return 1; }",
  "#define ADVANCE_MAP(...) { static const uint16_t map[] = { __VA_ARGS__ }; for (uint32_t i = 0; i < sizeof(map) / sizeof(map[0]); i += 2) { if (map[i] == lookahead) { *next = map[i + 1]; *skip = false; return 1; } } }",
  "#define ACCEPT_TOKEN(symbol_value) *result = true; lexer->result_symbol = symbol_value; lexer->mark_end(lexer);",
  "#define END_STATE() return 0;",
  "",
);
groups.forEach((g, k) => {
  out.push(
    `__attribute__((noinline)) static int ts_lex_part${k}(TSLexer *lexer, TSStateId state, TSStateId *next, bool *result, bool *skip, bool eof, int32_t lookahead) {`,
    "  switch (state) {",
    ...g.flatMap((c) => c.body),
    "    default:",
    "      return 2;",
    "  }",
    "}",
    "",
  );
});
out.push(
  ...["ADVANCE", "SKIP", "ADVANCE_MAP", "ACCEPT_TOKEN", "END_STATE"].map((m) => `#pragma pop_macro("${m}")`),
  "",
  head,
  "  TSStateId next = 0;",
  "  int r;",
  "  START_LEXER();",
  "  eof = lexer->eof(lexer);",
  ...groups.map((g, k) => {
    const last = g[g.length - 1].state;
    const call = `r = ts_lex_part${k}(lexer, state, &next, &result, &skip, eof, lookahead);`;
    return k === 0 ? `  if (state <= ${last}) ${call}` : `  else if (state <= ${last}) ${call}`;
  }),
  "  else r = 2;",
  "  if (r == 1) { state = next; goto next_state; }",
  "  if (r == 2) return false;",
  "  return result;",
  "}",
);

fs.writeFileSync(file, [...lines.slice(0, start), ...out, ...lines.slice(end + 1)].join("\n"));
console.log(`split-lexer: ts_lex (${cases.length} states) split into ${groups.length} parts of up to ${per} states`);
