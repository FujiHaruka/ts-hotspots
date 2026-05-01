import { type Node, type Project, SyntaxKind } from "ts-morph";
import type { FunctionKind } from "../schema.ts";
import {
  enumerateSourceFiles,
  type SourceFileInfo,
} from "./enumerate-source-files.ts";
import type {
  Declaration,
  FunctionLikeNode,
  FunctionLikeTsNode,
} from "./types.ts";

const FUNCTION_KINDS: Partial<Record<SyntaxKind, FunctionKind>> = {
  [SyntaxKind.FunctionDeclaration]: "function",
  [SyntaxKind.MethodDeclaration]: "method",
  [SyntaxKind.ArrowFunction]: "arrow",
  [SyntaxKind.FunctionExpression]: "function-expression",
  [SyntaxKind.GetAccessor]: "getter",
  [SyntaxKind.SetAccessor]: "setter",
  [SyntaxKind.Constructor]: "constructor",
};

export interface EnumerateDeclarationsOptions {
  exclude?: readonly string[];
  files?: readonly SourceFileInfo[];
}

export function enumerateDeclarations(
  project: Project,
  rootDir: string,
  options: EnumerateDeclarationsOptions = {},
): Declaration[] {
  const declarations: Declaration[] = [];
  const files =
    options.files ??
    enumerateSourceFiles(project, rootDir, { exclude: options.exclude });

  for (const { path: relPosix, sourceFile } of files) {
    const tsSourceFile = sourceFile.compilerNode;
    sourceFile.forEachDescendant((node) => {
      const kind = FUNCTION_KINDS[node.getKind()];
      if (!kind) return;
      const fn = node as FunctionLikeNode;
      if (!hasBody(fn)) return;
      declarations.push({
        id: `${relPosix}:${String(fn.getStart())}`,
        node: fn,
        tsNode: fn.compilerNode as FunctionLikeTsNode,
        tsSourceFile,
        kind,
        name: getDeclarationName(fn),
        file: relPosix,
        line: fn.getStartLineNumber(),
        endLine: fn.getEndLineNumber(),
      });
    });
  }

  return declarations;
}

function hasBody(node: FunctionLikeNode): boolean {
  if (node.getKind() === SyntaxKind.ArrowFunction) return true;
  const body = (node as unknown as { getBody(): Node | undefined }).getBody();
  return body !== undefined;
}

function getDeclarationName(node: FunctionLikeNode): string {
  switch (node.getKind()) {
    case SyntaxKind.Constructor:
      return "constructor";
    case SyntaxKind.GetAccessor:
      return node.asKindOrThrow(SyntaxKind.GetAccessor).getName();
    case SyntaxKind.SetAccessor:
      return node.asKindOrThrow(SyntaxKind.SetAccessor).getName();
    case SyntaxKind.FunctionDeclaration: {
      const named = node
        .asKindOrThrow(SyntaxKind.FunctionDeclaration)
        .getName();
      if (named !== undefined && named !== "") return named;
      break;
    }
    case SyntaxKind.MethodDeclaration: {
      const named = node.asKindOrThrow(SyntaxKind.MethodDeclaration).getName();
      if (named !== "") return named;
      break;
    }
    case SyntaxKind.FunctionExpression: {
      const named = node.asKindOrThrow(SyntaxKind.FunctionExpression).getName();
      if (named !== undefined && named !== "") return named;
      break;
    }
    default:
      break;
  }

  return resolveBindingName(node) ?? "<anonymous>";
}

const TRANSPARENT_WRAPPER_KINDS = new Set<SyntaxKind>([
  SyntaxKind.CallExpression,
  SyntaxKind.ParenthesizedExpression,
  SyntaxKind.AsExpression,
  SyntaxKind.SatisfiesExpression,
  SyntaxKind.NonNullExpression,
  SyntaxKind.TypeAssertionExpression,
]);

function resolveBindingName(node: Node): string | undefined {
  let current: Node = node;
  for (let step = 0; step < 32; step += 1) {
    const parent: Node | undefined = current.getParent();
    if (!parent) return undefined;
    const parentKind = parent.getKind();

    if (parentKind === SyntaxKind.VariableDeclaration) {
      return parent.asKindOrThrow(SyntaxKind.VariableDeclaration).getName();
    }
    if (parentKind === SyntaxKind.PropertyAssignment) {
      return parent.asKindOrThrow(SyntaxKind.PropertyAssignment).getName();
    }
    if (parentKind === SyntaxKind.PropertyDeclaration) {
      return parent.asKindOrThrow(SyntaxKind.PropertyDeclaration).getName();
    }
    if (parentKind === SyntaxKind.ExportAssignment) {
      return "default";
    }
    if (parentKind === SyntaxKind.BinaryExpression) {
      const bin = parent.asKindOrThrow(SyntaxKind.BinaryExpression);
      if (
        bin.getOperatorToken().getKind() === SyntaxKind.EqualsToken &&
        bin.getRight() === current
      ) {
        return extractAssignmentTargetName(bin.getLeft());
      }
      return undefined;
    }

    if (TRANSPARENT_WRAPPER_KINDS.has(parentKind)) {
      current = parent;
      continue;
    }
    return undefined;
  }
  return undefined;
}

function extractAssignmentTargetName(lhs: Node): string | undefined {
  const kind = lhs.getKind();
  if (kind === SyntaxKind.Identifier) {
    return lhs.getText();
  }
  if (kind === SyntaxKind.PropertyAccessExpression) {
    return lhs.asKindOrThrow(SyntaxKind.PropertyAccessExpression).getName();
  }
  return undefined;
}
