/**
 * @file Tree-sitter grammar for the YARA rule language
 * @author James Pearson
 * @license MIT
 *
 * Written from the YARA documentation ("Writing YARA rules") and the
 * syntax of YARA 4.x. Designed and directed by James Pearson; code
 * generated with AI assistance (Claude). No external scanner: everything
 * the parser does is generated from this file.
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// Operator precedence, lowest to highest, as in YARA's own parser
const PREC = {
  or: 1,
  and: 2,
  not: 3, // not, defined
  equality: 4, // == != contains ... matches
  position: 5, // $a at x, $a in (range), #a in (range)
  relational: 6, // < <= > >=
  bit_or: 7,
  bit_xor: 8,
  bit_and: 9,
  shift: 10,
  additive: 11,
  multiplicative: 12,
  unary: 13, // - ~
  postfix: 14, // member access, index, call
};

const commaSep1 = (rule) => seq(rule, repeat(seq(',', rule)));
const commaSep = (rule) => optional(commaSep1(rule));

module.exports = grammar({
  name: 'yara',

  extras: ($) => [/\s/, $.comment],

  word: ($) => $.identifier,

  conflicts: ($) => [
    // "(x)" after "in" may be a one-item enumeration or a parenthesised
    // iterable expression
    [$.enumeration, $.parenthesized_expression],
    // "50 %" may be a percentage ("50% of them") or a remainder ("50 % 3")
    [$.quantifier, $._expression],
  ],

  rules: {
    source_file: ($) => repeat(choice(
      $.import_statement,
      $.include_statement,
      $.rule_definition,
    )),

    comment: (_) => token(choice(
      seq('//', /[^\r\n]*/),
      seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'),
    )),

    import_statement: ($) => seq('import', field('module', $.string)),

    include_statement: ($) => seq('include', field('path', $.string)),

    // ---------------------------------------------------------------
    // Rules

    rule_definition: ($) => seq(
      repeat($.rule_modifier),
      'rule',
      field('name', $.identifier),
      optional(seq(':', field('tags', $.tag_list))),
      '{',
      optional($.meta_section),
      optional($.strings_section),
      $.condition_section,
      '}',
    ),

    rule_modifier: (_) => choice('private', 'global'),

    tag_list: ($) => repeat1(alias($.identifier, $.tag)),

    meta_section: ($) => seq('meta', ':', repeat($.meta_definition)),

    meta_definition: ($) => seq(
      field('key', $.identifier),
      '=',
      field('value', choice(
        $.string,
        $.integer,
        $.negative_integer,
        $.boolean,
      )),
    ),

    negative_integer: ($) => seq('-', $.integer),

    // ---------------------------------------------------------------
    // Strings section

    strings_section: ($) => seq('strings', ':', repeat($.string_definition)),

    string_definition: ($) => seq(
      field('name', $.string_identifier),
      '=',
      field('value', choice($.string, $.hex_string, $.regex)),
      repeat(field('modifier', $._string_modifier)),
    ),

    _string_modifier: ($) => choice(
      $.modifier,
      $.xor_modifier,
      $.base64_modifier,
    ),

    modifier: (_) => choice('nocase', 'wide', 'ascii', 'fullword', 'private'),

    // xor, xor(0x01), xor(0x01-0xff)
    xor_modifier: ($) => seq(
      'xor',
      optional(seq(
        '(',
        field('from', $.integer),
        optional(seq('-', field('to', $.integer))),
        ')',
      )),
    ),

    // base64, base64wide, with an optional custom alphabet
    base64_modifier: ($) => seq(
      choice('base64', 'base64wide'),
      optional(seq('(', field('alphabet', $.string), ')')),
    ),

    // ---------------------------------------------------------------
    // Hex strings: { 4D 5A ?? [2-4] ( 01 | 02 ) ~00 }

    hex_string: ($) => seq('{', repeat($._hex_token), '}'),

    _hex_token: ($) => choice($.hex_byte, $.hex_jump, $.hex_alternative),

    // two nibbles, each a hex digit or "?", optionally negated with "~"
    hex_byte: (_) => /~?[0-9a-fA-F?][0-9a-fA-F?]/,

    // [n], [n-m], [n-], [-]
    hex_jump: (_) => /\[[ \t]*[0-9]*[ \t]*(-[ \t]*[0-9]*[ \t]*)?\]/,

    hex_alternative: ($) => seq(
      '(',
      repeat1($._hex_token),
      repeat(seq('|', repeat1($._hex_token))),
      ')',
    ),

    // ---------------------------------------------------------------
    // Conditions

    condition_section: ($) => seq('condition', ':', field('expression', $._expression)),

    _expression: ($) => choice(
      $.binary_expression,
      $.unary_expression,
      $.at_expression,
      $.in_expression,
      $.of_expression,
      $.for_expression,
      $.with_expression,
      $._primary_expression,
    ),

    _primary_expression: ($) => choice(
      $.parenthesized_expression,
      $.member_expression,
      $.index_expression,
      $.call_expression,
      $.string_identifier,
      $.string_count,
      $.string_offset,
      $.string_length,
      $.identifier,
      $.integer,
      $.float,
      $.string,
      $.regex,
      $.boolean,
      $.filesize,
      $.entrypoint,
    ),

    parenthesized_expression: ($) => seq('(', $._expression, ')'),

    binary_expression: ($) => {
      const table = [
        [PREC.or, 'or'],
        [PREC.and, 'and'],
        [PREC.equality, choice('==', '!=', 'contains', 'icontains', 'startswith',
          'istartswith', 'endswith', 'iendswith', 'iequals', 'matches')],
        [PREC.relational, choice('<', '<=', '>', '>=')],
        [PREC.bit_or, '|'],
        [PREC.bit_xor, '^'],
        [PREC.bit_and, '&'],
        [PREC.shift, choice('<<', '>>')],
        [PREC.additive, choice('+', '-')],
        [PREC.multiplicative, choice('*', '\\', '%')],
      ];
      return choice(...table.map(([p, op]) => prec.left(p, seq(
        field('left', $._expression),
        field('operator', op),
        field('right', $._expression),
      ))));
    },

    unary_expression: ($) => choice(
      prec(PREC.not, seq(field('operator', choice('not', 'defined')), field('argument', $._expression))),
      prec(PREC.unary, seq(field('operator', choice('-', '~')), field('argument', $._expression))),
    ),

    // $a at 100
    at_expression: ($) => prec.left(PREC.position, seq(
      field('string', $.string_identifier),
      'at',
      field('offset', $._expression),
    )),

    // $a in (0..100), #a in (0..100)
    in_expression: ($) => prec.left(PREC.position, seq(
      field('string', choice($.string_identifier, $.string_count)),
      'in',
      field('range', $.range),
    )),

    range: ($) => seq('(', field('from', $._expression), '..', field('to', $._expression), ')'),

    // any of them, 2 of ($a*), 50% of (Rule*), all of ($a, $b) in (0..100)
    of_expression: ($) => prec.right(seq(
      field('quantifier', $.quantifier),
      'of',
      field('set', choice($.them, $.string_set, $.rule_set)),
      optional(choice(
        seq('at', field('offset', $._expression)),
        seq('in', field('range', $.range)),
      )),
    )),

    quantifier: ($) => choice(
      'all',
      'any',
      'none',
      seq($._primary_expression, optional('%')),
    ),

    them: (_) => 'them',

    string_set: ($) => seq('(', commaSep1(choice($.string_identifier, $.string_wildcard)), ')'),

    rule_set: ($) => seq('(', commaSep1(choice($.identifier, $.rule_wildcard)), ')'),

    // for any of ($a*) : ( $ at 0 )
    // for all i in (1..#a) : ( @a[i] < 100 )
    // for any section in pe.sections : ( section.name == ".text" )
    for_expression: ($) => seq(
      'for',
      field('quantifier', $.quantifier),
      choice(
        seq('of', field('set', choice($.them, $.string_set))),
        seq(
          field('variables', commaSep1($.identifier)),
          'in',
          field('iterable', choice($.range, $.enumeration, $._primary_expression)),
        ),
      ),
      ':',
      '(',
      field('body', $._expression),
      ')',
    ),

    enumeration: ($) => seq('(', commaSep1($._expression), ')'),

    // with a = x, b = y : ( a == b )
    with_expression: ($) => seq(
      'with',
      commaSep1($.with_declaration),
      ':',
      '(',
      field('body', $._expression),
      ')',
    ),

    with_declaration: ($) => seq(field('name', $.identifier), '=', field('value', $._expression)),

    member_expression: ($) => prec(PREC.postfix, seq(
      field('object', $._primary_expression),
      '.',
      field('property', $.identifier),
    )),

    index_expression: ($) => prec(PREC.postfix, seq(
      field('object', $._primary_expression),
      '[',
      field('index', $._expression),
      ']',
    )),

    call_expression: ($) => prec(PREC.postfix, seq(
      field('function', $._primary_expression),
      '(',
      field('arguments', optional($.arguments)),
      ')',
    )),

    arguments: ($) => commaSep1($._expression),

    // ---------------------------------------------------------------
    // Tokens

    identifier: (_) => /[a-zA-Z_][a-zA-Z0-9_]*/,

    // $name, or $ alone (anonymous strings, the current string in loops)
    string_identifier: (_) => /\$[a-zA-Z0-9_]*/,
    string_wildcard: (_) => /\$[a-zA-Z0-9_]*\*/,
    rule_wildcard: (_) => /[a-zA-Z_][a-zA-Z0-9_]*\*/,

    // #a (count), @a (offset), !a (length); bare #, @, ! in loops
    string_count: (_) => /#[a-zA-Z0-9_]*/,
    string_offset: (_) => /@[a-zA-Z0-9_]*/,
    string_length: (_) => /![a-zA-Z0-9_]*/,

    // decimal (with an optional KB or MB size suffix), 0x hex, 0o octal
    integer: (_) => token(choice(
      /0x[0-9a-fA-F]+/,
      /0o[0-7]+/,
      /[0-9]+(KB|MB)?/,
    )),

    float: (_) => /[0-9]+\.[0-9]+/,

    boolean: (_) => choice('true', 'false'),

    filesize: (_) => 'filesize',
    entrypoint: (_) => 'entrypoint',

    string: ($) => seq(
      '"',
      repeat(choice(
        token.immediate(prec(1, /[^"\\\r\n]+/)),
        $.escape_sequence,
      )),
      token.immediate('"'),
    ),

    escape_sequence: (_) => token.immediate(seq('\\', choice(/x[0-9a-fA-F]{2}/, /[^x\r\n]/))),

    // /pattern/is: "/" always starts a regular expression in YARA
    // (division is written "\"); character classes may contain "/"
    regex: (_) => token(seq(
      '/',
      repeat1(choice(
        /[^/\\\[\r\n]/,
        /\\[^\r\n]/,
        seq('[', repeat(choice(/[^\]\\\r\n]/, /\\[^\r\n]/)), ']'),
      )),
      '/',
      /[is]*/,
    )),
  },
});
