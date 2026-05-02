import { describe, expect, it } from "vitest";
import { applyExportsMap, parseExportsField } from "./exportsMap.ts";

describe("parseExportsField — shape recognition", () => {
  it("returns null for missing/null/non-object/non-string", () => {
    expect(parseExportsField(undefined)).toBeNull();
    expect(parseExportsField(null)).toBeNull();
    expect(parseExportsField(42)).toBeNull();
  });

  it("treats a top-level string as the `.` entry", () => {
    const map = parseExportsField("./dist/index.js");
    expect(map?.entries).toEqual([
      {
        subpath: ".",
        isWildcard: false,
        target: { kind: "literal", target: "./dist/index.js" },
      },
    ]);
  });

  it("treats a conditional-only object as the `.` entry", () => {
    const map = parseExportsField({
      types: "./dist/index.d.ts",
      import: "./dist/index.mjs",
      default: "./dist/index.js",
    });
    expect(map?.entries.length).toBe(1);
    const top = map?.entries[0];
    expect(top?.subpath).toBe(".");
    expect(top?.target.kind).toBe("conditional");
    if (top?.target.kind === "conditional") {
      expect(top.target.conditions.map((c) => c.key)).toEqual([
        "default",
        "import",
        "types",
      ]);
    }
  });

  it("returns null when keys mix subpath and condition forms", () => {
    expect(
      parseExportsField({
        "./client": "./dist/client.js",
        default: "./dist/index.js",
      }),
    ).toBeNull();
  });
});

describe("parseExportsField — entry sorting (determinism)", () => {
  it("orders literal subpaths longest-first, wildcards after", () => {
    const map = parseExportsField({
      "./*": "./src/*.ts",
      "./client": "./src/client.ts",
      "./client/sub": "./src/client/sub.ts",
      "./prefix/*": "./src/prefix/*.ts",
    });
    expect(map?.entries.map((e) => e.subpath)).toEqual([
      "./client/sub",
      "./client",
      "./prefix/*",
      "./*",
    ]);
  });
});

describe("applyExportsMap — literal subpaths", () => {
  it("matches `.` exactly", () => {
    const map = parseExportsField({ ".": "./src/index.ts" });
    expect(applyExportsMap(map!, ".")).toEqual({ target: "./src/index.ts" });
    expect(applyExportsMap(map!, "./missing")).toBeNull();
  });

  it("matches a literal subpath exactly, not as a prefix", () => {
    const map = parseExportsField({ "./client": "./src/client.ts" });
    expect(applyExportsMap(map!, "./client")).toEqual({
      target: "./src/client.ts",
    });
    expect(applyExportsMap(map!, "./client/sub")).toBeNull();
  });
});

describe("applyExportsMap — wildcards", () => {
  it("substitutes the captured tail into the target's `*`", () => {
    const map = parseExportsField({ "./*": "./src/*.ts" });
    expect(applyExportsMap(map!, "./foo")).toEqual({ target: "./src/foo.ts" });
    expect(applyExportsMap(map!, "./foo/bar")).toEqual({
      target: "./src/foo/bar.ts",
    });
  });

  it("requires non-empty captured segment", () => {
    const map = parseExportsField({ "./prefix/*": "./src/prefix/*.ts" });
    expect(applyExportsMap(map!, "./prefix/")).toBeNull();
    expect(applyExportsMap(map!, "./prefix/x")).toEqual({
      target: "./src/prefix/x.ts",
    });
  });

  it("prefers the longer literal match over a wildcard", () => {
    const map = parseExportsField({
      "./*": "./fallback/*.ts",
      "./special": "./src/special.ts",
    });
    expect(applyExportsMap(map!, "./special")).toEqual({
      target: "./src/special.ts",
    });
    expect(applyExportsMap(map!, "./other")).toEqual({
      target: "./fallback/other.ts",
    });
  });

  it("prefers the longer wildcard prefix when multiple wildcards match", () => {
    const map = parseExportsField({
      "./*": "./generic/*.ts",
      "./feature/*": "./feature/*.ts",
    });
    expect(applyExportsMap(map!, "./feature/x")).toEqual({
      target: "./feature/x.ts",
    });
    expect(applyExportsMap(map!, "./other")).toEqual({
      target: "./generic/other.ts",
    });
  });
});

describe("applyExportsMap — conditional resolution", () => {
  it("picks the `default` branch first when present", () => {
    const map = parseExportsField({
      "./x": {
        types: "./dist/x.d.ts",
        import: "./dist/x.mjs",
        default: "./src/x.ts",
      },
    });
    expect(applyExportsMap(map!, "./x")).toEqual({ target: "./src/x.ts" });
  });

  it("falls through to `import` when `default` is absent", () => {
    const map = parseExportsField({
      "./x": { types: "./dist/x.d.ts", import: "./src/x.ts" },
    });
    expect(applyExportsMap(map!, "./x")).toEqual({ target: "./src/x.ts" });
  });

  it("recurses into nested conditional objects", () => {
    const map = parseExportsField({
      "./x": { default: { import: "./src/x.ts", types: "./dist/x.d.ts" } },
    });
    expect(applyExportsMap(map!, "./x")).toEqual({ target: "./src/x.ts" });
  });

  it("returns null when no condition resolves to a literal", () => {
    const map = parseExportsField({
      "./x": { import: { import: 42 } },
    });
    // Entry has no resolvable target → dropped, leaving the map empty,
    // which collapses to a null return.
    expect(map).toBeNull();
  });
});
