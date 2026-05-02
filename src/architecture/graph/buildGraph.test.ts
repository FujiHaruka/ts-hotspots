import { describe, expect, it } from "vitest";
import { parseTsconfigResolution } from "../resolve/tsconfigPaths.ts";
import { parseExportsField } from "../workspace/exportsMap.ts";
import type { PackageInfo, PackageMap } from "../workspace/types.ts";
import { buildGraph, type SourceInput } from "./buildGraph.ts";
import type { Edge, Graph } from "./types.ts";

function makePackageMap(...packages: PackageInfo[]): PackageMap {
  const byName = new Map<string, PackageInfo>();
  for (const p of packages) byName.set(p.name, p);
  const sorted = [...packages].sort((a, b) => b.root.length - a.root.length);
  const byFile = (file: string): PackageInfo | undefined => {
    for (const p of sorted) {
      if (file === p.root) return p;
      if (file.startsWith(`${p.root}/`)) return p;
    }
    return undefined;
  };
  return { byName, byFile, packages: [...packages] };
}

function pkg(name: string, root: string, exportsField?: unknown): PackageInfo {
  return {
    name,
    root,
    exportsMap:
      exportsField === undefined ? null : parseExportsField(exportsField),
    mainTarget: null,
    tsconfigPath: null,
    tsconfig: null,
  };
}

function build(...sources: SourceInput[]): Graph {
  return buildGraph({ sources });
}

function buildWithPaths(
  pathsConfig: Record<string, string[]>,
  ...sources: SourceInput[]
): Graph {
  return buildGraph({
    sources,
    tsconfig: parseTsconfigResolution({
      compilerOptions: { baseUrl: ".", paths: pathsConfig },
    }),
  });
}

function ids(graph: Graph): string[] {
  return graph.nodes.map((n) => n.id);
}

function edgesOf(
  graph: Graph,
  predicate?: (e: Edge) => boolean,
): Pick<Edge, "from" | "to" | "kind" | "uncertain">[] {
  return graph.edges
    .filter((e) => predicate?.(e) ?? true)
    .map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      uncertain: e.uncertain,
    }));
}

describe("buildGraph — nodes", () => {
  it("creates one component per export, sorted by id", () => {
    const g = build(
      {
        path: "src/a.ts",
        text: `export const a = 1;\nexport function fn() {}`,
      },
      { path: "src/b.ts", text: `export class C {}` },
    );
    expect(ids(g)).toEqual([
      "src/a.ts::a::const",
      "src/a.ts::fn::function",
      "src/b.ts::C::class",
    ]);
  });

  it("default-export class produces both 'default' and the named entry", () => {
    const g = build({ path: "src/a.ts", text: `export default class Foo {}` });
    expect(ids(g)).toEqual([
      "src/a.ts::Foo::class",
      "src/a.ts::default::default",
    ]);
  });
});

describe("buildGraph — edge kinds", () => {
  const importer = (body: string) => ({
    path: "src/a.ts",
    text: `import { Target } from './b';\n${body}`,
  });
  const targetClass: SourceInput = {
    path: "src/b.ts",
    text: `export class Target {}`,
  };

  it("class extends → 'extends'", () => {
    const g = build(
      importer(`export class Sub extends Target {}`),
      targetClass,
    );
    expect(edgesOf(g)).toEqual([
      {
        from: "src/a.ts::Sub::class",
        to: "src/b.ts::Target::class",
        kind: "extends",
        uncertain: false,
      },
    ]);
  });

  it("class implements → 'implements'", () => {
    const g = build(
      importer(`export class Sub implements Target {}`),
      targetClass,
    );
    expect(edgesOf(g)).toEqual([
      {
        from: "src/a.ts::Sub::class",
        to: "src/b.ts::Target::class",
        kind: "implements",
        uncertain: false,
      },
    ]);
  });

  it("`new Target()` → 'new'", () => {
    const g = build(
      importer(`export const make = () => new Target();`),
      targetClass,
    );
    expect(edgesOf(g)[0]?.kind).toBe("new");
  });

  it("plain call → 'value'", () => {
    const g = build(
      {
        path: "src/a.ts",
        text: `import { run } from './b';\nexport const start = () => run();`,
      },
      { path: "src/b.ts", text: `export function run() {}` },
    );
    expect(edgesOf(g)[0]).toEqual({
      from: "src/a.ts::start::const",
      to: "src/b.ts::run::function",
      kind: "value",
      uncertain: false,
    });
  });

  it("type annotation → 'type'", () => {
    const g = build(
      {
        path: "src/a.ts",
        text: `import { T } from './b';\nexport const v: T = 1 as T;`,
      },
      { path: "src/b.ts", text: `export type T = number;` },
    );
    expect(edgesOf(g).every((e) => e.kind === "type")).toBe(true);
  });

  it("`import type` forces 'type' even at value-position references", () => {
    const g = build(
      {
        path: "src/a.ts",
        text: `import type { Target } from './b';\nexport class Sub extends Target {}`,
      },
      targetClass,
    );
    expect(edgesOf(g)[0]?.kind).toBe("type");
  });

  it("interface extends → 'type' (not 'extends')", () => {
    const g = build(
      {
        path: "src/a.ts",
        text: `import { Base } from './b';\nexport interface Sub extends Base {}`,
      },
      { path: "src/b.ts", text: `export interface Base {}` },
    );
    expect(edgesOf(g)[0]?.kind).toBe("type");
  });
});

