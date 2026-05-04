import ts from "typescript";

export interface TypeRange {
  readonly start: number;
  readonly end: number;
}

export interface RegexRange {
  readonly start: number;
  readonly end: number;
}

/**
 * Collect position ranges for every `TypeNode` reachable from `sourceFile`.
 *
 * Scanner tokens whose `[start, end)` is fully contained in any of these
 * ranges are dropped when building the normalized token stream — this is
 * how we strip type annotations (`: number`, `: Foo<Bar>`, etc.) without
 * having to reinvent parsing.
 *
 * We also record the exact position of the `:` that introduces each type
 * node (e.g. the colon in `function f(): void` or `const x: number`). Those
 * colons are ambiguous from the scanner's perspective — we need the AST to
 * tell them apart from object-literal shorthand. A separate lookup set is
 * exposed so the caller can skip them too.
 */
interface CollectedTypeInfo {
  /** Sorted by `start`. Non-overlapping in typical TypeScript. */
  readonly ranges: TypeRange[];
  /** Exact byte positions of `:` tokens introducing a type node. */
  readonly typeIntroducerColonPositions: Set<number>;
}

export function collectTypeRanges(
  sourceFile: ts.SourceFile,
): CollectedTypeInfo {
  const ranges: TypeRange[] = [];
  const colons = new Set<number>();

  const visit = (node: ts.Node): void => {
    if (ts.isTypeNode(node)) {
      const start = node.getStart(sourceFile);
      const end = node.getEnd();
      ranges.push({ start, end });
      // Look for a preceding `:` that introduces this type node.
      recordIntroducerColon(node, sourceFile, colons);
      // Still descend so nested expression positions (e.g. default values
      // inside mapped types) would be found — in practice TypeNodes don't
      // contain real expressions, but descending is harmless.
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  ranges.sort((a, b) => a.start - b.start);
  return { ranges, typeIntroducerColonPositions: colons };
}

/**
 * Collect position ranges of every `RegularExpressionLiteral` in the
 * source file. The scanner, lacking parser context, often splits `/foo/`
 * into `SLASH` / `Identifier` / `SLASH`; we use these ranges to recognize
 * the start position of the regex and emit a single `REGEX` token instead.
 */
export function collectRegexRanges(sourceFile: ts.SourceFile): RegexRange[] {
  const ranges: RegexRange[] = [];
  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      ranges.push({ start: node.getStart(sourceFile), end: node.getEnd() });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  ranges.sort((a, b) => a.start - b.start);
  return ranges;
}

/**
 * For common "identifier `:` type" shapes (parameters, property
 * declarations, variable declarations, return-type annotations,
 * typed-as-expressions, etc.), the parser places the type node as a
 * `type` / `constraint` / `default` field on the parent. The colon that
 * introduces that type is the first `:` before `node.getStart()` in the
 * parent's text. Skipping it avoids emitting stray `COLON` tokens for
 * `const x: T = ...` while leaving object-literal `{ a: 1 }` colons
 * (whose parent is `PropertyAssignment`, not a `:type` position) alone.
 */
function recordIntroducerColon(
  typeNode: ts.Node,
  sourceFile: ts.SourceFile,
  colons: Set<number>,
): void {
  const parent = typeNode.parent as ts.Node | undefined;
  if (parent === undefined) {
    return;
  }
  // Scan backwards from the type node start for a `:`.
  const text = sourceFile.text;
  const typeStart = typeNode.getStart(sourceFile);
  // Bound the search at the parent's start so we don't walk off-node.
  const parentStart = parent.getStart(sourceFile);
  for (let i = typeStart - 1; i >= parentStart; i--) {
    const ch = text.charAt(i);
    if (ch === ":") {
      colons.add(i);
      return;
    }
    // Any non-whitespace before we hit a `:` means this isn't an
    // `identifier : Type` shape — don't mark anything.
    if (ch !== " " && ch !== "\t" && ch !== "\n" && ch !== "\r") {
      return;
    }
  }
}

/** Returns true iff `[start, end)` is fully contained in any collected type range. */
export function isWithinTypeRange(
  ranges: readonly TypeRange[],
  start: number,
  end: number,
): boolean {
  // Linear scan is fine — per-fragment ranges list is short.
  for (const r of ranges) {
    if (r.start <= start && end <= r.end) {
      return true;
    }
    if (r.start >= end) {
      return false;
    }
  }
  return false;
}
