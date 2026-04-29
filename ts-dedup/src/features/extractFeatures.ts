import type ts from "typescript";
import type { Config } from "../config/config.ts";
import type { FragmentFeatures } from "../domain/feature.ts";
import type { Fragment } from "../domain/fragment.ts";
import { buildCallPropertyFingerprintsFromLocated } from "./callPropertyFingerprint.ts";
import {
  buildFileFeatureContext,
  type FileFeatureContext,
} from "./fileContext.ts";
import { locateFragmentNode } from "./internal/locateFragmentNode.ts";
import { buildTokenNgramsFromLocated } from "./normalizedTokenNgram.ts";
import { buildStatementKindNgramsFromLocated } from "./statementKindNgram.ts";

/**
 * Combine the 3 v1 feature streams into a single `FragmentFeatures` record.
 *
 * `locateFragmentNode` is called *once* and shared across all three builders
 * (each used to redo it on the public single-fragment APIs). Per-file work
 * (`collectTypeRanges` / `collectRegexRanges`) is shared via `ctx`. When the
 * caller doesn't pass `ctx`, one is built inline — fine for ad-hoc / test
 * use, wasteful when iterating fragments of the same file.
 *
 * Purely compositional: each sub-builder is independent, so the result is
 * deterministic whenever `fragment` + `sourceFile` + `config` are fixed.
 */
export function extractFeatures(
  fragment: Fragment,
  sourceFile: ts.SourceFile,
  config: Config,
  ctx?: FileFeatureContext,
): FragmentFeatures {
  const fileCtx = ctx ?? buildFileFeatureContext(sourceFile);
  const located = locateFragmentNode(fragment, sourceFile);
  const { enabled } = config.features;
  return {
    fragmentId: fragment.id,
    tokens: enabled.token
      ? buildTokenNgramsFromLocated(located, fragment.filePath, fileCtx, config)
      : [],
    statements: enabled.statement
      ? buildStatementKindNgramsFromLocated(located, config)
      : [],
    calls: enabled.call ? buildCallPropertyFingerprintsFromLocated(located) : [],
  };
}
