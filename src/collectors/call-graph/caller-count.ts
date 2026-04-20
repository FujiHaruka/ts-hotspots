import { type Node, type SourceFile, SyntaxKind } from "ts-morph";
import type {
  Collector,
  CollectorContext,
  Declaration,
  DeclarationId,
} from "../types.ts";

export interface CallerCountResult {
  callerCount: number;
}

export const callerCountCollector: Collector<CallerCountResult> = {
  name: "callerCount",
  collect(ctx: CollectorContext): Map<DeclarationId, CallerCountResult> {
    const fileSet = new Set<SourceFile>(
      (ctx.files ?? []).map((f) => f.sourceFile),
    );
    const result = new Map<DeclarationId, CallerCountResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, {
          callerCount: computeCallerCount(decl, fileSet),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `callerCountCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};

export function computeCallerCount(
  decl: Declaration,
  fileSet: ReadonlySet<SourceFile>,
): number {
  const anchor = resolveAnchor(decl);
  if (!anchor) return 0;
  if (anchor.getKind() !== SyntaxKind.Identifier) return 0;

  const refs = anchor
    .asKindOrThrow(SyntaxKind.Identifier)
    .findReferencesAsNodes();
  let count = 0;
  for (const ref of refs) {
    if (fileSet.size > 0 && !fileSet.has(ref.getSourceFile())) continue;
    if (isCalleePosition(ref)) count += 1;
  }
  return count;
}

function resolveAnchor(decl: Declaration): Node | undefined {
  const node = decl.node;
  switch (node.getKind()) {
    case SyntaxKind.FunctionDeclaration:
      return node.asKindOrThrow(SyntaxKind.FunctionDeclaration).getNameNode();
    case SyntaxKind.MethodDeclaration:
      return node.asKindOrThrow(SyntaxKind.MethodDeclaration).getNameNode();
    case SyntaxKind.GetAccessor:
      return node.asKindOrThrow(SyntaxKind.GetAccessor).getNameNode();
    case SyntaxKind.SetAccessor:
      return node.asKindOrThrow(SyntaxKind.SetAccessor).getNameNode();
    case SyntaxKind.Constructor: {
      const ctor = node.asKindOrThrow(SyntaxKind.Constructor);
      const parent = ctor.getParent();
      const pk = parent.getKind();
      if (pk === SyntaxKind.ClassDeclaration) {
        return parent.asKindOrThrow(SyntaxKind.ClassDeclaration).getNameNode();
      }
      if (pk === SyntaxKind.ClassExpression) {
        const cls = parent.asKindOrThrow(SyntaxKind.ClassExpression);
        const named = cls.getNameNode();
        if (named) return named;
        return anchorFromBinding(parent);
      }
      return undefined;
    }
    case SyntaxKind.FunctionExpression: {
      const fx = node.asKindOrThrow(SyntaxKind.FunctionExpression);
      const named = fx.getNameNode();
      if (named) return named;
      return anchorFromBinding(node);
    }
    case SyntaxKind.ArrowFunction:
      return anchorFromBinding(node);
    default:
      return undefined;
  }
}

function anchorFromBinding(node: Node): Node | undefined {
  const parent = node.getParent();
  if (!parent) return undefined;
  switch (parent.getKind()) {
    case SyntaxKind.VariableDeclaration: {
      const name = parent
        .asKindOrThrow(SyntaxKind.VariableDeclaration)
        .getNameNode();
      return name.getKind() === SyntaxKind.Identifier ? name : undefined;
    }
    case SyntaxKind.PropertyAssignment:
      return parent.asKindOrThrow(SyntaxKind.PropertyAssignment).getNameNode();
    case SyntaxKind.PropertyDeclaration:
      return parent.asKindOrThrow(SyntaxKind.PropertyDeclaration).getNameNode();
    default:
      return undefined;
  }
}

function isCalleePosition(ref: Node): boolean {
  let current: Node = ref;
  let parent: Node | undefined = current.getParent();

  if (parent?.getKind() === SyntaxKind.PropertyAccessExpression) {
    const pa = parent.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
    if (pa.getNameNode() === current) {
      current = parent;
      parent = parent.getParent();
    } else {
      return false;
    }
  }

  if (!parent) return false;
  const pk = parent.getKind();
  if (pk === SyntaxKind.CallExpression) {
    return (
      parent.asKindOrThrow(SyntaxKind.CallExpression).getExpression() ===
      current
    );
  }
  if (pk === SyntaxKind.NewExpression) {
    return (
      parent.asKindOrThrow(SyntaxKind.NewExpression).getExpression() === current
    );
  }
  return false;
}
