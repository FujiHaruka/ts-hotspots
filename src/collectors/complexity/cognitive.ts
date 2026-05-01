import ts from "typescript";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";

export interface CognitiveResult {
  cognitiveComplexity: number;
}

const NESTED_FUNCTION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
]);

const LOGICAL_OPERATOR_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
]);

export function computeCognitive(
  node: FunctionLikeNode,
  sourceFile: ts.SourceFile,
): number {
  const body = getBody(node);
  if (!body) return 0;

  const ownName = getOwnName(node);
  let score = 0;

  const visit = (n: ts.Node, nesting: number): void => {
    const kind = n.kind;

    // Stop descent into nested function-like declarations: each is scored standalone.
    if (NESTED_FUNCTION_KINDS.has(kind)) return;

    switch (kind) {
      case ts.SyntaxKind.IfStatement: {
        const ifStmt = n as ts.IfStatement;
        // "else if": an IfStatement whose parent is an IfStatement and is that parent's else branch.
        const parent = n.parent as ts.Node | undefined;
        const isElseIf =
          parent?.kind === ts.SyntaxKind.IfStatement &&
          (parent as ts.IfStatement).elseStatement === n;
        if (isElseIf) {
          // Special case: +1 with no nesting bonus, same nesting level as the parent if.
          score += 1;
        } else {
          score += 1 + nesting;
        }
        // Condition: no nesting bump, but still walk for logical operators / ternaries.
        visit(ifStmt.expression, nesting);
        // Then branch: nesting+1 (but only if it's not an "else if" pattern applying to its own then).
        visit(ifStmt.thenStatement, nesting + 1);
        const elseStmt = ifStmt.elseStatement;
        if (elseStmt) {
          if (elseStmt.kind === ts.SyntaxKind.IfStatement) {
            // Else-if: same nesting level; the inner IfStatement itself handles its own +1.
            visit(elseStmt, nesting);
          } else {
            // Real else: +1 no nesting bonus, body at nesting+1.
            score += 1;
            visit(elseStmt, nesting + 1);
          }
        }
        return;
      }

      case ts.SyntaxKind.ForStatement:
      case ts.SyntaxKind.ForInStatement:
      case ts.SyntaxKind.ForOfStatement:
      case ts.SyntaxKind.WhileStatement:
      case ts.SyntaxKind.DoStatement: {
        score += 1 + nesting;
        const loopBody = (
          n as
            | ts.ForStatement
            | ts.ForInStatement
            | ts.ForOfStatement
            | ts.WhileStatement
            | ts.DoStatement
        ).statement;
        ts.forEachChild(n, (child) => {
          if (child === loopBody) {
            visit(child, nesting + 1);
          } else {
            visit(child, nesting);
          }
        });
        return;
      }

      case ts.SyntaxKind.CatchClause: {
        score += 1 + nesting;
        // Walk children: the block runs at nesting+1, everything else at nesting.
        ts.forEachChild(n, (child) => {
          if (child.kind === ts.SyntaxKind.Block) {
            visit(child, nesting + 1);
          } else {
            visit(child, nesting);
          }
        });
        return;
      }

      case ts.SyntaxKind.ConditionalExpression: {
        score += 1 + nesting;
        const cond = n as ts.ConditionalExpression;
        // Condition at same nesting; the two branches at nesting+1.
        visit(cond.condition, nesting);
        visit(cond.whenTrue, nesting + 1);
        visit(cond.whenFalse, nesting + 1);
        return;
      }

      case ts.SyntaxKind.SwitchStatement: {
        score += 1;
        const sw = n as ts.SwitchStatement;
        // Switch expression at same nesting; case block at nesting+1.
        visit(sw.expression, nesting);
        visit(sw.caseBlock, nesting + 1);
        return;
      }

      case ts.SyntaxKind.BreakStatement:
      case ts.SyntaxKind.ContinueStatement: {
        const labeled = (n as ts.BreakStatement | ts.ContinueStatement).label;
        if (labeled) score += 1;
        return;
      }

      case ts.SyntaxKind.BinaryExpression: {
        const bin = n as ts.BinaryExpression;
        const opKind = bin.operatorToken.kind;
        if (LOGICAL_OPERATOR_KINDS.has(opKind)) {
          // Count only the top of a run of the same operator.
          const parent = n.parent as ts.Node | undefined;
          const parentIsSameOp =
            parent?.kind === ts.SyntaxKind.BinaryExpression &&
            (parent as ts.BinaryExpression).operatorToken.kind === opKind;
          if (!parentIsSameOp) score += 1;
        }
        ts.forEachChild(n, (child) => visit(child, nesting));
        return;
      }

      case ts.SyntaxKind.CallExpression: {
        if (ownName !== undefined) {
          const callee = (n as ts.CallExpression).expression;
          if (
            callee.kind === ts.SyntaxKind.Identifier &&
            (callee as ts.Identifier).text === ownName
          ) {
            score += 1;
          }
        }
        ts.forEachChild(n, (child) => visit(child, nesting));
        return;
      }

      default: {
        ts.forEachChild(n, (child) => visit(child, nesting));
        return;
      }
    }
  };

  visit(body, 0);
  return score;
}

function getBody(node: FunctionLikeNode): ts.Node | undefined {
  if (node.kind === ts.SyntaxKind.ArrowFunction) {
    return (node as ts.ArrowFunction).body;
  }
  return (node as Exclude<FunctionLikeNode, ts.ArrowFunction>).body;
}

function getOwnName(node: FunctionLikeNode): string | undefined {
  if (node.kind === ts.SyntaxKind.FunctionDeclaration) {
    const name = (node as ts.FunctionDeclaration).name?.text;
    return name === undefined || name === "" ? undefined : name;
  }
  if (node.kind === ts.SyntaxKind.FunctionExpression) {
    const name = (node as ts.FunctionExpression).name?.text;
    return name === undefined || name === "" ? undefined : name;
  }
  // Methods/accessors/constructors/anonymous: recursion via `this.m()` not detected (out of scope).
  return undefined;
}

export const cognitiveCollector: Collector<CognitiveResult> = {
  name: "cognitive",
  collect(ctx: CollectorContext): Map<DeclarationId, CognitiveResult> {
    const result = new Map<DeclarationId, CognitiveResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, {
          cognitiveComplexity: computeCognitive(decl.node, decl.sourceFile),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `cognitiveCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
