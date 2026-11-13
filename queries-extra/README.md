# Treelights query additions

Rules Treelights adds on top of the nvim-treesitter queries in
`../queries/`, for languages where those are marked unstable or leave
code uncolored. They are applied after Neovim's rules, so they win where
both apply; Neovim's files stay unchanged. These additions are part of
Treelights (MIT license) and are not in Neovim.

- `kusto/`: KQL tables, operators, time spans, join sides and columns
- `rego/`: package and import paths, `input` and `data`, fields, rule
  outputs, and strings and numbers inside function arguments
