import type ts from "typescript";
import type { Config } from "../config/config.ts";
import type { FeatureKey } from "../domain/feature.ts";
import type { Fragment } from "../domain/fragment.ts";
import {
  type LocatedFragment,
  locateFragmentNode,
} from "./internal/locateFragmentNode.ts";
import { syntaxKindName } from "./internal/syntaxKindName.ts";

/**
 * Build statement-kind n-gram feature keys for a fragment.
 *
 * We only look at the direct statements of the fragment's body / block —
 * nested constructs contribute a single element (their own node kind) so
 * the outer and inner fragments carry distinct, non-overlapping signals.
 */
export function buildStatementKindNgrams(
  fragment: Fragment,
  sourceFile: ts.SourceFile,
  config: Config,
): FeatureKey[] {
  return buildStatementKindNgramsFromLocated(
    locateFragmentNode(fragment, sourceFile),
    config,
  );
}

/**
 * Fast-path variant for callers that have already located the fragment node.
 */
export function buildStatementKindNgramsFromLocated(
  located: LocatedFragment,
  config: Config,
): FeatureKey[] {
  if (located.directStatements.length === 0) {
    return [];
  }
  const kinds = located.directStatements.map((n) => syntaxKindName(n.kind));
  const out: FeatureKey[] = [];
  for (const size of config.features.statementNgramSizes) {
    if (size <= 0 || kinds.length < size) {
      continue;
    }
    for (let i = 0; i + size <= kinds.length; i++) {
      const slice = kinds.slice(i, i + size).join("|");
      out.push(`statement:${slice}`);
    }
  }
  return out;
}
