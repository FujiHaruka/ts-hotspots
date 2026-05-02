import { afterEach, describe, expect, it } from "vitest";
import {
  createTempRepo,
  type TempRepo,
} from "../../../test/dedup/e2e/helpers/tempRepo.ts";
import { type CliIO } from "../../cli/streaming.ts";
import { buildGraph } from "../graph/buildGraph.ts";
import { readTsconfigResolution } from "../resolve/tsconfigPaths.ts";
import { loadArchSources } from "./loadSources.ts";
import { main } from "./main.ts";

interface CapturedIO {
  io: CliIO;
  stdout: () => string;
  stderr: () => string;
}

function captureIO(cwd: string): CapturedIO {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const io: CliIO = {
    stdout: {
      write: (chunk: string | Uint8Array): boolean => {
        stdoutChunks.push(
          typeof chunk === "string"
            ? chunk
            : Buffer.from(chunk).toString("utf-8"),
        );
        return true;
      },
    } as NodeJS.WritableStream,
    stderr: {
      write: (chunk: string | Uint8Array): boolean => {
        stderrChunks.push(
          typeof chunk === "string"
            ? chunk
            : Buffer.from(chunk).toString("utf-8"),
        );
        return true;
      },
    } as NodeJS.WritableStream,
    cwd: () => cwd,
  };
  return {
    io,
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
  };
}

describe("architecture pipeline composition — root tsconfig.paths", () => {
  const repos: TempRepo[] = [];
  afterEach(() => {
    while (repos.length > 0) repos.pop()?.cleanup();
  });

  function newRepo(): TempRepo {
    const r = createTempRepo("ts-hotspots-arch-m1-");
    repos.push(r);
    return r;
  }

  it("resolves @/* alias edges end-to-end", async () => {
    const r = newRepo();
    r.write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
    );
    r.write("src/util.ts", "export function util() { return 1; }\n");
    r.write(
      "src/consumer.ts",
      `import { util } from "@/util";\nexport const v = () => util();\n`,
    );
    r.commit("setup");

    const sources = await loadArchSources({
      rootDir: r.path,
      ref: undefined,
      excludeGlobs: [],
    });
    const tsconfig = readTsconfigResolution(r.path);
    const graph = buildGraph({ sources, tsconfig });

    expect(
      graph.edges.find(
        (e) =>
          e.from === "src/consumer.ts::v::const" &&
          e.to === "src/util.ts::util::function",
      ),
    ).toBeDefined();
  });

  it("alias edges drop without the M1 wiring (regression guard)", async () => {
    // If `tsconfig` is not passed to buildGraph, `@/util` is treated as a
    // bare specifier and the edge is dropped. This pins the behaviour the
    // M1 wiring fixes.
    const r = newRepo();
    r.write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
    );
    r.write("src/util.ts", "export function util() { return 1; }\n");
    r.write(
      "src/consumer.ts",
      `import { util } from "@/util";\nexport const v = () => util();\n`,
    );
    r.commit("setup");

    const sources = await loadArchSources({
      rootDir: r.path,
      ref: undefined,
      excludeGlobs: [],
    });
    const graph = buildGraph({ sources });

    expect(
      graph.edges.find((e) => e.from === "src/consumer.ts::v::const"),
    ).toBeUndefined();
  });

  it("works when tsconfig.json is absent (relative imports still resolve)", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const a = 1;\n");
    r.write("src/b.ts", `import { a } from "./a";\nexport const b = a + 1;\n`);
    r.commit("setup");

    const sources = await loadArchSources({
      rootDir: r.path,
      ref: undefined,
      excludeGlobs: [],
    });
    const tsconfig = readTsconfigResolution(r.path);
    expect(tsconfig).toEqual({ baseUrl: ".", mappings: [] });
    const graph = buildGraph({ sources, tsconfig });

    expect(
      graph.edges.find(
        (e) => e.from === "src/b.ts::b::const" && e.to === "src/a.ts::a::const",
      ),
    ).toBeDefined();
  });
});

describe("architecture pipeline composition — workspace mode", () => {
  const repos: TempRepo[] = [];
  afterEach(() => {
    while (repos.length > 0) repos.pop()?.cleanup();
  });

  function newRepo(): TempRepo {
    const r = createTempRepo("ts-hotspots-arch-m2-");
    repos.push(r);
    return r;
  }

  it("connects cross-package edges for a pnpm workspace fixture", async () => {
    const r = newRepo();
    r.write(
      "pnpm-workspace.yaml",
      `packages:\n  - "packages/*"\n  - "apps/*"\n`,
    );
    r.write(
      "package.json",
      JSON.stringify({ name: "monorepo", private: true }),
    );

    r.write(
      "packages/db/package.json",
      JSON.stringify({
        name: "@scope/db",
        exports: { ".": "./src/index.ts" },
      }),
    );
    r.write(
      "packages/db/src/index.ts",
      "export function connect() { return 1; }\n",
    );

    r.write("apps/web/package.json", JSON.stringify({ name: "@scope/web" }));
    r.write(
      "apps/web/src/main.ts",
      `import { connect } from "@scope/db";\nexport const start = () => connect();\n`,
    );

    r.commit("setup");

    const cap = captureIO(r.path);
    const code = await main([r.path, "--format", "json"], cap.io);
    expect(code).toBe(0);
    expect(cap.stderr()).toContain(
      "discovered 2 workspace packages (mode: pnpm-workspace)",
    );
  });

  it("does not emit the workspace stats line on a plain repo", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const a = 1;\n");
    r.commit("setup");

    const cap = captureIO(r.path);
    const code = await main([r.path, "--format", "json"], cap.io);
    expect(code).toBe(0);
    expect(cap.stderr()).not.toContain("discovered");
  });
});

