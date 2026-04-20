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

export type DeclarationId = string;

export interface Declaration {
  id: DeclarationId;
  node: FunctionLikeNode;
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
