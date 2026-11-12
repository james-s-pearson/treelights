; Treelights additions for KQL, applied after nvim-treesitter's rules
; (queries/kusto). Not part of Neovim.

; the table a query starts from
(source
  (identifier) @type)

; time spans such as 7d or 30m, including the unit
(timespan) @number

; comparison and arithmetic operators
[
  "="
  "=="
  "!="
  "<"
  ">"
  "<="
  ">="
  "!"
  "+"
  "-"
  "*"
  "/"
  ".."
] @operator

; the two sides of a join
((identifier) @variable.builtin
  (#any-of? @variable.builtin "$left" "$right"))

; columns reached through a table or a join side: T.Column
(property_identifier
  (identifier) @variable.member .)
