; Highlights for tree-sitter-yara, using nvim-treesitter's capture names.
; Later patterns take precedence over earlier ones.

(identifier) @variable

(comment) @comment @spell

; Directives and rules
[
  "import"
  "include"
] @keyword.import

[
  "rule"
  "meta"
  "strings"
  "condition"
  "with"
] @keyword

(rule_modifier) @keyword.modifier

(rule_definition
  name: (identifier) @function)

(tag) @label

(meta_definition
  key: (identifier) @property)

; Strings section. String names ($a, #a, @a, !a, $a*) are what a
; condition works on, so they get the parameter colour rather than the
; plain variable colour.
[
  (string_identifier)
  (string_wildcard)
  (string_count)
  (string_offset)
  (string_length)
] @variable.parameter

[
  (modifier)
  "xor"
  "base64"
  "base64wide"
] @attribute

(string) @string

(escape_sequence) @string.escape

(regex) @string.regexp

(hex_byte) @number

; wildcards (??, A?), negations (~00) and jumps ([2-4]) are the special
; parts of a hex pattern, coloured like escape sequences in a string
((hex_byte) @string.escape
  (#match? @string.escape "[?~]"))

(hex_jump) @string.escape

(hex_alternative
  "|" @operator)

; Conditions
[
  "and"
  "or"
  "not"
  "defined"
  "at"
  "in"
  "of"
  "all"
  "any"
  "none"
  "contains"
  "icontains"
  "startswith"
  "istartswith"
  "endswith"
  "iendswith"
  "iequals"
  "matches"
] @keyword.operator

"for" @keyword.repeat

(them) @variable.builtin

[
  (filesize)
  (entrypoint)
] @constant.builtin

(boolean) @boolean

(integer) @number

(float) @number.float

(rule_set
  [
    (identifier)
    (rule_wildcard)
  ] @function)

(member_expression
  object: (identifier) @module)

(member_expression
  property: (identifier) @variable.member)

(call_expression
  function: (identifier) @function.call)

(call_expression
  function: (member_expression
    property: (identifier) @function.method.call))

((call_expression
  function: (identifier) @function.builtin)
  (#match? @function.builtin "^u?int(8|16|32)(be)?$"))

(quantifier
  "%" @operator)

[
  "=="
  "!="
  "<"
  "<="
  ">"
  ">="
  "<<"
  ">>"
  "&"
  "|"
  "^"
  "~"
  "+"
  "-"
  "*"
  "\\"
  "%"
  "="
  ".."
] @operator

; the minus of a negative number in meta values
(negative_integer
  "-" @number)

[
  "{"
  "}"
  "("
  ")"
  "["
  "]"
] @punctuation.bracket

[
  ","
  ":"
  "."
] @punctuation.delimiter
