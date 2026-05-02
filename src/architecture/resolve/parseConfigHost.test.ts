import { describe, expect, it } from "vitest";
import type { PackageInfo, PackageMap } from "../workspace/types.ts";
import { rewriteWorkspaceExtends } from "./parseConfigHost.ts";

function pkg(name: string, root: string): PackageInfo {
  return {
    name,
    root,
    exportsMap: null,
    mainTarget: null,
    tsconfigPath: null,
    tsconfig: null,
  };
}

function makeMap(...packages: PackageInfo[]): PackageMap {
  const byName = new Map<string, PackageInfo>();
  for (const p of packages) byName.set(p.name, p);
  return {
    byName,
    byFile: () => undefined,
    packages: [...packages],
  };
}

describe("rewriteWorkspaceExtends", () => {
  it("rewrites a node_modules path to the workspace package root", () => {
    const map = makeMap(pkg("@scope/base", "tooling/typescript"));
    const got = rewriteWorkspaceExtends(
      "/repo/apps/web/node_modules/@scope/base/tsconfig.base.json",
      "/repo",
      map,
    );
    expect(got).toBe("/repo/tooling/typescript/tsconfig.base.json");
  });

  it("handles unscoped package names", () => {
    const map = makeMap(pkg("base", "tooling/typescript"));
    const got = rewriteWorkspaceExtends(
      "/repo/apps/web/node_modules/base/tsconfig.json",
      "/repo",
      map,
    );
    expect(got).toBe("/repo/tooling/typescript/tsconfig.json");
  });

  it("returns null when the package isn't a workspace member", () => {
    const map = makeMap(pkg("@scope/base", "tooling/typescript"));
    expect(
      rewriteWorkspaceExtends(
        "/repo/apps/web/node_modules/external/index.js",
        "/repo",
        map,
      ),
    ).toBeNull();
  });

  it("returns null when the path doesn't go through node_modules", () => {
    const map = makeMap(pkg("@scope/base", "tooling/typescript"));
    expect(
      rewriteWorkspaceExtends("/repo/apps/web/src/x.ts", "/repo", map),
    ).toBeNull();
  });

  it("uses the deepest node_modules occurrence", () => {
    // pnpm-style nested node_modules: outer node_modules contains a
    // hoisted dep, inner node_modules holds the workspace shadow.
    const map = makeMap(pkg("@scope/base", "tooling/typescript"));
    const got = rewriteWorkspaceExtends(
      "/repo/node_modules/.pnpm/foo/node_modules/@scope/base/tsconfig.json",
      "/repo",
      map,
    );
    expect(got).toBe("/repo/tooling/typescript/tsconfig.json");
  });
});