describe("buildGraph — namespace imports", () => {
  it("`ns.foo()` resolves to foo on the namespace's module", () => {
    const g = build(
      {
        path: "src/a.ts",
        text: `import * as m from './b';\nexport const v = () => m.foo();`,
      },
      { path: "src/b.ts", text: `export function foo() {}` },
    );
    expect(edgesOf(g)).toEqual([
      {
        from: "src/a.ts::v::const",
        to: "src/b.ts::foo::function",
        kind: "value",
        uncertain: false,
      },
    ]);
  });

  it("`ns.Foo` in type position resolves to Foo, kind 'type'", () => {
    const g = build(
      {
        path: "src/a.ts",
        text: `import * as m from './b';\nexport const v: m.Foo = null as unknown as m.Foo;`,
      },
      { path: "src/b.ts", text: `export type Foo = number;` },
    );
    expect(edgesOf(g)[0]?.kind).toBe("type");
  });
});

describe("buildGraph — barrel-normalisation", () => {
  it("named re-export forwards through to the original definition", () => {
    const g = build(
      {
        path: "src/a.ts",
        text: `import { Target } from './barrel';\nexport class Sub extends Target {}`,
      },
      { path: "src/barrel.ts", text: `export { Target } from './real';` },
      { path: "src/real.ts", text: `export class Target {}` },
    );
    // Edge points at src/real.ts::Target, NOT at src/barrel.ts.
    const e = edgesOf(g)[0];
    expect(e?.to).toBe("src/real.ts::Target::class");
    expect(e?.kind).toBe("extends");
  });

  it("renaming re-export uses the original name on the target", () => {
    const g = build(
      {
        path: "src/a.ts",
        text: `import { Renamed } from './barrel';\nexport const v = () => new Renamed();`,
      },
      {
        path: "src/barrel.ts",
        text: `export { Original as Renamed } from './real';`,
      },
      { path: "src/real.ts", text: `export class Original {}` },
    );
    expect(edgesOf(g)[0]?.to).toBe("src/real.ts::Original::class");
  });

  it("star re-export forwards by name", () => {
    const g = build(
      {
        path: "src/a.ts",
        text: `import { foo } from './barrel';\nexport const v = () => foo();`,
      },
      { path: "src/barrel.ts", text: `export * from './real';` },
      { path: "src/real.ts", text: `export function foo() {}` },
    );
    expect(edgesOf(g)[0]?.to).toBe("src/real.ts::foo::function");
  });
});

describe("buildGraph — tsconfig paths", () => {
  it("resolves `@/foo` aliases", () => {
    const g = buildWithPaths(
      { "@/*": ["src/*"] },
      {
        path: "src/a.ts",
        text: `import { run } from '@/util/run';\nexport const start = () => run();`,
      },
      { path: "src/util/run.ts", text: `export function run() {}` },
    );
    expect(edgesOf(g)[0]?.to).toBe("src/util/run.ts::run::function");
  });
});

