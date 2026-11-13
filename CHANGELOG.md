# Changelog

## Unreleased

Fixes and hardening after Obsidian's plugin review; colours are
unchanged except for the fix below.

- Fixed: in Live Preview, code inside code (for example Vim commands in
  a Lua string) could stay uncoloured when a note was opened before the
  inner language had loaded.
- Fixed: tags in comments, such as TODO, NOTE, WARNING and FIXME, are
  now coloured. Their highlight rules were missing from earlier
  releases; a test now checks that every grammar has its rules.
- Settings now use Obsidian's declarative settings, so each one appears
  in Obsidian's settings search (for example "secret" or a language
  name).
- `styles.css` no longer uses `!important`; checked against six themes
  in dark and light mode with no visible change.
- The bundled runtime's unused code for downloading files and for
  running JavaScript embedded in a grammar (`eval`) is removed, and the
  build refuses any grammar that carries JavaScript. `main.js` now
  contains no network, file-system or `eval` code apart from the
  Cmd-click link to CVE, CWE and ATT&CK pages.
- Generated source files are now included in the repository, and
  CONTRIBUTING.md explains how to build and test. Releases now also run
  the TypeScript type check.

## 1.0.1 (12 November 2026)

Changes for Obsidian's plugin review; highlighting looks the same.

- Highlight styles now live in `styles.css`, which Obsidian loads; the
  plugin no longer creates a `<style>` element and sets only CSS
  variables. Pop-out windows get the styles too.
- The bundled Tree-sitter runtime no longer contains its unused
  Node.js file-reading code, so `main.js` has no file-system access.
- The theme file picker is hidden with a CSS class instead of an
  inline style; the "Remove" button uses Obsidian's current API.

## 1.0.0 (12 November 2026)

First public release.

- Tree-sitter highlighting for 31 languages, including code inside code
  (for example Vim script inside Lua), in Live Preview and Reading view.
- Themes: Follow Obsidian theme (default), Neon Alley, Tokyo Night and
  nine Helix themes; Helix theme import; Neovim colour-scheme export
  tool.
- Colour previews for hex, rgb() and hsl() colours.
- Security features: indicators (addresses, URLs, paths, registry keys,
  hashes, wallets, CVE, CWE and ATT&CK IDs, with links), secret
  warnings and hidden-character checks, in code blocks and inline code.
- Our own YARA grammar; the Vim lexer split so Obsidian can compile it;
  extra KQL operators.
- Supply-chain safeguards for the build (see SECURITY.md).
