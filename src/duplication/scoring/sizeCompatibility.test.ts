import { describe, expect, it } from "vitest";
import type { Fragment } from "../domain/fragment.ts";
import { sizeCompatibility } from "./sizeCompatibility.ts";

function frag(id: string, startLine: number, endLine: number): Fragment {
  return {
    id,
    filePath: "a.ts",
    startLine,
    endLine,
    kind: "function",
    text: "",
    astNodeKind: "FunctionDeclaration",
  };
}

describe("sizeCompatibility", () => {
  it("returns 1.0 for fragments of identical line counts", () => {
    const a = frag("a", 1, 10);
    const b = frag("b", 100, 109);
    expect(sizeCompatibility(a, b)).toBe(1);
  });

  it("returns 0.5 for a 2x size difference", () => {
    const a = frag("a", 1, 10); // 10 lines
    const b = frag("b", 1, 20); // 20 lines
    expect(sizeCompatibility(a, b)).toBe(0.5);
  });

  it("returns 0.1 for a 10x size difference", () => {
    const a = frag("a", 1, 10); // 10 lines
    const b = frag("b", 1, 100); // 100 lines
    expect(sizeCompatibility(a, b)).toBeCloseTo(0.1, 10);
  });

  it("is symmetric", () => {
    const a = frag("a", 1, 10);
    const b = frag("b", 1, 30);
    expect(sizeCompatibility(a, b)).toBe(sizeCompatibility(b, a));
  });

  it("treats a 0-line fragment defensively (no NaN)", () => {
    // Contrived: startLine > endLine. Defensive floor to 1 line keeps the
    // ratio finite.
    const a = frag("a", 5, 4);
    const b = frag("b", 1, 1);
    expect(sizeCompatibility(a, b)).toBe(1);
  });
});