describe("buildGraph — dynamic imports", () => {
  it("fans out a dynamic import across the resolved file", () => {
    const g = build(
      {
        path: "src/a.ts",
        text: `export const lazy = () => import('./b');`,
      },
      {
        path: "src/b.ts",
        text: `export const x = 1;\nexport function y() {}`,
      },
    );
    expect(edgesOf(g)).toEqual([
      {
        from: "src/a.ts::lazy::const",
        to: "src/b.ts::x::const",
        kind: "dynamic",
        uncertain: true,
      },
      {
        from: "src/a.ts::lazy::const",
        to: "src/b.ts::y::function",
        kind: "dynamic",
        uncertain: true,
      },
    ]);
  });

  it("ignores dynamic imports with non-literal specifiers", () => {
    const g = build({
      path: "src/a.ts",
      text: `export const lazy = (mod: string) => import(mod);`,
    });
    expect(g.edges).toEqual([]);
  });
});

describe("buildGraph — determinism", () => {
  it("input order does not affect output", () => {
    const a: SourceInput = {
      path: "src/a.ts",
      text: `import { f } from './b';\nexport const g = () => f();`,
    };
    const b: SourceInput = {
      path: "src/b.ts",
      text: `export function f() {}`,
    };
    expect(build(a, b)).toEqual(build(b, a));
  });
});

describe("buildGraph — workspace package resolution", () => {
  it("connects edges across packages via package-name imports", () => {
    const packageMap = makePackageMap(
      pkg("@scope/db", "packages/db", { ".": "./src/index.ts" }),
      pkg("@scope/web", "apps/web"),
    );
    const g = buildGraph({
      sources: [
        {
          path: "packages/db/src/index.ts",
          text: `export function connect() {}`,
        },
        {
          path: "apps/web/src/main.ts",
          text: `import { connect } from "@scope/db";\nexport const start = () => connect();`,
        },
      ],
      resolveCtx: { packageMap },
    });
    expect(
      g.edges.find(
        (e) =>
          e.from === "apps/web/src/main.ts::start::const" &&
          e.to === "packages/db/src/index.ts::connect::function",
      ),
    ).toBeDefined();
  });

  it("chases star re-exports across packages", () => {
    const packageMap = makePackageMap(
      pkg("@scope/db", "packages/db", { ".": "./src/index.ts" }),
      pkg("@scope/web", "apps/web"),
    );
    const g = buildGraph({
      sources: [
        {
          path: "packages/db/src/index.ts",
          text: `export * from "./impl";`,
        },
        {
          path: "packages/db/src/impl.ts",
          text: `export function connect() {}`,
        },
        {
          path: "apps/web/src/main.ts",
          text: `import { connect } from "@scope/db";\nexport const start = () => connect();`,
        },
      ],
      resolveCtx: { packageMap },
    });
    // Edge points to the original definition site, not the barrel.
    expect(
      g.edges.find(
        (e) =>
          e.from === "apps/web/src/main.ts::start::const" &&
          e.to === "packages/db/src/impl.ts::connect::function",
      ),
    ).toBeDefined();
  });

  it("drops edges when exports declares no matching subpath (E12)", () => {
    const packageMap = makePackageMap(
      pkg("@scope/db", "packages/db", { ".": "./src/index.ts" }),
    );
    const g = buildGraph({
      sources: [
        {
          path: "packages/db/src/index.ts",
          text: `export function connect() {}`,
        },
        {
          path: "packages/db/src/internal.ts",
          text: `export function helper() {}`,
        },
        {
          path: "apps/web/src/main.ts",
          text: `import { helper } from "@scope/db/internal";\nexport const start = () => helper();`,
        },
      ],
      resolveCtx: { packageMap },
    });
    expect(
      g.edges.find((e) => e.from === "apps/web/src/main.ts::start::const"),
    ).toBeUndefined();
  });
});

describe("buildGraph — non-resolvable specifiers", () => {
  it("drops edges to external packages silently", () => {
    const g = build({
      path: "src/a.ts",
      text: `import { useState } from 'react';\nexport const v = () => useState();`,
    });
    expect(g.edges).toEqual([]);
  });

  it("drops edges whose remote name is not exported by the resolved file", () => {
    const g = build(
      {
        path: "src/a.ts",
        text: `import { missing } from './b';\nexport const v = () => missing();`,
      },
      { path: "src/b.ts", text: `export const present = 1;` },
    );
    expect(g.edges).toEqual([]);
  });
});
