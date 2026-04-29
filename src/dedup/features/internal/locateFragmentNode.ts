import ts from "typescript";
import type { Fragment } from "../../domain/fragment.ts";

/**
 * Result of locating a fragment inside its parent `SourceFile`.
 *
 * For `function` and `block` fragments, `nodes` has a single element — the
 * AST node that owns the range. For `window` fragments, `nodes` is the
 * contiguous list of statements the window spans.
 *
 * `directStatements` is the list of "direct statements" the statement-kind
 * n-gram extractor should walk:
 * - function: statements directly inside the function `Block` body
 *   (empty for expression-bodied arrow functions);
 * - block: statements directly inside the control block's `Block`
 *   sub-statements (e.g. the `then` block, the loop body);
 * - window: the window's own statements list.
 */
export interface LocatedFragment {
  readonly startPos: number;
  readonly endPos: number;
  readonly nodes: readonly ts.Node[];
  readonly directStatements: readonly ts.Node[];
}

export function locateFragmentNode(
  fragment: Fragment,
  sourceFile: ts.SourceFile,
): LocatedFragment {
  const { startPos, endPos } = rangeFromLines(fragment, sourceFile);

  if (fragment.kind === "window") {
    const windowNodes = findWindowStatements(sourceFile, startPos, endPos);
    return {
      startPos,
      endPos,
      nodes: windowNodes,
      directStatements: windowNodes,
    };
  }

  const node = findNodeByRangeAndKind(
    sourceFile,
    startPos,
    endPos,
    fragment.astNodeKind,
  );
  if (node === undefined) {
    return {
      startPos,
      endPos,
      nodes: [],
      directStatements: [],
    };
  }

  const direct = collectDirectStatements(node);
  return {
    startPos: node.getStart(sourceFile),
    endPos: node.getEnd(),
    nodes: [node],
    directStatements: direct,
  };
}

function rangeFromLines(
  fragment: Fragment,
  sourceFile: ts.SourceFile,
): { startPos: number; endPos: number } {
  const startPos = ts.getPositionOfLineAndCharacter(
    sourceFile,
    fragment.startLine - 1,
    0,
  );
  const lineStarts = sourceFile.getLineStarts();
  const endLineIndex = fragment.endLine;
  const endPos =
    endLineIndex < lineStarts.length
      ? (lineStarts[endLineIndex] ?? sourceFile.text.length)
      : sourceFile.text.length;
  return { startPos, endPos };
}

function findNodeByRangeAndKind(
  sourceFile: ts.SourceFile,
  startPos: number,
  endPos: number,
  astNodeKind: string,
): ts.Node | undefined {
  let best: ts.Node | undefined;

  const visit = (node: ts.Node): void => {
    if (best !== undefined) {
      return;
    }
    const ns = node.getStart(sourceFile);
    const ne = node.getEnd();
    if (ne <= startPos || ns >= endPos) {
      return;
    }
    if (
      ns >= startPos &&
      ne <= endPos &&
      ts.SyntaxKind[node.kind] === astNodeKind
    ) {
      best = node;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return best;
}

function findWindowStatements(
  sourceFile: ts.SourceFile,
  startPos: number,
  endPos: number,
): ts.Node[] {
  let matched: ts.Node[] = [];

  const tryContainer = (stmts: readonly ts.Statement[]): boolean => {
    if (stmts.length === 0) {
      return false;
    }
    const first = stmts.findIndex((s) => s.getStart(sourceFile) >= startPos);
    if (first === -1) {
      return false;
    }
    const firstStmt = stmts[first];
    if (firstStmt?.getStart(sourceFile) !== startPos) {
      return false;
    }
    const picked: ts.Node[] = [];
    for (let i = first; i < stmts.length; i++) {
      const s = stmts[i];
      if (s === undefined) {
        break;
      }
      if (s.getEnd() <= endPos) {
        picked.push(s);
      } else {
        break;
      }
    }
    if (picked.length === 0) {
      return false;
    }
    matched = picked;
    return true;
  };

  const visit = (node: ts.Node): void => {
    if (matched.length > 0) {
      return;
    }
    const ns = node.getStart(sourceFile);
    const ne = node.getEnd();
    if (ne < startPos || ns > endPos) {
      return;
    }
    const stmts = getStatementsField(node);
    if (stmts !== undefined && tryContainer(stmts)) {
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return matched;
}

function getStatementsField(
  node: ts.Node,
): readonly ts.Statement[] | undefined {
  switch (node.kind) {
    case ts.SyntaxKind.SourceFile:
      return (node as ts.SourceFile).statements;
    case ts.SyntaxKind.Block:
      return (node as ts.Block).statements;
    case ts.SyntaxKind.ModuleBlock:
      return (node as ts.ModuleBlock).statements;
    case ts.SyntaxKind.CaseClause:
      return (node as ts.CaseClause).statements;
    case ts.SyntaxKind.DefaultClause:
      return (node as ts.DefaultClause).statements;
    default:
      return undefined;
  }
}

/**
 * Walk the node's "body" Blocks and flatten their direct statements.
 *
 * - Function-like: body.statements (if body is a Block).
 * - IfStatement: concatenate thenBlock.statements + elseBlock.statements.
 *   For `else if` chains, we descend into the chained IfStatement and keep
 *   flattening — from the outer if's perspective, the inner if counts as
 *   one `IfStatement` node per-chain is not what we want here; instead,
 *   treat the entire `else if` sub-tree as one element (the IfStatement
 *   node itself).
 * - Loop / try / catch / switch: descend into their Block-typed children
 *   only. Non-Block sub-statements (e.g. single-statement loop bodies) are
 *   treated as one element (themselves).
 */
function collectDirectStatements(node: ts.Node): ts.Node[] {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isConstructorDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node)
  ) {
    const body = (node as { body?: ts.Node }).body;
    if (body !== undefined && ts.isBlock(body)) {
      return [...body.statements];
    }
    return [];
  }

  if (ts.isIfStatement(node)) {
    const out: ts.Node[] = [];
    pushBranchStatements(node.thenStatement, out);
    if (node.elseStatement !== undefined) {
      pushBranchStatements(node.elseStatement, out);
    }
    return out;
  }
  if (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  ) {
    const out: ts.Node[] = [];
    pushBranchStatements(node.statement, out);
    return out;
  }
  if (ts.isTryStatement(node)) {
    const out: ts.Node[] = [];
    out.push(...node.tryBlock.statements);
    if (node.catchClause !== undefined) {
      out.push(...node.catchClause.block.statements);
    }
    if (node.finallyBlock !== undefined) {
      out.push(...node.finallyBlock.statements);
    }
    return out;
  }
  if (ts.isCatchClause(node)) {
    return [...node.block.statements];
  }
  if (ts.isSwitchStatement(node)) {
    const out: ts.Node[] = [];
    for (const clause of node.caseBlock.clauses) {
      out.push(...clause.statements);
    }
    return out;
  }
  return [];
}

function pushBranchStatements(sub: ts.Node, out: ts.Node[]): void {
  if (ts.isBlock(sub)) {
    out.push(...sub.statements);
    return;
  }
  out.push(sub);
}
