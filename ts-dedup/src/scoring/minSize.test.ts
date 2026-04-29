import { describe, expect, it } from "vitest";
import type { Fragment } from "../domain/fragment.ts";
import { meetsMinSize } from "./minSize.ts";

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

describe("meetsMinSize", () => {
  it("returns true when both fragments meet the floor", () => {
    expect(meetsMinSize(frag("a", 1, 5), frag("b", 1, 10), 5)).toBe(true);
  });

  it("returns false when the smaller side is below the floor", () => {
    expect(meetsMinSize(frag("a", 1, 4), frag("b", 1, 50), 5)).toBe(false);
  });

  it("is symmetric", () => {
    const a = frag("a", 1, 3);
    const b = frag("b", 1, 50);
    expect(meetsMinSize(a, b, 5)).toBe(meetsMinSize(b, a, 5));
  });

  it("treats minLines<=0 as off (always passes)", () => {
    expect(meetsMinSize(frag("a", 1, 1), frag("b", 1, 1), 0)).toBe(true);
    expect(meetsMinSize(frag("a", 1, 1), frag("b", 1, 1), -3)).toBe(true);
  });

  it("uses inclusive line count: a 5-line fragment passes minLines=5", () => {
    expect(meetsMinSize(frag("a", 10, 14), frag("b", 1, 100), 5)).toBe(true);
  });
});
