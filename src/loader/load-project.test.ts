import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { loadProject, TsconfigNotFoundError } from "./load-project.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_TSCONFIG = resolve(
  HERE,
  "../../test/fixtures/sample-project/tsconfig.json",
);
const MONOREPO_ROOT_TSCONFIG = resolve(
  HERE,
  "../../test/fixtures/sample-monorepo/tsconfig.json",
);

describe("loadProject", () => {
  test("builds a ts-morph Project from a tsconfig", () => {
    const { project, tsconfigPath } = loadProject({
      tsconfigPath: FIXTURE_TSCONFIG,
    });

    expect(tsconfigPath).toBe(FIXTURE_TSCONFIG);
    expect(project.getSourceFiles().length).toBeGreaterThan(0);
  });

  test("materializes the TypeChecker", () => {
    const { project } = loadProject({ tsconfigPath: FIXTURE_TSCONFIG });
    expect(project.getTypeChecker()).toBeDefined();
  });

  test("throws TsconfigNotFoundError for a missing tsconfig", () => {
    const missing = resolve(HERE, "../../test/fixtures/does-not-exist.json");
    expect(() => loadProject({ tsconfigPath: missing })).toThrow(
      TsconfigNotFoundError,
    );
    try {
      loadProject({ tsconfigPath: missing });
    } catch (err) {
      expect(err).toBeInstanceOf(TsconfigNotFoundError);
      expect((err as TsconfigNotFoundError).code).toBe("TSCONFIG_NOT_FOUND");
    }
  });

  test("walks project references in solution-style tsconfig", () => {
    const { project } = loadProject({ tsconfigPath: MONOREPO_ROOT_TSCONFIG });
    const paths = project
      .getSourceFiles()
      .filter((f) => !f.isDeclarationFile())
      .map((f) => f.getFilePath());
    expect(paths).toEqual(
      expect.arrayContaining([
        expect.stringContaining("/pkg-a/src/index.ts"),
        expect.stringContaining("/pkg-b/src/index.ts"),
      ]),
    );
  });

  test("dedupes transitively reachable references", () => {
    const { project } = loadProject({ tsconfigPath: MONOREPO_ROOT_TSCONFIG });
    const paths = project.getSourceFiles().map((f) => f.getFilePath());
    const pkgAHits = paths.filter((p) => p.endsWith("/pkg-a/src/index.ts"));
    expect(pkgAHits).toHaveLength(1);
  });

  test("resolves cross-package imports via TypeChecker", () => {
    const { project } = loadProject({ tsconfigPath: MONOREPO_ROOT_TSCONFIG });
    const pkgB = project.getSourceFileOrThrow((f) =>
      f.getFilePath().endsWith("/pkg-b/src/index.ts"),
    );
    const imp = pkgB.getImportDeclarations()[0];
    const resolved = imp?.getModuleSpecifierSourceFile();
    expect(resolved?.getFilePath()).toMatch(/pkg-a\/src\/index\.ts$/);
  });
});
