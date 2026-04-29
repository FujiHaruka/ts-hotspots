import type ts from "typescript";
import {
  collectRegexRanges,
  collectTypeRanges,
  type RegexRange,
  type TypeRange,
} from "./internal/typeRanges.ts";

/**
 * Per-file precomputation shared across every fragment of a single source.
 *
 * `collectTypeRanges` and `collectRegexRanges` walk the entire `SourceFile`
 * and depend only on it, so calling them once per fragment (as the
 * single-fragment builders do for back-compat) is wasted work when an entire
 * file's worth of fragments is being processed in a row. The hot pipelines
 * (`runDetector`, `runWholeRepoDetector`) build a `FileFeatureContext` once
 * per file and pass it to `extractFeatures` for every fragment in that file.
 */
export interface FileFeatureContext {
  readonly sourceFile: ts.SourceFile;
  readonly typeRanges: readonly TypeRange[];
  readonly typeIntroducerColonPositions: ReadonlySet<number>;
  readonly regexRanges: readonly RegexRange[];
}

export function buildFileFeatureContext(
  sourceFile: ts.SourceFile,
): FileFeatureContext {
  const { ranges, typeIntroducerColonPositions } =
    collectTypeRanges(sourceFile);
  return {
    sourceFile,
    typeRanges: ranges,
    typeIntroducerColonPositions,
    regexRanges: collectRegexRanges(sourceFile),
  };
}
