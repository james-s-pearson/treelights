# Highlight queries

Except for `yara/`, these Tree-sitter queries are copied, unchanged, from
[nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter)
(main branch, commit f603a2f), licensed under the Apache License 2.0.
These are the same queries Neovim uses, so a colour scheme exported from
Neovim (`tools/export-nvim-theme.lua`) colours code the same way in
Treelights. Each grammar is pinned to the version these queries
expect (see `grammars/sources.json`).

The optional pack in `query-packs/lazyvim/` combines the Lua query
extensions from [LazyVim](https://github.com/LazyVim/LazyVim) and
[snacks.nvim](https://github.com/folke/snacks.nvim) by Folke Lemaitre,
also Apache License 2.0.

`yara/` is a copy of the queries in `../grammars/tree-sitter-yara/`
(Treelights' own YARA grammar, MIT licence); a test keeps the two
identical.
