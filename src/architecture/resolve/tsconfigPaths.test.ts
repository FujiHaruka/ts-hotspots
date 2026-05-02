import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseTsconfigResolution,
  readTsconfigResolution,
} from "./tsconfigPaths.ts";

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
});
