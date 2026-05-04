import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/defaults.ts";
import { collectChangedFragments } from "./pipeline.ts";

describe("collectChangedFragments (pipeline)", () => {
  const tempRepos: string[] = [];

  afterEach(() => {
    while (tempRepos.length > 0) {
      const p = tempRepos.pop();
      if (p !== undefined) {
        rmSync(p, { recursive: true, force: true });
      }
    }
  });

  it("wires collectDiff + extractChangedFragments end-to-end", async () => {
    const repo = mkdtempSync(join(tmpdir(), "ts-dedup-m5-pipe-"));
    tempRepos.push(repo);
    const git = (...args: string[]): string =>
      execFileSync("git", ["-C", repo, ...args], { encoding: "utf-8" });
    git("init", "-q", "-b", "main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    git("config", "commit.gpgsign", "false");

    const write = (rel: string, content: string): void => {
      const full = join(repo, rel);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, "utf-8");
    };

    write(
      "src/a.ts",
      `export function add(a: number, b: number): number {
  return a + b;
}
`,
    );
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    const baseSha = git("rev-parse", "HEAD").trim();

    write(
      "src/a.ts",
      `export function add(a: number, b: number): number {
  const sum = a + b;
  return sum;
}
`,
    );
    git("add", "-A");
    git("commit", "-q", "-m", "head");
    const headSha = git("rev-parse", "HEAD").trim();

    const result = await collectChangedFragments({
      repoPath: repo,
      baseRef: baseSha,
      headRef: headSha,
      threeDot: false,
      config: defaultConfig,
    });

    expect(result.baseSha).toBe(baseSha);
    expect(result.headSha).toBe(headSha);
    expect(result.files.map((f) => f.filePath)).toEqual(["src/a.ts"]);
    const frags = result.fragmentsByFile.get("src/a.ts");
    expect(frags).toBeDefined();
    // The enclosing function must appear as a changed fragment.
    const hasFn = frags?.some(
      (f) => f.kind === "function" && f.astNodeKind === "FunctionDeclaration",
    );
    expect(hasFn).toBe(true);
  });
});
