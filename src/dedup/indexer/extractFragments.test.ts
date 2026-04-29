import { describe, expect, it } from "vitest";
import type { Config } from "../config/config.ts";
import { defaultConfig } from "../config/index.ts";
import type { Fragment } from "../domain/fragment.ts";
import { extractFragments } from "./extractFragments.ts";
import { parseSource } from "./parseSource.ts";

function extract(
  filePath: string,
  text: string,
  config: Config = defaultConfig,
): Fragment[] {
  const parsed = parseSource(filePath, text);
  return extractFragments(parsed, config);
}

describe("extractFragments", () => {
  it("extracts a function declaration as a single function fragment", () => {
    const src = `function add(a: number, b: number): number {
  return a + b;
}
`;
    const fragments = extract("file.ts", src);
    const functions = fragments.filter((f) => f.kind === "function");
    expect(functions).toHaveLength(1);
    const [fn] = functions;
    expect(fn?.astNodeKind).toBe("FunctionDeclaration");
    expect(fn?.startLine).toBe(1);
    expect(fn?.endLine).toBe(3);
    expect(fn?.filePath).toBe("file.ts");
    expect(fn?.text.startsWith("function add")).toBe(true);
    expect(fn?.text.endsWith("}")).toBe(true);
  });

  it("extracts method, arrow function and function expression as separate fragments", () => {
    const src = `class C {
  m() { return 1; }
}
const a = () => 1;
const b = function () { return 2; };
`;
    const fragments = extract("file.ts", src);
    const kinds = fragments
      .filter((f) => f.kind === "function")
      .map((f) => f.astNodeKind)
      .sort();
    expect(kinds).toEqual(
      ["ArrowFunction", "FunctionExpression", "MethodDeclaration"].sort(),
    );
  });

  it("extracts constructor, get accessor and set accessor as function fragments", () => {
    const src = `class C {
  private _x = 0;
  constructor() {}
  get x(): number { return this._x; }
  set x(v: number) { this._x = v; }
}
`;
    const fragments = extract("file.ts", src);
    const astKinds = fragments
      .filter((f) => f.kind === "function")
      .map((f) => f.astNodeKind)
      .sort();
    expect(astKinds).toEqual(
      ["Constructor", "GetAccessor", "SetAccessor"].sort(),
    );
  });

  it("skips bodyless function declarations (overloads / ambient)", () => {
    const src = `declare function foo(a: number): number;
function foo(a: number): number;
function foo(a: number): number {
  return a;
}
`;
    const fragments = extract("file.ts", src);
    const functions = fragments.filter((f) => f.kind === "function");
    // Only the implementation (with a body) should be emitted.
    expect(functions).toHaveLength(1);
  });

  it("extracts if / for / while as block fragments", () => {
    const src = `function f(xs: number[]) {
  if (xs.length > 0) {
    console.log("non-empty");
  }
  for (let i = 0; i < xs.length; i++) {
    console.log(i);
  }
  while (xs.length) {
    xs.pop();
  }
}
`;
    const fragments = extract("file.ts", src);
    const blockKinds = fragments
      .filter((f) => f.kind === "block")
      .map((f) => f.astNodeKind);
    expect(blockKinds).toContain("IfStatement");
    expect(blockKinds).toContain("ForStatement");
    expect(blockKinds).toContain("WhileStatement");
  });

  it("extracts nested for inside if as separate block fragments", () => {
    const src = `function f(xs: number[]) {
  if (xs.length > 0) {
    for (const x of xs) {
      console.log(x);
    }
  }
}
`;
    const fragments = extract("file.ts", src);
    const blocks = fragments.filter((f) => f.kind === "block");
    const astKinds = blocks.map((b) => b.astNodeKind);
    expect(astKinds).toContain("IfStatement");
    expect(astKinds).toContain("ForOfStatement");
    // Outer IfStatement must strictly enclose the inner ForOfStatement.
    const ifBlock = blocks.find((b) => b.astNodeKind === "IfStatement");
    const forBlock = blocks.find((b) => b.astNodeKind === "ForOfStatement");
    expect(ifBlock).toBeDefined();
    expect(forBlock).toBeDefined();
    if (ifBlock && forBlock) {
      expect(ifBlock.startLine).toBeLessThan(forBlock.startLine);
      expect(ifBlock.endLine).toBeGreaterThanOrEqual(forBlock.endLine);
    }
  });

  it("extracts try / catch / switch as block fragments", () => {
    const src = `function f(x: number) {
  try {
    if (x) { /* noop */ }
  } catch (e) {
    console.log(e);
  }
  switch (x) {
    case 1: { return 1; }
    default: { return 0; }
  }
}
`;
    const fragments = extract("file.ts", src);
    const astKinds = fragments
      .filter((f) => f.kind === "block")
      .map((f) => f.astNodeKind);
    expect(astKinds).toContain("TryStatement");
    expect(astKinds).toContain("CatchClause");
    expect(astKinds).toContain("SwitchStatement");
  });

  it("emits sliding statement windows sized and strided as configured", () => {
    // Generate a function with 12 top-level statements inside its body.
    const body = Array.from(
      { length: 12 },
      (_, i) => `  const v${String(i)} = ${String(i)};`,
    ).join("\n");
    const src = `function f() {\n${body}\n}\n`;
    const config: Config = {
      ...defaultConfig,
      fragment: {
        statementWindowSizes: [5],
        statementWindowStride: 3,
      },
    };
    const fragments = extract("file.ts", src, config);
    const windows = fragments.filter((f) => f.kind === "window");
    // Expected starts at size=5, stride=3, N=12:
    //   start 0 → [0..4]
    //   start 3 → [3..7]
    //   start 6 → [6..10]
    //   start 9 would be [9..13] (out of bounds) → skip
    //   tail fallback → [7..11]
    // = 4 windows.
    expect(windows).toHaveLength(4);
  });

  it("produces more windows when additional sizes are configured", () => {
    const body = Array.from(
      { length: 12 },
      (_, i) => `  const v${String(i)} = ${String(i)};`,
    ).join("\n");
    const src = `function f() {\n${body}\n}\n`;
    const singleSizeConfig: Config = {
      ...defaultConfig,
      fragment: { statementWindowSizes: [5], statementWindowStride: 3 },
    };
    const multiSizeConfig: Config = {
      ...defaultConfig,
      fragment: { statementWindowSizes: [5, 10], statementWindowStride: 3 },
    };
    const single = extract("file.ts", src, singleSizeConfig).filter(
      (f) => f.kind === "window",
    );
    const multi = extract("file.ts", src, multiSizeConfig).filter(
      (f) => f.kind === "window",
    );
    expect(multi.length).toBeGreaterThan(single.length);
  });

  it("falls back to a single whole-block window for short bodies", () => {
    const src = `function helper() {
  const a = 1;
  const b = 2;
  return a + b;
}
`;
    const fragments = extract("file.ts", src);
    const windows = fragments.filter((f) => f.kind === "window");
    // The function body has 3 statements, which is < min(5,10,20) = 5,
    // and the SourceFile has 1 statement so no SourceFile window is
    // emitted. We expect exactly 1 whole-body window for the function.
    expect(windows).toHaveLength(1);
    const [w] = windows;
    expect(w?.astNodeKind).toBe("StatementWindow");
    expect(w?.text.includes("const a = 1")).toBe(true);
    expect(w?.text.includes("return a + b")).toBe(true);
  });

  it("line ranges are 1-based and text matches the original source slice", () => {
    const src = [
      "// leading comment",
      "function greet(name: string): string {",
      "  return `hi ${name}`;",
      "}",
      "",
    ].join("\n");
    const fragments = extract("file.ts", src);
    const fn = fragments.find((f) => f.astNodeKind === "FunctionDeclaration");
    expect(fn).toBeDefined();
    if (!fn) return;
    expect(fn.startLine).toBe(2);
    expect(fn.endLine).toBe(4);
    // Reconstruct by splitting on newline; inclusive 1-based lines → 0-based slice.
    const lines = src.split("\n").slice(fn.startLine - 1, fn.endLine);
    expect(lines.join("\n")).toBe(fn.text);
  });

  it("is deterministic: two runs with same input produce identical fragments", () => {
    const src = `function f(xs: number[]) {
  if (xs.length > 0) {
    for (const x of xs) {
      console.log(x);
    }
  }
  const a = () => 1;
  const b = () => 2;
  return a() + b();
}
`;
    const a = extract("file.ts", src);
    const b = extract("file.ts", src);
    expect(a).toEqual(b);
    // Also spot-check id stability explicitly.
    expect(a.map((f) => f.id)).toEqual(b.map((f) => f.id));
  });

  it("disambiguates ids when two fragments share the same range and kind", () => {
    // Two arrow functions on the same line.
    const src = `const pair: [() => number, () => number] = [() => 1, () => 2];
`;
    const fragments = extract("file.ts", src);
    const arrows = fragments.filter(
      (f) => f.kind === "function" && f.astNodeKind === "ArrowFunction",
    );
    expect(arrows.length).toBeGreaterThanOrEqual(2);
    const ids = arrows.map((f) => f.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
    // At least one id must carry a `-2` (or higher) disambiguator.
    expect(ids.some((id) => /-\d+$/.test(id) && id.endsWith("-2"))).toBe(
      true,
    );
  });

  it("handles .tsx sources (JSX) without crashing and still extracts functions", () => {
    const src = `export function Greeting(props: { name: string }) {
  return <div>Hello {props.name}</div>;
}
`;
    const fragments = extract("Greeting.tsx", src);
    expect(
      fragments.some(
        (f) => f.kind === "function" && f.astNodeKind === "FunctionDeclaration",
      ),
    ).toBe(true);
  });

  it("does not emit windows for runs of import/export-only statements", () => {
    // Barrel-style file: nothing but re-exports. With statementWindowSizes
    // [5, 10, 20] and stride 3, the previous behavior would emit several
    // 5-statement windows here — all identical token/statement structure
    // across barrel files, dominating the false-positive list.
    const src = [
      'export { a } from "./a.ts";',
      'export type { A } from "./a.ts";',
      'export { b } from "./b.ts";',
      'export type { B } from "./b.ts";',
      'export { c } from "./c.ts";',
      'export type { C } from "./c.ts";',
      'export { d } from "./d.ts";',
      "",
    ].join("\n");
    const fragments = extract("file.ts", src);
    const windows = fragments.filter((f) => f.kind === "window");
    expect(windows).toHaveLength(0);
  });

  it("trims leading and trailing import/export edges from emitted windows", () => {
    // Mixed file: 4 imports + 4 real statements. With size=5/stride=3,
    // raw windows would touch the import block at their edges; emitted
    // windows must have those edges trimmed off so import-only text
    // never reaches the indexed fragment.
    const src = [
      'import { a } from "./a.ts";',
      'import { b } from "./b.ts";',
      'import { c } from "./c.ts";',
      'import { d } from "./d.ts";',
      "const x = 1;",
      "const y = 2;",
      "const z = 3;",
      "console.log(x, y, z);",
      "",
    ].join("\n");
    const config: Config = {
      ...defaultConfig,
      fragment: { statementWindowSizes: [5], statementWindowStride: 3 },
    };
    const fragments = extract("file.ts", src, config);
    const windows = fragments.filter((f) => f.kind === "window");
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(w.text).not.toMatch(/^\s*import\b/m);
      expect(w.text).not.toMatch(/^\s*export\s+(?:\{|type\s+\{|\*)/m);
    }
  });

  it("trims trailing import/export edges from windows that begin in real code", () => {
    // Inverse of the leading-trim case: real code at the top, imports
    // re-introduced near the bottom (legal at module scope, even if
    // unusual). Trailing import edges must be trimmed too.
    const src = [
      "const x = 1;",
      "const y = 2;",
      "const z = 3;",
      "console.log(x, y, z);",
      'import { a } from "./a.ts";',
      'import { b } from "./b.ts";',
      'import { c } from "./c.ts";',
      'import { d } from "./d.ts";',
      "",
    ].join("\n");
    const config: Config = {
      ...defaultConfig,
      fragment: { statementWindowSizes: [5], statementWindowStride: 3 },
    };
    const fragments = extract("file.ts", src, config);
    const windows = fragments.filter((f) => f.kind === "window");
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(w.text).not.toMatch(/^\s*import\b/m);
      expect(w.text).not.toMatch(/^\s*export\s+(?:\{|type\s+\{|\*)/m);
    }
  });

  it('trims a leading "use client" directive together with the imports that follow it', () => {
    // RSC-style file: directive prologue + imports + real code. Without
    // directive-aware trimming, the leading-trim loop stops at the
    // ExpressionStatement on line 1, and the import edge bleeds into
    // every emitted window.
    const src = [
      '"use client";',
      'import { a } from "./a.ts";',
      'import { b } from "./b.ts";',
      'import { c } from "./c.ts";',
      'import { d } from "./d.ts";',
      "const x = 1;",
      "const y = 2;",
      "const z = 3;",
      "console.log(x, y, z);",
      "",
    ].join("\n");
    const config: Config = {
      ...defaultConfig,
      fragment: { statementWindowSizes: [5], statementWindowStride: 3 },
    };
    const fragments = extract("file.ts", src, config);
    const windows = fragments.filter((f) => f.kind === "window");
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(w.text).not.toMatch(/^\s*"use client"/m);
      expect(w.text).not.toMatch(/^\s*import\b/m);
    }
  });

  it('trims a leading "use client" directive even when no imports follow', () => {
    // Directive + real code only: the directive itself must be trimmed
    // so the emitted window covers only the meaningful statements.
    const src = [
      '"use client";',
      "const x = 1;",
      "const y = 2;",
      "const z = 3;",
      "console.log(x, y, z);",
      "",
    ].join("\n");
    const config: Config = {
      ...defaultConfig,
      fragment: { statementWindowSizes: [5], statementWindowStride: 3 },
    };
    const fragments = extract("file.ts", src, config);
    const windows = fragments.filter((f) => f.kind === "window");
    expect(windows.length).toBeGreaterThan(0);
    for (const w of windows) {
      expect(w.text).not.toMatch(/^\s*"use client"/m);
    }
  });

  it("emits windows for statements inside case/default clauses", () => {
    // Each case clause has 3 statements; below min window size, so each
    // should produce exactly one whole-clause window.
    const src = `function f(x: number) {
  switch (x) {
    case 1: {
      const a = 1;
      const b = 2;
      return a + b;
    }
    default: {
      const c = 3;
      const d = 4;
      return c + d;
    }
  }
}
`;
    const fragments = extract("file.ts", src);
    const windows = fragments.filter((f) => f.kind === "window");
    // We expect windows from at least the two case-clause-inner Blocks.
    expect(windows.length).toBeGreaterThanOrEqual(2);
  });
});
