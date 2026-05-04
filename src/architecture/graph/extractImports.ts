/**
 * Extract every import binding from a parsed source. The returned
 * records are intentionally naive — we list the local name, what was
 * actually pulled from the module, and whether the binding is
 * type-only. Resolution to a target component happens later, in
 * {@link buildGraph}.
 *
 * Five import shapes are recognised:
 *
 * - `import { foo } from 'm'`            → named, remote name = local name
 * - `import { foo as bar } from 'm'`     → named, remote name = `foo`, local = `bar`
 * - `import * as ns from 'm'`            → namespace; references go through
 *                                          property access (`ns.foo`)
 * - `import foo from 'm'`                → default; remote name = `default`
 * - `import 'm'`                         → side-effect only; ignored (no
 *                                          binding to attribute references to)
 *
 * Type-only-ness propagates from either the declaration (`import type`)
 * or the per-specifier `type` modifier (`import { type Foo }`). Either
 * sets `isTypeOnly: true` on the resulting binding.
 */

import ts from "typescript";
import type { ParsedSource } from "../../parser/parseSource.ts";

type ImportBindingKind = "named" | "default" | "namespace";

export interface ImportBinding {
  /** Identifier in scope inside the importing file. */
  readonly localName: string;
  /**
   * Name on the *remote* module. For `default` imports this is `"default"`;
   * for `namespace` imports it is the empty string (resolution happens via
   * property access, not the binding directly).
   */
  readonly remoteName: string;
  readonly kind: ImportBindingKind;
  /** Module specifier exactly as written (`'./foo'`, `'@/x'`, `'react'`, …). */
  readonly moduleSpecifier: string;
  readonly isTypeOnly: boolean;
}

export function extractImports(parsed: ParsedSource): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  for (const stmt of parsed.sourceFile.statements) {
    if (!ts.isImportDeclaration(stmt)) continue;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    const moduleSpecifier = stmt.moduleSpecifier.text;
    const importClause = stmt.importClause;
    if (importClause === undefined) continue; // bare `import 'm'`
    const declTypeOnly =
      importClause.phaseModifier === ts.SyntaxKind.TypeKeyword;

    if (importClause.name !== undefined) {
      bindings.push({
        localName: importClause.name.text,
        remoteName: "default",
        kind: "default",
        moduleSpecifier,
        isTypeOnly: declTypeOnly,
      });
    }

    const namedBindings = importClause.namedBindings;
    if (namedBindings === undefined) continue;
    if (ts.isNamespaceImport(namedBindings)) {
      bindings.push({
        localName: namedBindings.name.text,
        remoteName: "",
        kind: "namespace",
        moduleSpecifier,
        isTypeOnly: declTypeOnly,
      });
    } else {
      for (const elem of namedBindings.elements) {
        const localName = elem.name.text;
        const remoteName =
          elem.propertyName !== undefined ? elem.propertyName.text : localName;
        bindings.push({
          localName,
          remoteName,
          kind: "named",
          moduleSpecifier,
          isTypeOnly: declTypeOnly || elem.isTypeOnly,
        });
      }
    }
  }
  return bindings;
}
