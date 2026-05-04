import { Minimatch } from "minimatch";
import ts from "typescript";
import type { SourceFileInfo } from "../loader/types.ts";
import type { FunctionKind } from "../schema.ts";
import type { Declaration, FunctionLikeNode } from "./types.ts";

const FUNCTION_KINDS: Partial<Record<ts.SyntaxKind, FunctionKind>> = {
  [ts.SyntaxKind.FunctionDeclaration]: "function",
  [ts.SyntaxKind.MethodDeclaration]: "method",
  [ts.SyntaxKind.ArrowFunction]: "arrow",
  [ts.SyntaxKind.FunctionExpression]: "function-expression",
  [ts.SyntaxKind.GetAccessor]: "getter",
  [ts.SyntaxKind.SetAccessor]: "setter",
  [ts.SyntaxKind.Constructor]: "constructor",
};

const SOURCE_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts"];

interface EnumerateDeclarationsOptions {
  exclude?: readonly string[];
}

export function enumerateDeclarations(
  files: readonly SourceFileInfo[],
  options: EnumerateDeclarationsOptions = {},
): Declaration[] {
  const declarations: Declaration[] = [];
  const filtered = filterSourceFiles(files, options);

  for (const { path: relPosix, sourceFile } of filtered) {
    visit(sourceFile, sourceFile, relPosix, declarations);
  }

  return declarations;
}

function visit(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  relPosix: string,
  out: Declaration[],
): void {
  const kind = FUNCTION_KINDS[node.kind];
  if (kind !== undefined) {
    const fn = node as FunctionLikeNode;
    if (hasBody(fn)) {
      out.push({
        id: `${relPosix}:${String(fn.getStart(sourceFile))}`,
        node: fn,
        sourceFile,
        kind,
        name: getDeclarationName(fn, sourceFile),
        file: relPosix,
        line:
          ts.getLineAndCharacterOfPosition(sourceFile, fn.getStart(sourceFile))
            .line + 1,
        endLine:
          ts.getLineAndCharacterOfPosition(sourceFile, fn.getEnd()).line + 1,
      });
    }
  }
  ts.forEachChild(node, (child) => {
    visit(child, sourceFile, relPosix, out);
  });
}

function filterSourceFiles(
  files: readonly SourceFileInfo[],
  options: EnumerateDeclarationsOptions,
): readonly SourceFileInfo[] {
  const matchers = (options.exclude ?? []).map(
    (p) => new Minimatch(p, { dot: true }),
  );
  const out: SourceFileInfo[] = [];
  for (const info of files) {
    if (info.sourceFile.isDeclarationFile) continue;
    if (!SOURCE_EXTENSIONS.some((ext) => info.path.endsWith(ext))) continue;
    if (info.path.includes("node_modules/")) continue;
    if (matchers.some((m) => m.match(info.path))) continue;
    out.push(info);
  }
  return out;
}

function hasBody(node: FunctionLikeNode): boolean {
  if (node.kind === ts.SyntaxKind.ArrowFunction) return true;
  return node.body !== undefined;
}

function getDeclarationName(
  node: FunctionLikeNode,
  sourceFile: ts.SourceFile,
): string {
  switch (node.kind) {
    case ts.SyntaxKind.Constructor:
      return "constructor";
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
      return node.name.getText(sourceFile);
    case ts.SyntaxKind.FunctionDeclaration: {
      const named = node.name?.text;
      if (named !== undefined && named !== "") return named;
      break;
    }
    case ts.SyntaxKind.MethodDeclaration: {
      const named = node.name.getText(sourceFile);
      if (named !== "") return named;
      break;
    }
    case ts.SyntaxKind.FunctionExpression: {
      const named = node.name?.text;
      if (named !== undefined && named !== "") return named;
      break;
    }
    default:
      break;
  }

  return resolveBindingName(node, sourceFile) ?? "<anonymous>";
}

const TRANSPARENT_WRAPPER_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.CallExpression,
  ts.SyntaxKind.ParenthesizedExpression,
  ts.SyntaxKind.AsExpression,
  ts.SyntaxKind.SatisfiesExpression,
  ts.SyntaxKind.NonNullExpression,
  ts.SyntaxKind.TypeAssertionExpression,
]);

function resolveBindingName(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string | undefined {
  let current: ts.Node = node;
  for (let step = 0; step < 32; step += 1) {
    const parent: ts.Node | undefined = current.parent;
    if (!parent) return undefined;
    const parentKind = parent.kind;

    if (parentKind === ts.SyntaxKind.VariableDeclaration) {
      return (parent as ts.VariableDeclaration).name.getText(sourceFile);
    }
    if (parentKind === ts.SyntaxKind.PropertyAssignment) {
      return (parent as ts.PropertyAssignment).name.getText(sourceFile);
    }
    if (parentKind === ts.SyntaxKind.PropertyDeclaration) {
      return (parent as ts.PropertyDeclaration).name.getText(sourceFile);
    }
    if (parentKind === ts.SyntaxKind.ExportAssignment) {
      return "default";
    }
    if (parentKind === ts.SyntaxKind.BinaryExpression) {
      const bin = parent as ts.BinaryExpression;
      if (
        bin.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        bin.right === current
      ) {
        return extractAssignmentTargetName(bin.left, sourceFile);
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

function extractAssignmentTargetName(
  lhs: ts.Node,
  sourceFile: ts.SourceFile,
): string | undefined {
  if (lhs.kind === ts.SyntaxKind.Identifier) {
    return (lhs as ts.Identifier).text;
  }
  if (lhs.kind === ts.SyntaxKind.PropertyAccessExpression) {
    return (lhs as ts.PropertyAccessExpression).name.getText(sourceFile);
  }
  return undefined;
}
