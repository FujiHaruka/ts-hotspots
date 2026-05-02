import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { joinRelativeToPackage, readPackage } from "./readPackage.ts";

function writePackageJson(
  root: string,
  rel: string,
  body: Record<string, unknown>,
): void {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(body), "utf8");
}

describe("joinRelativeToPackage", () => {
  it("joins package-relative target to repo-relative POSIX path", () => {
    expect(joinRelativeToPackage("packages/foo", "./src/x.ts")).toBe(
      "packages/foo/src/x.ts",
    );
    expect(joinRelativeToPackage("packages/foo", "src/x.ts")).toBe(
      "packages/foo/src/x.ts",
    );
  });

  it("rejects targets that escape the package root", () => {
    expect(joinRelativeToPackage("packages/foo", "../shared/x.ts")).toBeNull();
    expect(joinRelativeToPackage("packages/foo", "..")).toBeNull();
    expect(joinRelativeToPackage("packages/foo", "")).toBeNull();
    expect(joinRelativeToPackage("packages/foo", ".")).toBeNull();
  });

  it("treats package roots `.` / `''` as the repo root", () => {
    expect(joinRelativeToPackage(".", "./src/x.ts")).toBe("src/x.ts");
    expect(joinRelativeToPackage("", "./src/x.ts")).toBe("src/x.ts");
  });
});

describe("readPackage", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ts-hotspots-readpkg-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when package.json is missing", () => {
    mkdirSync(join(dir, "packages/foo"), { recursive: true });
    expect(readPackage(dir, "packages/foo")).toBeNull();
  });

  it("returns null when package.json has no name", () => {
    writePackageJson(dir, "packages/foo", { version: "1.0.0" });
    expect(readPackage(dir, "packages/foo")).toBeNull();
  });

  it("extracts name, exports, main, and tsconfigPath", () => {
    writePackageJson(dir, "packages/foo", {
      name: "@scope/foo",
      main: "./dist/index.js",
      exports: { "./client": "./src/client.ts" },
    });
    writeFileSync(
      join(dir, "packages/foo/tsconfig.json"),
      JSON.stringify({ compilerOptions: {} }),
    );

    const info = readPackage(dir, "packages/foo");
    expect(info?.name).toBe("@scope/foo");
    expect(info?.root).toBe("packages/foo");
    expect(info?.mainTarget).toBe("packages/foo/dist/index.js");
    expect(info?.tsconfigPath).toBe("packages/foo/tsconfig.json");
    expect(info?.exportsMap?.entries).toEqual([
      {
        subpath: "./client",
        isWildcard: false,
        target: { kind: "literal", target: "./src/client.ts" },
      },
    ]);
  });

  it("leaves tsconfigPath null when none exists", () => {
    writePackageJson(dir, "packages/foo", { name: "@scope/foo" });
    expect(readPackage(dir, "packages/foo")?.tsconfigPath).toBeNull();
  });

  it("collapses to null on invalid JSON", () => {
    mkdirSync(join(dir, "packages/foo"), { recursive: true });
    writeFileSync(join(dir, "packages/foo/package.json"), "{ broken");
    expect(readPackage(dir, "packages/foo")).toBeNull();
  });
});
