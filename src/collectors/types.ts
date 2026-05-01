import type ts from "typescript";
import type {
  ArrowFunction,
  ConstructorDeclaration,
  FunctionDeclaration,
  FunctionExpression,
  GetAccessorDeclaration,
  MethodDeclaration,
  Project,
  SetAccessorDeclaration,
} from "ts-morph";
import type { FunctionKind } from "../schema.ts";
import type { SourceFileInfo } from "./enumerate-source-files.ts";

export type FunctionLikeNode =
  | FunctionDeclaration
  | MethodDeclaration
  | ArrowFunction
  | FunctionExpression
  | GetAccessorDeclaration
  | SetAccessorDeclaration
  | ConstructorDeclaration;

/**
 * Raw `ts.Node` counterpart of {@link FunctionLikeNode}. M2 collectors will
 * narrow against this union; the bridge in M1 just exposes the underlying
 * `ts.Node` via `Declaration.tsNode` so call sites can be migrated one at a
 * time.
 */
export type FunctionLikeTsNode =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration
  | ts.ConstructorDeclaration;

export type DeclarationId = string;

export interface Declaration {
  id: DeclarationId;
  node: FunctionLikeNode;
  /**
   * Bridge field for the ts-morph removal migration. Points at the same
   * underlying `ts.Node` that `node` wraps (via `node.compilerNode`). M2
   * collectors read this in place of `node`; once all collectors are
   * migrated, `node` is dropped and `tsNode` becomes the sole reference.
   */
  tsNode: FunctionLikeTsNode;
  /**
   * The `ts.SourceFile` that owns `tsNode`. Required because raw `ts.Node`
   * needs the SourceFile passed explicitly for `getText()` and position
   * lookups (`ts.getLineAndCharacterOfPosition`). Same source file as
   * `node.getSourceFile().compilerNode`, captured here so collectors don't
   * have to re-derive it.
   */
  tsSourceFile: ts.SourceFile;
  kind: FunctionKind;
  name: string;
  file: string;
  line: number;
  endLine: number;
}

export interface CollectorContext {
  project: Project;
  rootDir: string;
  declarations: readonly Declaration[];
  files?: readonly SourceFileInfo[];
}

export interface Collector<T> {
  readonly name: string;
  collect(ctx: CollectorContext): Map<DeclarationId, T>;
}
