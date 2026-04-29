import ts from "typescript";

/**
 * Normalize a TypeScript `SyntaxKind` token into a short, stable string
 * used as a unit of the token n-gram feature.
 *
 * Identifiers and literals are collapsed into single-letter placeholders
 * (`i`, `s`, `n`, ...) so that renaming variables or changing literal
 * values does not alter the resulting n-gram. Punctuation and operators
 * map to the corresponding source character(s) for the same compactness.
 *
 * Why short? Each emitted n-gram key is a concatenation of `size` token
 * forms (sizes default to 3..6); shorter forms cut both per-fragment
 * memory pressure and the per-iteration concat cost in `buildNgramKeys`.
 * The separator inside an n-gram key is `"\x00"` (NUL) — chosen because
 * it never appears as a token form, and so the choice of short forms
 * cannot become ambiguous against a separator collision.
 *
 * Keywords map to a 2-letter capitalised abbreviation; the table is
 * exhaustively unique. Anything not in the explicit table falls back to
 * `ts.SyntaxKind[kind]` so the output stays deterministic as the
 * TypeScript API surface evolves.
 */

const EXPLICIT_MAP: Partial<Record<ts.SyntaxKind, string>> = {
  // Identifiers (treated as abstract).
  [ts.SyntaxKind.Identifier]: "i",
  [ts.SyntaxKind.PrivateIdentifier]: "i",

  // Literals.
  [ts.SyntaxKind.StringLiteral]: "s",
  [ts.SyntaxKind.NoSubstitutionTemplateLiteral]: "s",
  [ts.SyntaxKind.TemplateHead]: "s",
  [ts.SyntaxKind.TemplateMiddle]: "s",
  [ts.SyntaxKind.TemplateTail]: "s",
  [ts.SyntaxKind.NumericLiteral]: "n",
  [ts.SyntaxKind.BigIntLiteral]: "n",
  [ts.SyntaxKind.TrueKeyword]: "b",
  [ts.SyntaxKind.FalseKeyword]: "b",
  [ts.SyntaxKind.NullKeyword]: "u",
  [ts.SyntaxKind.RegularExpressionLiteral]: "r",

  // Major keywords.
  [ts.SyntaxKind.IfKeyword]: "If",
  [ts.SyntaxKind.ElseKeyword]: "El",
  [ts.SyntaxKind.ReturnKeyword]: "Re",
  [ts.SyntaxKind.ForKeyword]: "Fo",
  [ts.SyntaxKind.WhileKeyword]: "Wh",
  [ts.SyntaxKind.DoKeyword]: "Do",
  [ts.SyntaxKind.SwitchKeyword]: "Sw",
  [ts.SyntaxKind.CaseKeyword]: "Ca",
  [ts.SyntaxKind.DefaultKeyword]: "De",
  [ts.SyntaxKind.BreakKeyword]: "Br",
  [ts.SyntaxKind.ContinueKeyword]: "Cn",
  [ts.SyntaxKind.TryKeyword]: "Tr",
  [ts.SyntaxKind.CatchKeyword]: "Cc",
  [ts.SyntaxKind.FinallyKeyword]: "Fi",
  [ts.SyntaxKind.ThrowKeyword]: "Th",
  [ts.SyntaxKind.NewKeyword]: "Nw",
  [ts.SyntaxKind.DeleteKeyword]: "Dl",
  [ts.SyntaxKind.TypeOfKeyword]: "To",
  [ts.SyntaxKind.VoidKeyword]: "Vo",
  [ts.SyntaxKind.InKeyword]: "In",
  [ts.SyntaxKind.OfKeyword]: "Of",
  [ts.SyntaxKind.InstanceOfKeyword]: "Io",
  [ts.SyntaxKind.FunctionKeyword]: "Fn",
  [ts.SyntaxKind.ClassKeyword]: "Cl",
  [ts.SyntaxKind.ExtendsKeyword]: "Ex",
  [ts.SyntaxKind.ImplementsKeyword]: "Ix",
  [ts.SyntaxKind.ThisKeyword]: "Ts",
  [ts.SyntaxKind.SuperKeyword]: "Su",
  [ts.SyntaxKind.ConstKeyword]: "Co",
  [ts.SyntaxKind.LetKeyword]: "Le",
  [ts.SyntaxKind.VarKeyword]: "Va",
  [ts.SyntaxKind.AsyncKeyword]: "Ay",
  [ts.SyntaxKind.AwaitKeyword]: "Aw",
  [ts.SyntaxKind.YieldKeyword]: "Yi",
  [ts.SyntaxKind.ImportKeyword]: "Im",
  [ts.SyntaxKind.ExportKeyword]: "Ep",
  [ts.SyntaxKind.FromKeyword]: "Fm",
  [ts.SyntaxKind.AsKeyword]: "As",

  // Punctuation — literal source characters.
  [ts.SyntaxKind.OpenBraceToken]: "{",
  [ts.SyntaxKind.CloseBraceToken]: "}",
  [ts.SyntaxKind.OpenParenToken]: "(",
  [ts.SyntaxKind.CloseParenToken]: ")",
  [ts.SyntaxKind.OpenBracketToken]: "[",
  [ts.SyntaxKind.CloseBracketToken]: "]",
  [ts.SyntaxKind.SemicolonToken]: ";",
  [ts.SyntaxKind.CommaToken]: ",",
  [ts.SyntaxKind.DotToken]: ".",
  [ts.SyntaxKind.DotDotDotToken]: "...",
  [ts.SyntaxKind.QuestionToken]: "?",
  [ts.SyntaxKind.QuestionDotToken]: "?.",
  [ts.SyntaxKind.QuestionQuestionToken]: "??",
  [ts.SyntaxKind.ColonToken]: ":",
  [ts.SyntaxKind.AtToken]: "@",

  // Operators — literal source characters.
  [ts.SyntaxKind.EqualsToken]: "=",
  [ts.SyntaxKind.EqualsEqualsToken]: "==",
  [ts.SyntaxKind.EqualsEqualsEqualsToken]: "===",
  [ts.SyntaxKind.ExclamationToken]: "!",
  [ts.SyntaxKind.ExclamationEqualsToken]: "!=",
  [ts.SyntaxKind.ExclamationEqualsEqualsToken]: "!==",
  [ts.SyntaxKind.LessThanToken]: "<",
  [ts.SyntaxKind.LessThanEqualsToken]: "<=",
  [ts.SyntaxKind.GreaterThanToken]: ">",
  [ts.SyntaxKind.GreaterThanEqualsToken]: ">=",
  [ts.SyntaxKind.PlusToken]: "+",
  [ts.SyntaxKind.MinusToken]: "-",
  [ts.SyntaxKind.AsteriskToken]: "*",
  [ts.SyntaxKind.AsteriskAsteriskToken]: "**",
  [ts.SyntaxKind.SlashToken]: "/",
  [ts.SyntaxKind.PercentToken]: "%",
  [ts.SyntaxKind.AmpersandToken]: "&",
  [ts.SyntaxKind.AmpersandAmpersandToken]: "&&",
  [ts.SyntaxKind.BarToken]: "|",
  [ts.SyntaxKind.BarBarToken]: "||",
  [ts.SyntaxKind.CaretToken]: "^",
  [ts.SyntaxKind.TildeToken]: "~",
  [ts.SyntaxKind.LessThanLessThanToken]: "<<",
  [ts.SyntaxKind.GreaterThanGreaterThanToken]: ">>",
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken]: ">>>",
  [ts.SyntaxKind.PlusPlusToken]: "++",
  [ts.SyntaxKind.MinusMinusToken]: "--",
  [ts.SyntaxKind.EqualsGreaterThanToken]: "=>",
  [ts.SyntaxKind.PlusEqualsToken]: "+=",
  [ts.SyntaxKind.MinusEqualsToken]: "-=",
  [ts.SyntaxKind.AsteriskEqualsToken]: "*=",
  [ts.SyntaxKind.SlashEqualsToken]: "/=",
  [ts.SyntaxKind.PercentEqualsToken]: "%=",
  [ts.SyntaxKind.AmpersandEqualsToken]: "&=",
  [ts.SyntaxKind.BarEqualsToken]: "|=",
  [ts.SyntaxKind.CaretEqualsToken]: "^=",
  [ts.SyntaxKind.AmpersandAmpersandEqualsToken]: "&&=",
  [ts.SyntaxKind.BarBarEqualsToken]: "||=",
  [ts.SyntaxKind.QuestionQuestionEqualsToken]: "??=",
  [ts.SyntaxKind.LessThanLessThanEqualsToken]: "<<=",
  [ts.SyntaxKind.GreaterThanGreaterThanEqualsToken]: ">>=",
  [ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken]: ">>>=",
  [ts.SyntaxKind.AsteriskAsteriskEqualsToken]: "**=",
};

export function normalizeTokenKind(kind: ts.SyntaxKind): string {
  const mapped = EXPLICIT_MAP[kind];
  if (mapped !== undefined) {
    return mapped;
  }
  const name = ts.SyntaxKind[kind];
  return name;
}
