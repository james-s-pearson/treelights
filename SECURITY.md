# Security

Status: draft.

Treelights was designed and directed by James Pearson. Its code and this
document were generated with AI assistance (Claude), then tested by
James. This page explains what Treelights does on your computer, what it
is built from, and the safeguards that protect you from the code of the
many open-source projects it depends on.

## In short

- **No network use.** Treelights makes no network requests. The only
  exception is one you start: Cmd-click (Ctrl-click on Windows and Linux)
  on a CVE, CWE or MITRE ATT&CK badge opens its public page (nvd.nist.gov,
  cwe.mitre.org or attack.mitre.org) in your web browser. No other address
  can be opened this way.
- **Your notes stay yours.** Treelights reads code blocks only to colour
  them on screen. It never changes your notes, and it collects nothing.
  Its settings are saved in its own plugin folder. Importing a Helix
  theme reads only the file you pick.
- **Language grammars are sealed off.** Each grammar runs as WebAssembly,
  which can use only its own memory. A build check makes sure no grammar
  can ask Treelights for anything beyond memory and text helpers (see
  below), so a grammar cannot reach your files, the network or the page.
- **Everything is pinned and fingerprinted.** Every outside source is
  fixed to an exact version, and every compiled grammar must match a
  recorded SHA-256 fingerprint, or the build stops.

## What runs where

### Inside Obsidian (what you install)

`main.js` is a single file. It contains:

- Treelights' own code
- web-tree-sitter, the official Tree-sitter runtime, pinned to an exact
  version
- the compiled language grammars, compressed
- highlight queries and themes (text data, not code)

Treelights gives web-tree-sitter every grammar as bytes from inside
`main.js`. The runtime's ability to download files is never used.

### On the developer's computer (building Treelights)

Only people who build Treelights from source run these:

- npm packages, pinned in `package-lock.json` with integrity hashes
- the `tree-sitter` program, which compiles grammars
- the WASI SDK, the compiler toolchain `tree-sitter` uses
- the grammar sources, fetched with git at pinned commits

Downloading a grammar runs none of its code. The build compiles the
grammar's C source to WebAssembly; it does not run the grammar's
JavaScript.

## Safeguards

1. **Pinned commits.** Every grammar in `grammars/sources.json` is pinned
   to a full commit hash. A commit hash is a fingerprint of the exact
   source, so a maintainer's later changes cannot reach Treelights. Tags
   and branch names are refused, because they can be moved.
2. **Import allow-list.** `tools/supply-chain.mjs` lists the only
   functions a grammar may ask for: memory, character checks, string
   helpers and assertions. A grammar asking for anything else stops the
   build.
3. **Fingerprints.** `grammars/checksums.json` holds the SHA-256 of every
   compiled grammar, of the `tree-sitter` program and of the WASI SDK.
   The grammar build and the plugin build both stop on any difference.
   The `tree-sitter` program is checked after every `npm install`,
   because its installer downloads it without checking it.
4. **Reproducible builds.** Building the same source with the same
   toolchain gives the same bytes. Before the fingerprints were first
   recorded (November 2026), every grammar was rebuilt from its pinned
   source and compared byte for byte.
5. **Source archive.** The maintainer keeps a copy of every grammar
   source at its pinned commit, with SHA-256 fingerprints. Builds can use
   it instead of the network (set `TREELIGHTS_SOURCE_ARCHIVE` to its
   folder), so a deleted or rewritten upstream repository cannot break or
   change a build. To make your own archive:

   ```sh
   node tools/archive-sources.mjs <folder>
   ```

6. **Grammars written for Treelights.** The YARA grammar
   (`grammars/tree-sitter-yara/`) was written for Treelights rather than
   taken from a small, unreviewed project. It has no hand-written C, and
   the build regenerates its parser from `grammar.js` and stops unless
   the result matches the committed `src/` exactly, so the code that runs
   always matches the definition anyone can read.
7. **Changes to upstream grammars.** Two grammars are changed at build
   time, on a temporary copy of the pinned source; the source itself and
   its pin stay untouched, and the result is fingerprinted like any other
   grammar:
   - The Vim grammar's lexer is split into eight functions
     (`grammars/split-lexer.mjs`) so Obsidian can compile it. The script
     moves code without changing it and stops if the generated code is
     not shaped as expected. The split grammar was checked against the
     original on 1,779 Vim files (2,027,265 parse-tree nodes, no
     difference), and a test keeps checking a sample.
   - The KQL grammar gains common operators it lacks, such as `take`,
     `limit`, `top` and `count` (`grammars/patches/kusto.json`). The
     patch is applied to the grammar's JSON form and the parser is
     regenerated from it, so none of the grammar's own JavaScript runs.
8. **Tests.** `npm test` checks the pins, the fingerprints and the
   allow-list, and proves that a changed or over-reaching grammar is
   caught.

## Releases

Each release is made by `tools/release.mjs`, which checks the build
tools' fingerprints, builds (checking every grammar), runs all tests and
writes `SHA256SUMS` for the release files. The fingerprints are
published with the release, so you can check a download:

```sh
shasum -a 256 -c SHA256SUMS
```

For version 1.0 the release files are built on the maintainer's Mac and
uploaded by hand. A GitHub Actions build that reproduces them is
planned once the Linux build tools have been reviewed and fingerprinted.

## Updating a dependency

Nothing updates automatically. To update a grammar, tool or package:

1. Wait about two weeks after its release. Most hijacked releases are
   found and removed within days.
2. Read what changed (the commit history and the diff).
3. Change the pin, rebuild and run the tests.
4. Record the new fingerprints on purpose:

   ```sh
   npm run build:grammars -- --update-pins
   ```

5. Review the diff of `grammars/checksums.json` and test in Obsidian
   before releasing.

A new grammar from a small or unknown maintainer gets a full read of its
grammar definition and any hand-written `scanner.c` before it is added.

## Known limits

- A fingerprint proves that a file has not changed since it was
  reviewed. It cannot prove the reviewed version was safe. The large,
  machine-generated `parser.c` files cannot be fully read by eye; the
  WebAssembly sandbox and the allow-list limit what such code could do.
- A faulty grammar can still slow down or crash the code view.
  Obsidian 1.15's JavaScript engine (V8 13.8) crashes when it optimises
  a very large WebAssembly function; the Vim grammar's lexer (about
  800 KB) did this until it was split (see "Changes to upstream
  grammars"), and a test now fails if any grammar has a function over
  460 KB. Treelights also stops redrawing if it detects runaway redraws.
- Fingerprints for the `tree-sitter` program and the WASI SDK are
  recorded per platform. A build on a new platform stops until its first
  fingerprints are reviewed and recorded.
- Treelights has not had an independent security audit.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private vulnerability
reporting on this repository (Security tab, "Report a vulnerability").
