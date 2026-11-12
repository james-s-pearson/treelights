; Treelights additions for Rego, applied after nvim-treesitter's rules
; (queries/rego). Not part of Neovim.

; fields reached with a dot: input.resources, bucket.name
(ref_arg_dot
  (var) @variable.member)

; package and import paths
(module
  (ref) @module)

(module
  (ref
    (ref_arg
      (ref_arg_dot
        (var) @module))))

; Rego's built-in documents
((var) @variable.builtin
  (#any-of? @variable.builtin "input" "data"))

; a rule's output (the "msg" in "deny contains msg if"): a variable, not a
; module
(rule
  (rule_head
    (term
      (ref
        (var) @variable))))

; strings, numbers and booleans keep their own colours inside function
; arguments (Neovim's rules colour whole arguments as parameters)
(fn_args
  (expr
    (term
      (scalar
        [
          (string)
          (raw_string)
        ] @string))))

(fn_args
  (expr
    (term
      (scalar
        (number) @number))))

; ":=" in "default allow := false"
(rule_body
  (assignment) @operator)

"," @punctuation.delimiter
