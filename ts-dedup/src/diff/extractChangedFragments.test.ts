import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { ChangedFile } from "../domain/index.ts";
import { extractChangedFragments } from "./extractChangedFragments.ts";

function makeFile(
  text: string,
  hunks: { startLine: number; endLine: number }[],
  filePath = "src/a.ts",
): ChangedFile {
  return {
    filePath,
    baseSha: "0".repeat(40),
    headSha: "1".repeat(40),
    text,
    hunks,
  };
}

describe("extractChangedFragments", () => {
  it("returns the enclosing function when the whole function is changed", () => {
    const text = `export function add(a: number, b: number): number {
  return a + b;
}
`;
    // Hunk covers the entire function (lines 1..3).
    const file = makeFile(text, [{ startLine: 1, endLine: 3 }]);
    const frags = extractChangedFragments(file, defaultConfig);
    const fns = frags.filter((f) => f.kind === "function");
    expect(fns.length).toBeGreaterThanOrEqual(1);
    const match = fns.find((f) => f.astNodeKind === "FunctionDeclaration");
    expect(match).toBeDefined();
    expect(match?.startLine).toBe(1);
    expect(match?.endLine).toBe(3);
  });

  it("returns function + containing block + surrounding window for a single-line change inside a function", () => {
    const text = `export function f(xs: number[]) {
  if (xs.length > 0) {
    console.log("non-empty");
    console.log("second");
    console.log("third");
    console.log("fourth");
    console.log("fifth");
  }
  return xs.length;
}
`;
    // Change the `console.log("third");` line (line 5).
    const file = makeFile(text, [{ startLine: 5, endLine: 5 }]);
    const frags = extractChangedFragments(file, defaultConfig);
    // Function and IfStatement (block) must both be present.
    const kinds = new Set(frags.map((f) => `${f.kind}:${f.astNodeKind}`));
    expect(
      [...kinds].some((k) => k.startsWith("function:FunctionDeclaration")),
    ).toBe(true);
    expect([...kinds].some((k) => k === "block:IfStatement")).toBe(true);
    // At least one window should enclose line 5.
    const windowHit = frags.some(
      (f) => f.kind === "window" && f.startLine <= 5 && f.endLine >= 5,
    );
    expect(windowHit).toBe(true);
  });

  it("returns the same enclosing function once even when multiple hunks land inside it", () => {
    const text = `export function bigFn() {
  const a = 1;
  const b = 2;
  const c = 3;
  const d = 4;
  const e = 5;
  return a + b + c + d + e;
}
`;
    // Two hunks inside the same function.
    const file = makeFile(text, [
      { startLine: 2, endLine: 2 },
      { startLine: 6, endLine: 6 },
    ]);
    const frags = extractChangedFragments(file, defaultConfig);
    const fns = frags.filter(
      (f) => f.kind === "function" && f.astNodeKind === "FunctionDeclaration",
    );
    // M1 emits the function fragment exactly once regardless of hunk count.
    expect(fns).toHaveLength(1);
  });
});
