import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { loadProject } from "./load-project.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, "../../test/fixtures/sample-project");

describe("loadProject", () => {
  test("parses each source from disk and returns a SourceFileInfo per file", () => {
    const aPath = resolve(FIXTURE_DIR, "src/a.ts");
    const bPath = resolve(FIXTURE_DIR, "src/b.ts");
    const { files } = loadProject({
      sources: [
        { absolute: aPath, relative: "src/a.ts" },
        { absolute: bPath, relative: "src/b.ts" },
      ],
    });

    expect(files.map((f) => f.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(files.every((f) => f.sourceFile.statements.length > 0)).toBe(true);
  });

  test("empty sources yields empty files", () => {
    const { files } = loadProject({ sources: [] });
    expect(files).toEqual([]);
  });

  test("sources that fail to read are silently skipped", () => {
    const aPath = resolve(FIXTURE_DIR, "src/a.ts");
    const missing = resolve(FIXTURE_DIR, "src/does-not-exist.ts");
    const { files } = loadProject({
      sources: [
        { absolute: missing, relative: "src/does-not-exist.ts" },
        { absolute: aPath, relative: "src/a.ts" },
      ],
    });
    expect(files.map((f) => f.path)).toEqual(["src/a.ts"]);
  });
});
