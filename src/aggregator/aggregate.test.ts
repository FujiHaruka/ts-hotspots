import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../collectors/enumerate-declarations.ts";
import { mkSourceFiles } from "../collectors/internal/mkSourceFiles.test-helper.ts";
import { aggregate } from "./aggregate.ts";

function buildCtx(files: Record<string, string>, rootDir: string) {
  const sourceFiles = mkSourceFiles(files);
  const declarations = enumerateDeclarations(sourceFiles);
  return { rootDir, declarations, files: sourceFiles };
}

describe("aggregate", () => {
  test("builds function entries with complete shape", () => {
    const ctx = buildCtx(
      {
        "src/a.ts":
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
      metrics: { cognitiveComplexity: 1, parameterCount: 1 },
    });
  });

  test("sorts functions by (file, line, name)", () => {
    const ctx = buildCtx(
      {
        "src/b.ts": "export function second(){}\nexport function third(){}",
        "src/a.ts": "export function first(){}",
      },
      "/proj",
    );

    const { functions } = aggregate(ctx);
    expect(functions.map((f) => f.name)).toEqual(["first", "second", "third"]);
  });
});
