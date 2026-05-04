import { describe, expect, it } from "vitest";
import { parseSource } from "../../../parser/parseSource.ts";
import type { Fragment } from "../../domain/fragment.ts";
import {
  isThinWrapperFragment,
  type ThinWrapperConfig,
} from "./isThinWrapper.ts";

const cfg: ThinWrapperConfig = {
  enabled: true,
  maxPreludeStatements: 2,
  maxBodyStatements: 4,
};

interface Case {
  source: string;
  filePath?: string;
  kind?: Fragment["kind"];
  astNodeKind?: string;
  range?: { startLine: number; endLine: number };
}

function judge(input: Case, config: ThinWrapperConfig = cfg): boolean {
  const filePath = input.filePath ?? "case.tsx";
  const parsed = parseSource(filePath, input.source);
  const totalLines = input.source.split("\n").length;
  const fragment: Fragment = {
    id: "f",
    filePath,
    startLine: input.range?.startLine ?? 1,
    endLine: input.range?.endLine ?? totalLines,
    kind: input.kind ?? "function",
    text: input.source,
    astNodeKind: input.astNodeKind ?? "FunctionDeclaration",
  };
  return isThinWrapperFragment(fragment, parsed.sourceFile, config);
}

describe("isThinWrapperFragment", () => {
  it("1: single JSX self-closing return", () => {
    expect(
      judge({
        source: "function F() { return <X />; }",
      }),
    ).toBe(true);
  });

  it("2: JSX with complex props is still thin", () => {
    expect(
      judge({
        source: "function F() { return <X a={1} b={fn(2)} />; }",
      }),
    ).toBe(true);
  });

  it("3: prelude with one const = call() is thin", () => {
    expect(
      judge({
        source: 'function F() { const t = useT("k"); return <X t={t} />; }',
      }),
    ).toBe(true);
  });

  it("4: prelude of 2 const declarations is at the limit", () => {
    expect(
      judge({
        source:
          "function F() { const a = id(1); const b = id(2); return <X a={a} b={b} />; }",
      }),
    ).toBe(true);
  });

  it("5: prelude of 3 declarations exceeds the limit", () => {
    expect(
      judge({
        source:
          "function F() { const a = id(1); const b = id(2); const c = id(3); return <X />; }",
      }),
    ).toBe(false);
  });

  it("6: call expression return is thin", () => {
    expect(
      judge({
        source: "function F() { return foo(bar()); }",
      }),
    ).toBe(true);
  });

  it("7: new expression return is thin", () => {
    expect(
      judge({
        source: "function F() { return new Foo(); }",
      }),
    ).toBe(true);
  });

  it("8: two return statements is not thin", () => {
    expect(
      judge({
        source: "function F() { if (x) return <A />; return <B />; }",
      }),
    ).toBe(false);
  });

  it("9: JSX fragment with multiple children is treated as one expression", () => {
    expect(
      judge({
        source: "function F() { return <><A /><B /></>; }",
      }),
    ).toBe(true);
  });

  it("10: ExpressionStatement prelude is rejected", () => {
    expect(
      judge({
        source: "function F() { foo(); return <X />; }",
      }),
    ).toBe(false);
  });

  it("11: window with too many body statements is not thin", () => {
    const source = [
      "const a = id(1);",
      "const b = id(2);",
      "const c = id(3);",
      "const d = id(4);",
      "return <X />;",
    ].join("\n");
    expect(
      judge({
        source,
        filePath: "case.ts",
        kind: "window",
        astNodeKind: "SourceFile",
      }),
    ).toBe(false);
  });

  it("12: expression-bodied arrow has no directStatements (current behaviour)", () => {
    expect(
      judge({
        source: "const F = () => <X />;",
        astNodeKind: "ArrowFunction",
      }),
    ).toBe(false);
  });

  it("13: bare return without an expression is not thin", () => {
    expect(
      judge({
        source: "function F(): JSX.Element { return; }",
      }),
    ).toBe(false);
  });
});
