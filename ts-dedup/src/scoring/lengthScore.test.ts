import { describe, expect, it } from "vitest";
import type { Fragment } from "../domain/fragment.ts";
import { lengthScore } from "./lengthScore.ts";

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

describe("lengthScore", () => {
  it("returns 1.0 when both fragments meet the saturation length", () => {
    const a = frag("a", 1, 80);
    const b = frag("b", 1, 80);
    expect(lengthScore(a, b, 80)).toBe(1);
  });

  it("returns 1.0 when both fragments exceed the saturation length", () => {
    const a = frag("a", 1, 200);
    const b = frag("b", 1, 500);
    expect(lengthScore(a, b, 80)).toBe(1);
  });

  it("returns ~0.84 at 40 lines on the min side (sat=80)", () => {
    // log10(40)/log10(80) ≈ 0.842
    const a = frag("a", 1, 40);
    const b = frag("b", 1, 200);
    expect(lengthScore(a, b, 80)).toBeCloseTo(
      Math.log10(40) / Math.log10(80),
      6,
    );
  });

  it("scales by the shorter fragment when sides differ", () => {
    // min(5, 200) = 5 → log10(5)/log10(80) ≈ 0.368
    const a = frag("a", 1, 5);
    const b = frag("b", 1, 200);
    expect(lengthScore(a, b, 80)).toBeCloseTo(
      Math.log10(5) / Math.log10(80),
      6,
    );
  });

  it("returns 0 for a 1-line min — the saturated formula bottoms out", () => {
    const a = frag("a", 5, 5); // 1 line
    const b = frag("b", 1, 200);
    expect(lengthScore(a, b, 80)).toBe(0);
  });

  it("is symmetric in its inputs", () => {
    const a = frag("a", 1, 12);
    const b = frag("b", 1, 60);
    expect(lengthScore(a, b, 80)).toBeCloseTo(lengthScore(b, a, 80), 10);
  });

  it("treats a 0-line fragment defensively (no NaN)", () => {
    const a = frag("a", 5, 4); // contrived, 0 lines → floored to 1
    const b = frag("b", 1, 200);
    expect(lengthScore(a, b, 80)).toBe(0);
  });
});
