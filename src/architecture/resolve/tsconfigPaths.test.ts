import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPackageMap } from "../workspace/buildPackageMap.ts";
import {
  parseTsconfigResolution,
  readTsconfigResolution,
} from "./tsconfigPaths.ts";

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value), "utf8");
}

function writePackageJson(
  root: string,
  rel: string,
  body: Record<string, unknown>,
): void {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "package.json"), body);
}

describe("parseTsconfigResolution", () => {
  it("falls back to baseUrl='.' when not set", () => {
    expect(parseTsconfigResolution({})).toEqual({
      baseUrl: ".",
      mappings: [],
    });
  });

  it("normalizes baseUrl by stripping trailing slashes", () => {
    expect(
      parseTsconfigResolution({ compilerOptions: { baseUrl: "src/" } }).baseUrl,
    ).toBe("src");
  });

  it("returns mappings sorted by pattern length (longest first)", () => {
    const result = parseTsconfigResolution({
      compilerOptions: {
        paths: {
          "@/*": ["src/*"],
          "@/feature/*": ["src/feature-impl/*"],
          app: ["src/app/index.ts"],
        },
      },
    });
    expect(result.mappings.map((m) => m.pattern)).toEqual([
      "@/feature/*",
      "@/*",
      "app",
    ]);
  });

  it("ignores mappings whose targets array is empty or non-string", () => {
    const result = parseTsconfigResolution({
      compilerOptions: {
        paths: {
          "ok/*": ["src/*"],
          "skip-empty/*": [],
          // biome-ignore lint/suspicious/noExplicitAny: malformed input fixture
          "skip-nonstring/*": [123 as unknown as string],
          // biome-ignore lint/suspicious/noExplicitAny: malformed input fixture
          "skip-nonarray/*": "src/*" as unknown as string[],
        },
      },
    });
    expect(result.mappings.map((m) => m.pattern)).toEqual(["ok/*"]);
  });

  it("collapses missing compilerOptions to the empty resolution", () => {
    expect(parseTsconfigResolution({})).toEqual({
      baseUrl: ".",
      mappings: [],
    });
  });
});

describe("readTsconfigResolution", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ts-hotspots-tsconfig-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the empty resolution when tsconfig.json is absent", () => {
    expect(readTsconfigResolution(dir)).toEqual({
      baseUrl: ".",
      mappings: [],
    });
  });

  it("reads baseUrl + paths from tsconfig.json", () => {
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
    );
    const got = readTsconfigResolution(dir);
    expect(got.baseUrl).toBe(".");
    expect(got.mappings.map((m) => m.pattern)).toEqual(["@/*"]);
  });

  it("collapses to empty resolution when tsconfig.json is invalid JSON", () => {
    writeFileSync(join(dir, "tsconfig.json"), "{ not json");
    expect(readTsconfigResolution(dir)).toEqual({
      baseUrl: ".",
      mappings: [],
    });
  });

  it("strips JSON-with-comments via the TS API", () => {
    writeFileSync(
      join(dir, "tsconfig.json"),
      `// header comment\n{\n  /* block */\n  "compilerOptions": {\n    "baseUrl": ".",\n    "paths": { "@/*": ["src/*"] }\n  }\n}\n`,
    );
    const got = readTsconfigResolution(dir);
    expect(got.mappings.map((m) => m.pattern)).toEqual(["@/*"]);
  });

  it("follows extends chains via TS API (relative)", () => {
    writeJson(join(dir, "tsconfig.base.json"), {
      compilerOptions: { baseUrl: ".", paths: { "@base/*": ["src/base/*"] } },
    });
    writeJson(join(dir, "tsconfig.json"), {
      extends: "./tsconfig.base.json",
      compilerOptions: { paths: { "@app/*": ["src/app/*"] } },
    });
    const got = readTsconfigResolution(dir);
    // Child paths fully replace parent paths per TS spec — wholesale
    // override, not merge.
    expect(got.mappings.map((m) => m.pattern)).toEqual(["@app/*"]);
  });

  it("follows extends chains: parent paths win when child has none", () => {
    writeJson(join(dir, "tsconfig.base.json"), {
      compilerOptions: { baseUrl: ".", paths: { "@base/*": ["src/base/*"] } },
    });
    writeJson(join(dir, "tsconfig.json"), {
      extends: "./tsconfig.base.json",
      compilerOptions: {},
    });
    const got = readTsconfigResolution(dir);
    expect(got.mappings.map((m) => m.pattern)).toEqual(["@base/*"]);
  });

  it("rewrites workspace-package extends via the package map (no node_modules required)", () => {
    // Workspace base config under tooling/typescript, consumer under apps/web.
    writeJson(join(dir, "tooling/typescript/tsconfig.base.json"), {
      compilerOptions: { baseUrl: ".", paths: { "@base/*": ["src/base/*"] } },
    });
    writeJson(join(dir, "apps/web/tsconfig.json"), {
      extends: "@scope/tsconfig/tsconfig.base.json",
    });
    writePackageJson(dir, "tooling/typescript", { name: "@scope/tsconfig" });
    writePackageJson(dir, "apps/web", { name: "@scope/web" });

    const map = buildPackageMap({
      repoRoot: dir,
      packageRoots: ["apps/web", "tooling/typescript"],
    });
    const got = readTsconfigResolution(dir, {
      tsconfigPath: join(dir, "apps/web/tsconfig.json"),
      packageMap: map,
    });
    expect(got.mappings.map((m) => m.pattern)).toEqual(["@base/*"]);
  });
});
