import { type Node, SyntaxKind } from "ts-morph";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";

export interface CognitiveResult {
  cognitiveComplexity: number;
}

const NESTED_FUNCTION_KINDS = new Set<SyntaxKind>([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.ArrowFunction,
  SyntaxKind.FunctionExpression,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
  SyntaxKind.Constructor,
]);

const LOGICAL_OPERATOR_KINDS = new Set<SyntaxKind>([
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
]);

export function computeCognitive(node: FunctionLikeNode): number {
  const body = getBody(node);
  if (!body) return 0;

  const ownName = getOwnName(node);
  let score = 0;

  const visit = (n: Node, nesting: number): void => {
    const kind = n.getKind();

    // Stop descent into nested function-like declarations: each is scored standalone.
    if (NESTED_FUNCTION_KINDS.has(kind)) return;

    switch (kind) {
      case SyntaxKind.IfStatement: {
        const ifStmt = n.asKindOrThrow(SyntaxKind.IfStatement);
        // "else if": an IfStatement whose parent is an IfStatement and is that parent's else branch.
        const parent = n.getParent();
        const isElseIf =
          parent?.getKind() === SyntaxKind.IfStatement &&
          parent.asKindOrThrow(SyntaxKind.IfStatement).getElseStatement() === n;
        if (isElseIf) {
          // Special case: +1 with no nesting bonus, same nesting level as the parent if.
          score += 1;
        } else {
          score += 1 + nesting;
        }
        // Condition: no nesting bump, but still walk for logical operators / ternaries.
        visit(ifStmt.getExpression(), nesting);
        // Then branch: nesting+1 (but only if it's not an "else if" pattern applying to its own then).
        visit(ifStmt.getThenStatement(), nesting + 1);
        const elseStmt = ifStmt.getElseStatement();
        if (elseStmt) {
          if (elseStmt.getKind() === SyntaxKind.IfStatement) {
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

      case SyntaxKind.ForStatement:
      case SyntaxKind.ForInStatement:
      case SyntaxKind.ForOfStatement:
      case SyntaxKind.WhileStatement:
      case SyntaxKind.DoStatement: {
        score += 1 + nesting;
        // Walk children at same nesting, except the loop body goes to nesting+1.
        const body = (n as unknown as { getStatement(): Node }).getStatement();
        for (const child of n.getChildren()) {
          if (child === body) {
            visit(child, nesting + 1);
          } else {
            visit(child, nesting);
          }
        }
        return;
      }

      case SyntaxKind.CatchClause: {
        score += 1 + nesting;
        // Walk children: the block runs at nesting+1, everything else at nesting.
        for (const child of n.getChildren()) {
          if (child.getKind() === SyntaxKind.Block) {
            visit(child, nesting + 1);
          } else {
            visit(child, nesting);
          }
        }
        return;
      }

      case SyntaxKind.ConditionalExpression: {
        score += 1 + nesting;
        const cond = n.asKindOrThrow(SyntaxKind.ConditionalExpression);
        // Condition at same nesting; the two branches at nesting+1.
        visit(cond.getCondition(), nesting);
        visit(cond.getWhenTrue(), nesting + 1);
        visit(cond.getWhenFalse(), nesting + 1);
        return;
      }

      case SyntaxKind.SwitchStatement: {
        score += 1;
        const sw = n.asKindOrThrow(SyntaxKind.SwitchStatement);
        // Switch expression at same nesting; case block at nesting+1.
        visit(sw.getExpression(), nesting);
        visit(sw.getCaseBlock(), nesting + 1);
        return;
      }

      case SyntaxKind.BreakStatement:
      case SyntaxKind.ContinueStatement: {
        const labeled = (
          n as unknown as { getLabel(): Node | undefined }
        ).getLabel();
        if (labeled) score += 1;
        return;
      }

      case SyntaxKind.BinaryExpression: {
        const bin = n.asKindOrThrow(SyntaxKind.BinaryExpression);
        const opKind = bin.getOperatorToken().getKind();
        if (LOGICAL_OPERATOR_KINDS.has(opKind)) {
          // Count only the top of a run of the same operator.
          const parent = n.getParent();
          const parentIsSameOp =
            parent?.getKind() === SyntaxKind.BinaryExpression &&
            parent
              .asKindOrThrow(SyntaxKind.BinaryExpression)
              .getOperatorToken()
              .getKind() === opKind;
          if (!parentIsSameOp) score += 1;
        }
        for (const child of n.getChildren()) visit(child, nesting);
        return;
      }

      case SyntaxKind.CallExpression: {
        if (ownName !== undefined) {
          const callee = (
            n as unknown as { getExpression(): Node }
          ).getExpression();
          if (
            callee.getKind() === SyntaxKind.Identifier &&
            callee.getText() === ownName
          ) {
            score += 1;
          }
        }
        for (const child of n.getChildren()) visit(child, nesting);
        return;
      }

      default: {
        for (const child of n.getChildren()) visit(child, nesting);
        return;
      }
    }
  };

  visit(body, 0);
  return score;
}

function getBody(node: FunctionLikeNode): Node | undefined {
  if (node.getKind() === SyntaxKind.ArrowFunction) {
    return node.asKindOrThrow(SyntaxKind.ArrowFunction).getBody();
  }
  return (node as unknown as { getBody(): Node | undefined }).getBody();
}

function getOwnName(node: FunctionLikeNode): string | undefined {
  const kind = node.getKind();
  if (kind === SyntaxKind.FunctionDeclaration) {
    const name = node.asKindOrThrow(SyntaxKind.FunctionDeclaration).getName();
    return name === undefined || name === "" ? undefined : name;
  }
  if (kind === SyntaxKind.FunctionExpression) {
    const name = node.asKindOrThrow(SyntaxKind.FunctionExpression).getName();
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
          cognitiveComplexity: computeCognitive(decl.node),
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
