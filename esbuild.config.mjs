import esbuild from "esbuild";
import { execFileSync } from "node:child_process";

const prod = process.argv[2] === "production";
execFileSync("node", ["tools/gen-registry.mjs"], { stdio: "inherit" });
execFileSync("node", ["tools/gen-helix.ts"], { stdio: "inherit" });

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "cjs",
  target: "es2022",
  platform: "browser",
  outfile: "main.js",
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", "fs", "fs/promises", "module", "path", "url"],
  loader: { ".wasm": "binary", ".z": "binary", ".scm": "text" },
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  minify: false, // readable output for Obsidian's review
  legalComments: "inline",
});
if (prod) { await ctx.rebuild(); await ctx.dispose(); } else { await ctx.watch(); }
