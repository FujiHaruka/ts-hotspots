import { Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../collectors/enumerate-declarations.ts";
import { enumerateSourceFiles } from "../collectors/enumerate-source-files.ts";
import { aggregate } from "./aggregate.ts";

function buildCtx(files: Record<string, string>, rootDir: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, content] of Object.entries(files)) {
    project.createSourceFile(path, content);
  }
  const sourceFiles = enumerateSourceFiles(project, rootDir);
  const declarations = enumerateDeclarations(project, rootDir, {
    files: sourceFiles,
  });
  return { project, rootDir, declarations, files: sourceFiles };
}

describe("aggregate", () => {
  test("builds function entries with complete shape", () => {
    const ctx = buildCtx(
      {
        "/proj/src/a.ts":
          "export function f(x: number){ if (x) return 1; return 0; }",
      },
      "/proj",
    );

    const { functions } = aggregate(ctx);
    expect(functions).toHaveLength(1);
    const [f] = functions;
    expect(f).toMatchObject({
      location: "src/a.ts:1",
      name: "f",
      kind: "function",
      metrics: { cyclomaticComplexity: 2 },
    });
  });

  test("includes all type-safety metrics on function entries", () => {
    const ctx = buildCtx(
      {
        "/proj/src/a.ts": [
          "export function f(x: any){",
          "  // @ts-ignore",
          "  const y = x.foo!;",
          "  return y as number;",
          "}",
        ].join("\n"),
      },
      "/proj",
    );

    const [f] = aggregate(ctx).functions;
    const m = f?.metrics;
    if (!m) throw new Error("no function");
    expect(m.anyCount ?? 0).toBeGreaterThanOrEqual(1);
    expect(m.anyTaintedExpressionCount ?? 0).toBeGreaterThanOrEqual(1);
    expect(m.typeAssertionCount).toBe(1);
    expect(m.nonNullAssertionCount).toBe(1);
    expect(m.tsIgnoreCount).toBe(1);
    expect(m.tsExpectErrorCount).toBeUndefined();
    expect(m.tsNocheckCount).toBeUndefined();
  });

  test("sorts functions by (file, line, name)", () => {
    const ctx = buildCtx(
      {
        "/proj/src/b.ts":
          "export function second(){}\nexport function third(){}",
        "/proj/src/a.ts": "export function first(){}",
      },
      "/proj",
    );

    const { functions } = aggregate(ctx);
    expect(functions.map((f) => f.name)).toEqual(["first", "second", "third"]);
  });
});
