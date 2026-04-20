import { Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateSourceFiles } from "./enumerate-source-files.ts";

function mkProject(files: Record<string, string>): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, content] of Object.entries(files)) {
    project.createSourceFile(path, content);
  }
  return project;
}

describe("enumerateSourceFiles", () => {
  test("returns POSIX-relative paths for project sources", () => {
    const project = mkProject({
      "/proj/src/a.ts": "export const x = 1;",
      "/proj/src/nested/b.ts": "export const y = 2;",
    });
    const files = enumerateSourceFiles(project, "/proj");
    const paths = files.map((f) => f.path).sort();
    expect(paths).toEqual(["src/a.ts", "src/nested/b.ts"]);
  });

  test("skips .d.ts files, node_modules, and files outside rootDir", () => {
    const project = mkProject({
      "/proj/src/a.ts": "export const x = 1;",
      "/proj/src/a.d.ts": "export declare const y: number;",
      "/proj/node_modules/lib/index.ts": "export const z = 3;",
      "/other/src/b.ts": "export const w = 4;",
    });
    const files = enumerateSourceFiles(project, "/proj");
    expect(files.map((f) => f.path)).toEqual(["src/a.ts"]);
  });

  test("skips non-TS extensions like package.json", () => {
    const project = mkProject({
      "/proj/src/a.ts": "export const x = 1;",
      "/proj/package.json": '{"name":"proj"}',
    });
    const files = enumerateSourceFiles(project, "/proj");
    expect(files.map((f) => f.path)).toEqual(["src/a.ts"]);
  });

  test("keeps .tsx, .mts, and .cts files", () => {
    const project = mkProject({
      "/proj/src/a.tsx": "export const x = <div />;",
      "/proj/src/b.mts": "export const y = 2;",
      "/proj/src/c.cts": "export const z = 3;",
    });
    const files = enumerateSourceFiles(project, "/proj");
    expect(files.map((f) => f.path).sort()).toEqual([
      "src/a.tsx",
      "src/b.mts",
      "src/c.cts",
    ]);
  });

  test("honors exclude globs", () => {
    const project = mkProject({
      "/proj/src/a.ts": "export const x = 1;",
      "/proj/src/a.test.ts": "export const y = 2;",
      "/proj/src/nested/b.test.ts": "export const z = 3;",
    });
    const files = enumerateSourceFiles(project, "/proj", {
      exclude: ["**/*.test.ts"],
    });
    expect(files.map((f) => f.path)).toEqual(["src/a.ts"]);
  });

  test("empty exclude keeps every file", () => {
    const project = mkProject({
      "/proj/src/a.ts": "export const x = 1;",
      "/proj/src/a.test.ts": "export const y = 2;",
    });
    const files = enumerateSourceFiles(project, "/proj", { exclude: [] });
    expect(files.map((f) => f.path).sort()).toEqual([
      "src/a.test.ts",
      "src/a.ts",
    ]);
  });

  test("SourceFileInfo.sourceFile is the actual ts-morph SourceFile", () => {
    const project = mkProject({
      "/proj/src/a.ts": "export const x = 1;",
    });
    const [info] = enumerateSourceFiles(project, "/proj");
    expect(info?.sourceFile.getFilePath()).toBe("/proj/src/a.ts");
  });
});
