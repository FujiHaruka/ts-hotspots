import ts from "typescript";
import type { Config } from "../config/config.ts";
import type { FeatureKey } from "../domain/feature.ts";
import type { Fragment } from "../domain/fragment.ts";
import {
  buildFileFeatureContext,
  type FileFeatureContext,
} from "./fileContext.ts";
import {
  type LocatedFragment,
  locateFragmentNode,
} from "./internal/locateFragmentNode.ts";
import { normalizeTokenKind } from "./internal/normalizeToken.ts";
import { isWithinTypeRange, type RegexRange } from "./internal/typeRanges.ts";

/**
 * Build normalized-token n-gram feature keys for a fragment.
 *
 * The fragment's byte range inside `sourceFile` is scanned with
 * `ts.Scanner`, trivia (whitespace / comments) is skipped, and every token
 * is mapped via `normalizeTokenKind`. Tokens whose position falls inside
 * a collected `TypeNode` range are dropped — this removes type annotations
 * like `: Foo<Bar>` and return-type clauses.
 *
 * N-gram sizes come from `config.features.tokenNgramSizes`; each size
 * produces `(tokens.length - size + 1)` keys of the form
 * `token:<form0>\x00<form1>\x00…`. The NUL separator is internal —
 * `report/internal/stripPrefix` substitutes a space when surfacing
 * intersections to the user. Duplicates are kept (bag semantics) so a
 * tight loop can still count hits per-key if needed later.
 */
export function buildTokenNgrams(
  fragment: Fragment,
  sourceFile: ts.SourceFile,
  config: Config,
): FeatureKey[] {
  const located = locateFragmentNode(fragment, sourceFile);
  if (located.nodes.length === 0) {
    return [];
  }
  const ctx = buildFileFeatureContext(sourceFile);
  return buildTokenNgramsFromLocated(located, fragment.filePath, ctx, config);
}

/**
 * Fast-path variant for callers that have already located the fragment node
 * and built a per-file context. Skips the redundant full-AST walks that the
 * single-fragment public entry point pays.
 */
export function buildTokenNgramsFromLocated(
  located: LocatedFragment,
  filePath: string,
  ctx: FileFeatureContext,
  config: Config,
): FeatureKey[] {
  if (located.nodes.length === 0) {
    return [];
  }
  const tokens = scanNormalizedTokens(
    ctx.sourceFile,
    located.startPos,
    located.endPos,
    filePath,
    ctx.typeRanges,
    ctx.typeIntroducerColonPositions,
    ctx.regexRanges,
  );
  return buildNgramKeys(tokens, config.features.tokenNgramSizes);
}

/** Exposed for tests. */
export function scanNormalizedTokensForTesting(
  fragment: Fragment,
  sourceFile: ts.SourceFile,
): string[] {
  const located = locateFragmentNode(fragment, sourceFile);
  if (located.nodes.length === 0) {
    return [];
  }
  const ctx = buildFileFeatureContext(sourceFile);
  return scanNormalizedTokens(
    sourceFile,
    located.startPos,
    located.endPos,
    fragment.filePath,
    ctx.typeRanges,
    ctx.typeIntroducerColonPositions,
    ctx.regexRanges,
  );
}

function scanNormalizedTokens(
  sourceFile: ts.SourceFile,
  startPos: number,
  endPos: number,
  filePath: string,
  typeRanges: readonly { start: number; end: number }[],
  typeColons: ReadonlySet<number>,
  regexRanges: readonly RegexRange[],
): string[] {
  const languageVariant = filePath.toLowerCase().endsWith(".tsx")
    ? ts.LanguageVariant.JSX
    : ts.LanguageVariant.Standard;
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /* skipTrivia */ true,
    languageVariant,
    sourceFile.text,
    /* onError */ undefined,
    startPos,
    endPos - startPos,
  );
  // Older/newer API shapes: some createScanner signatures accept (target,
  // skipTrivia, variant, text, onError, start, length) while others lack
  // the trailing args. Explicitly set text/range to be safe across versions.
  scanner.setText(sourceFile.text, startPos, endPos - startPos);

  // Pre-sort regex ranges for linear skip.
  const regexStartSet = new Map<number, number>();
  for (const r of regexRanges) {
    regexStartSet.set(r.start, r.end);
  }

  const tokens: string[] = [];
  for (;;) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) {
      break;
    }
    const tokenStart = scanner.getTokenStart();
    const tokenEnd = scanner.getTokenEnd();
    if (tokenStart >= endPos) {
      break;
    }
    // Drop tokens whose position is entirely inside a type node.
    if (isWithinTypeRange(typeRanges, tokenStart, tokenEnd)) {
      continue;
    }
    // Drop `:` tokens that introduce a type annotation.
    if (kind === ts.SyntaxKind.ColonToken && typeColons.has(tokenStart)) {
      continue;
    }
    // If a regex literal starts at this position, re-scan as a regex and
    // emit a single regex form (`r`, matching `RegularExpressionLiteral`
    // in `normalizeTokenKind`). This works around the scanner's
    // context-free default that splits `/foo/` as `/` / id / `/`.
    const regexEnd = regexStartSet.get(tokenStart);
    if (regexEnd !== undefined && kind === ts.SyntaxKind.SlashToken) {
      scanner.reScanSlashToken();
      tokens.push("r");
      // Advance past the regex in case reScanSlashToken didn't update
      // scanner position to the end of the literal.
      const afterStart = scanner.getTokenEnd();
      if (afterStart < regexEnd) {
        scanner.resetTokenState(regexEnd);
      }
      continue;
    }
    tokens.push(normalizeTokenKind(kind));
  }
  return tokens;
}

/**
 * Internal separator used inside `token:<form0>\x00<form1>\x00…` n-gram
 * keys. NUL is chosen because no normalised token form can contain it,
 * so the choice of short forms (e.g. `(`, `;`) cannot collide with it.
 * Display-side rendering (`stripPrefix`) substitutes a space.
 */
export const TOKEN_NGRAM_SEPARATOR = "\x00";

function buildNgramKeys(tokens: string[], sizes: number[]): FeatureKey[] {
  const out: FeatureKey[] = [];
  for (const size of sizes) {
    if (size <= 0 || tokens.length < size) {
      continue;
    }
    const last = tokens.length - size;
    for (let i = 0; i <= last; i++) {
      let key = `token:${tokens[i] ?? ""}`;
      for (let j = 1; j < size; j++) {
        key += TOKEN_NGRAM_SEPARATOR + (tokens[i + j] ?? "");
      }
      out.push(key);
    }
  }
  return out;
}
