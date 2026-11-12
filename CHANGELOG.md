# Changelog

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
