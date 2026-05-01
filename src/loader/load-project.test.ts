import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { loadProject } from "./load-project.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, "../../test/fixtures/sample-project");

describe("loadProject", () => {
  test("builds a ts-morph Project from explicit source paths", () => {
    const aPath = resolve(FIXTURE_DIR, "src/a.ts");
    const bPath = resolve(FIXTURE_DIR, "src/b.ts");
    const { project } = loadProject({ sourcePaths: [aPath, bPath] });

    const paths = project
      .getSourceFiles()
      .filter((f) => !f.isDeclarationFile())
      .map((f) => f.getFilePath());
    expect(paths).toEqual(expect.arrayContaining([aPath, bPath]));
  });

  test("empty sourcePaths produces an empty project", () => {
    const { project } = loadProject({ sourcePaths: [] });
    const nonDecl = project
      .getSourceFiles()
      .filter((f) => !f.isDeclarationFile());
    expect(nonDecl).toEqual([]);
  });
});