describe("architecture pipeline composition — per-package tsconfig (M3)", () => {
  const repos: TempRepo[] = [];
  afterEach(() => {
    while (repos.length > 0) repos.pop()?.cleanup();
  });

  function newRepo(): TempRepo {
    const r = createTempRepo("ts-hotspots-arch-m3-");
    repos.push(r);
    return r;
  }

  it("resolves per-package alias and respects extends through a workspace base", async () => {
    const r = newRepo();
    r.write(
      "pnpm-workspace.yaml",
      `packages:\n  - "apps/*"\n  - "tooling/*"\n`,
    );
    r.write(
      "package.json",
      JSON.stringify({ name: "monorepo", private: true }),
    );

    // Workspace-shared base config (no node_modules — relies on the
    // ParseConfigHost rewrite).
    r.write(
      "tooling/typescript/package.json",
      JSON.stringify({ name: "@scope/tsconfig" }),
    );
    r.write(
      "tooling/typescript/tsconfig.base.json",
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@base/*": ["src/*"] } },
      }),
    );

    // App that extends the shared base and adds its own alias.
    r.write("apps/web/package.json", JSON.stringify({ name: "@scope/web" }));
    r.write(
      "apps/web/tsconfig.json",
      JSON.stringify({
        extends: "@scope/tsconfig/tsconfig.base.json",
        compilerOptions: {
          baseUrl: ".",
          paths: { "~/*": ["src/*"] },
        },
      }),
    );
    r.write("apps/web/src/util.ts", "export function util() { return 1; }\n");
    r.write(
      "apps/web/src/main.ts",
      `import { util } from "~/util";\nexport const start = () => util();\n`,
    );

    r.commit("setup");

    const sources = await loadArchSources({
      rootDir: r.path,
      ref: undefined,
      excludeGlobs: [],
    });
    const packageMap = (
      await import("../workspace/buildPackageMap.ts")
    ).buildPackageMap({
      repoRoot: r.path,
      packageRoots: ["apps/web", "tooling/typescript"],
    });
    const tsconfig = readTsconfigResolution(r.path, { packageMap });
    const graph = buildGraph({
      sources,
      resolveCtx: { tsconfig, packageMap },
    });

    expect(
      graph.edges.find(
        (e) =>
          e.from === "apps/web/src/main.ts::start::const" &&
          e.to === "apps/web/src/util.ts::util::function",
      ),
    ).toBeDefined();

    // Verify the per-package tsconfig was loaded and includes the
    // inherited alias from the workspace-shared base.
    const webPkg = packageMap.byName.get("@scope/web");
    expect(webPkg?.tsconfig).not.toBeNull();
    expect(webPkg?.tsconfig?.mappings.map((m) => m.pattern)).toContain("~/*");
  });

  it("does not crash main() on an extends chain through the workspace", async () => {
    const r = newRepo();
    r.write(
      "pnpm-workspace.yaml",
      `packages:\n  - "apps/*"\n  - "tooling/*"\n`,
    );
    r.write(
      "package.json",
      JSON.stringify({ name: "monorepo", private: true }),
    );
    r.write(
      "tooling/typescript/package.json",
      JSON.stringify({ name: "@scope/tsconfig" }),
    );
    r.write(
      "tooling/typescript/tsconfig.base.json",
      JSON.stringify({ compilerOptions: { baseUrl: "." } }),
    );
    r.write("apps/web/package.json", JSON.stringify({ name: "@scope/web" }));
    r.write(
      "apps/web/tsconfig.json",
      JSON.stringify({
        extends: "@scope/tsconfig/tsconfig.base.json",
      }),
    );
    r.write("apps/web/src/x.ts", "export const x = 1;\n");
    r.commit("setup");

    const cap = captureIO(r.path);
    const code = await main([r.path, "--format", "json"], cap.io);
    expect(code).toBe(0);
  });
});

describe("architecture main — smoke", () => {
  const repos: TempRepo[] = [];
  afterEach(() => {
    while (repos.length > 0) repos.pop()?.cleanup();
  });

  function newRepo(): TempRepo {
    const r = createTempRepo("ts-hotspots-arch-m1-");
    repos.push(r);
    return r;
  }

  it("runs to completion against a tsconfig-bearing repo", async () => {
    const r = newRepo();
    r.write(
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
      }),
    );
    r.write("src/util.ts", "export function util() { return 1; }\n");
    r.write(
      "src/consumer.ts",
      `import { util } from "@/util";\nexport const v = () => util();\n`,
    );
    r.commit("setup");

    const cap = captureIO(r.path);
    const code = await main([r.path, "--format", "json"], cap.io);
    expect(code).toBe(0);
    const stderr = cap.stderr();
    expect(stderr).toMatch(/files=2/);
  });
});
