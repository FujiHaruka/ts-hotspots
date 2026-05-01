import type ts from "typescript";
import type { SourceFileInfo } from "../loader/types.ts";
import type { FunctionKind } from "../schema.ts";

export type FunctionLikeNode =
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
  sourceFile: ts.SourceFile;
  kind: FunctionKind;
  name: string;
  file: string;
  line: number;
  endLine: number;
}

export interface CollectorContext {
  rootDir: string;
  declarations: readonly Declaration[];
  files?: readonly SourceFileInfo[];
}

export interface Collector<T> {
  readonly name: string;
  collect(ctx: CollectorContext): Map<DeclarationId, T>;
}
