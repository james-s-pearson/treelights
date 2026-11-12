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
      // The runtime's Node branch also calls its own require("fs") etc.,
      // which no bundler can see; remove those lines from the bundled copy.
      // The build stops if the runtime's code no longer looks as expected.
      build.onLoad({ filter: /web-tree-sitter[\\/]web-tree-sitter\.js$/ }, async (a) => {
        let code = await fs.promises.readFile(a.path, "utf8");
        const swaps = [
          ['var fs = require("fs");', "var fs = {}; // Node-only branch, never used in Obsidian"],
          ['scriptDirectory = require("path").dirname(require("url").fileURLToPath(_scriptName)) + "/";', "scriptDirectory = \"\";"],
        ];
        for (const [from, to] of swaps) {
          if (!code.includes(from)) throw new Error(`web-tree-sitter changed: "${from}" not found; review the Node branch before building`);
          code = code.replace(from, to);
        }
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
