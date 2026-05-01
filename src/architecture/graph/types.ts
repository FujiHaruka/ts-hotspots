/**
 * Domain types for the architecture subcommand's component dependency graph.
 *
 * The unit of analysis is the *exported component* — every named export,
 * default export, or exported declaration becomes a {@link Component}.
 * Edges connect components: a component's body referencing another
 * component's export creates an {@link Edge}, with kind chosen from the
 * structural relationship (extends, implements, value-use, construction,
 * re-export, type-only reference, or dynamic/uncertain).
 *
 * Kept parser-only: every value here is computed from `ts.SourceFile`
 * AST shape alone — no `ts.Program`, no TypeChecker.
 */

/** AST-flavour discriminator for an export. */
export type ExportKind =
  | "function"
  | "class"
  | "const"
  | "type"
  | "interface"
  | "enum"
  | "default";

/**
 * Edge kinds map directly onto the weights table in
 * `docs/plans/architecture-subcommand.md` (## Edge weights).
 *
 * `dynamic` covers `import()` calls, `require(<string>)`, and other
 * specifier-not-statically-known cases. Edges of this kind also set
 * {@link Edge.uncertain} = true, but the kind itself is preserved so
 * downstream stages can tell why.
 */
export type EdgeKind =
  | "extends"
  | "implements"
  | "value"
  | "new"
  | "reexport"
  | "type"
  | "dynamic";

/** Weight per edge kind (the `--include-types=false` toggle is applied later). */
export const EDGE_WEIGHTS: Readonly<Record<EdgeKind, number>> = {
  extends: 2.0,
  implements: 1.5,
  value: 1.0,
  new: 1.0,
  reexport: 1.0,
  type: 0.3,
  dynamic: 0.5,
};

/**
 * Sentinel `exportName` for default exports. Default exports have no
 * binding name in the source, so we synthesize one for the component id.
 */
export const DEFAULT_EXPORT_NAME = "default";

export interface Component {
  /** Canonical id `<filePath>::<exportName>::<exportKind>`. */
  readonly id: string;
  readonly filePath: string;
  readonly exportName: string;
  readonly exportKind: ExportKind;
  /** 1-based line number of the export's defining declaration. */
  readonly line: number;
  /**
   * 1-based, inclusive end line of the declaration node. Used by the
   * scoring layer's size axis and hard-floor filter; raw span (includes
   * blanks and comments) is sufficient for the "is this trivially small"
   * question scoring asks.
   */
  readonly endLine: number;
}

export interface Edge {
  readonly from: string;
  readonly to: string;
  readonly kind: EdgeKind;
  /**
   * `true` when the edge target was derived from a non-static specifier
   * (`import(<expr>)`, `require(<expr>)`, DI lookups). Scoring use is
   * deferred to a later milestone; v1 just preserves the flag.
   */
  readonly uncertain: boolean;
}

export interface Graph {
  readonly nodes: readonly Component[];
  readonly edges: readonly Edge[];
}

/**
 * Build the canonical component id. Collisions can only occur if two
 * exports of the same kind share a name in one file — which TypeScript
 * itself rejects, so the id is unique by construction.
 */
export function makeComponentId(
  filePath: string,
  exportName: string,
  exportKind: ExportKind,
): string {
  return `${filePath}::${exportName}::${exportKind}`;
}
