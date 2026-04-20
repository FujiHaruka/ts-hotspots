import { type Node, SyntaxKind } from "ts-morph";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk.ts";
import {
  countAnyKeywordIn,
  getFunctionBody,
  getFunctionReturnTypeNode,
  hasNoTypeAnnotation,
  nodeTypeIsAny,
} from "./shared.ts";

function isBindingPatternDeclaration(decl: Node): boolean {
  const nameNode = (
    decl as unknown as { getNameNode?: () => Node | undefined }
  ).getNameNode?.();
  if (!nameNode) return false;
  const k = nameNode.getKind();
  return (
    k === SyntaxKind.ArrayBindingPattern ||
    k === SyntaxKind.ObjectBindingPattern
  );
}

export interface AnyCountResult {
  anyCount: number;
}

// `anyCount` = sites where `any` is introduced into the type system for this
// function, as a union of:
//   - Syntactic: every `AnyKeyword` token reachable from the function's own
//     parameter / return-type annotations and from inside its body (excluding
//     nested functions). This catches `: any`, `any[]`, `Array<any>`, `<any>x`,
//     etc.
//   - Implicit: Parameter / VariableDeclaration / BindingElement with NO
//     explicit type annotation whose checker-resolved type is `any`. The
//     implicit pass skips nodes that have an explicit annotation, so a
//     parameter written as `: any` is counted exactly once (by the syntactic
//     pass), never twice.
export function computeAnyCount(node: FunctionLikeNode): number {
  let count = 0;

  for (const param of node.getParameters()) {
    const typeNode = param.getTypeNode();
    if (typeNode) {
      count += countAnyKeywordIn(typeNode);
    } else if (nodeTypeIsAny(param)) {
      count += 1;
    }
  }
  const returnTypeNode = getFunctionReturnTypeNode(node);
  if (returnTypeNode) count += countAnyKeywordIn(returnTypeNode);

  const body = getFunctionBody(node);
  if (body) {
    walkBodyExcludingNestedFunctions(body, (n) => {
      const kind = n.getKind();
      if (kind === SyntaxKind.AnyKeyword) {
        count += 1;
        return;
      }
      if (
        kind === SyntaxKind.VariableDeclaration ||
        kind === SyntaxKind.BindingElement
      ) {
        // Skip destructuring VariableDeclarations (`const [a,b] = ...`,
        // `const {a,b} = ...`): ts-morph's `getType()` reports the whole
        // declaration as `any` even when each BindingElement resolves to a
        // concrete type. The BindingElements themselves are walked and
        // checked individually, so nothing is lost by skipping.
        if (
          kind === SyntaxKind.VariableDeclaration &&
          isBindingPatternDeclaration(n)
        ) {
          return;
        }
        if (hasNoTypeAnnotation(n) && nodeTypeIsAny(n)) {
          count += 1;
        }
      }
    });
  }

  return count;
}

export const anyCountCollector: Collector<AnyCountResult> = {
  name: "anyCount",
  collect(ctx: CollectorContext): Map<DeclarationId, AnyCountResult> {
    const result = new Map<DeclarationId, AnyCountResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, { anyCount: computeAnyCount(decl.node) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `anyCountCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
