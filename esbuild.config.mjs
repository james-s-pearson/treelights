import esbuild from "esbuild";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const prod = process.argv[2] === "production";
execFileSync("node", ["tools/gen-registry.mjs"], { stdio: "inherit" });
execFileSync("node", ["tools/gen-styles.mjs"], { stdio: "inherit" });
execFileSync("node", ["tools/gen-helix.ts"], { stdio: "inherit" });

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2022",
  platform: "browser",
  outfile: "main.js",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  // web-tree-sitter has a Node.js path that reads files with "fs"; Treelights
  // never uses it (it passes every grammar as bytes), so Node's modules are
  // replaced with empty ones and no file-system code ends up in main.js
  plugins: [{
    name: "no-node-modules",
    setup(build) {
      build.onResolve({ filter: /^(node:)?(fs|fs\/promises|module|path|url)$/ }, (a) => ({ path: a.path, namespace: "empty-node-module" }));
      build.onLoad({ filter: /.*/, namespace: "empty-node-module" }, () => ({ contents: "module.exports = {};", loader: "js" }));
      // Code paths in the runtime that Treelights never uses are removed
      // from the bundled copy, so main.js holds no file-system or network
      // code:
      // - the Node.js branch, which reads files with its own require("fs")
      //   (no bundler can see those calls)
      // - running JavaScript embedded in a grammar (with eval)
      // - loading a grammar or the runtime from a web address; Treelights
      //   always passes bytes (Parser.init({ wasmBinary }) and
      //   Language.load(bytes)), so these paths are unreachable. They now
      //   throw instead of downloading.
      // Each swap must match exactly the expected number of times, or the
      // build stops: a changed runtime has to be reviewed first.
      build.onLoad({ filter: /web-tree-sitter[\\/]web-tree-sitter\.js$/ }, async (a) => {
        let code = await fs.promises.readFile(a.path, "utf8");
        const swaps = [
          ['var fs = require("fs");', "var fs = {}; // Node-only branch, never used in Obsidian", 1],
          ['scriptDirectory = require("path").dirname(require("url").fileURLToPath(_scriptName)) + "/";', "scriptDirectory = \"\";", 1],
          ["await fetch(input)", "await treelightsNoNetwork(input)", 1],
          ["new XMLHttpRequest()", "treelightsNoNetwork()", 2],
          ["await fetch(url, {", "await treelightsNoNetwork(url, {", 1],
          ["fetch(binaryFile, {", "treelightsNoNetwork(binaryFile, {", 1],
          // A grammar's embedded JavaScript (EM_ASM / EM_JS) would be run
          // with eval. No Treelights grammar has any (the supply-chain check
          // refuses one that does), so these become errors instead.
          ["ASM_CONSTS[start] = eval(func);", "ASM_CONSTS[start] = treelightsNoEval(func);", 1],
          ["moduleExports[name] = eval(func);", "moduleExports[name] = treelightsNoEval(func);", 1],
        ];
        for (const [from, to, count] of swaps) {
          const found = code.split(from).length - 1;
          if (found !== count) throw new Error(`web-tree-sitter changed: "${from}" found ${found} times, expected ${count}; review the runtime before building`);
          code = code.split(from).join(to);
        }
        for (const pattern of [/\bfetch\(/, /XMLHttpRequest/, /require\("(fs|path|url)"\)/, /\beval\(/, /new Function\(/]) {
          if (pattern.test(code)) throw new Error(`web-tree-sitter still contains ${pattern}; review the runtime before building`);
        }
        code = 'function treelightsNoNetwork() { throw new Error("Treelights loads everything from inside main.js; network loading is removed."); }\n'
          + 'function treelightsNoEval() { throw new Error("Treelights does not run JavaScript embedded in a grammar."); }\n' + code;
        return { contents: code, loader: "js" };
      });
    },
  }],
  loader: { ".wasm": "binary", ".z": "binary", ".scm": "text" },
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  minify: false, // readable output for Obsidian's review
  legalComments: "inline",
});
if (prod) { await ctx.rebuild(); await ctx.dispose(); } else { await ctx.watch(); }
