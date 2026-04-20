import { type FunctionDeclaration, Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import {
  computeUnsafeCastCount,
  unsafeCastCountCollector,
} from "./unsafe-cast-count.ts";

function parseFnWithProject(src: string): {
  fn: FunctionDeclaration;
  project: Project;
} {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("/proj/t.ts", src);
  const fn = sf.getFunctions()[0];
  if (!fn) throw new Error("no function in source");
  return { fn, project };
}

describe("computeUnsafeCastCount", () => {
  test("empty function → 0", () => {
    const { fn, project } = parseFnWithProject("function f(){}");
    expect(computeUnsafeCastCount(fn, project)).toBe(0);
  });

  test("`n as string` where n is number → 1 (unrelated types)", () => {
    const { fn, project } = parseFnWithProject(
      "function f(n: number){ return n as string; }",
    );
    expect(computeUnsafeCastCount(fn, project)).toBe(1);
  });

  test("`({a:1} as {b:number})` → 1 (structurally incompatible shapes)", () => {
    const { fn, project } = parseFnWithProject(
      "function f(){ return ({ a: 1 } as { b: number }); }",
    );
    expect(computeUnsafeCastCount(fn, project)).toBe(1);
  });

  test("`n as unknown` → 0 (widening: number assignable to unknown)", () => {
    const { fn, project } = parseFnWithProject(
      "function f(n: number){ return n as unknown; }",
    );
    expect(computeUnsafeCastCount(fn, project)).toBe(0);
  });

  test("`n as any` → 0 (any is bi-directionally assignable)", () => {
    const { fn, project } = parseFnWithProject(
      "function f(n: number){ return n as any; }",
    );
    expect(computeUnsafeCastCount(fn, project)).toBe(0);
  });

  test("`n as unknown as string` → 0 (each leg has one assignable direction)", () => {
    // from=number to=unknown: number→unknown holds → safe.
    // from=unknown to=string: string→unknown holds → safe.
    // Neither leg is flagged even though the overall chain escapes the type system.
    const { fn, project } = parseFnWithProject(
      "function f(n: number){ return n as unknown as string; }",
    );
    expect(computeUnsafeCastCount(fn, project)).toBe(0);
  });

  test("`n as unknown as {foo:string}` → 0 (same reason; object→unknown holds)", () => {
    const { fn, project } = parseFnWithProject(
      "function f(n: number){ return n as unknown as { foo: string }; }",
    );
    expect(computeUnsafeCastCount(fn, project)).toBe(0);
  });

  test("narrowing: `x as number` where x: number|string → 0 (number assignable to number|string)", () => {
    const { fn, project } = parseFnWithProject(
      "function f(x: number | string){ return x as number; }",
    );
    expect(computeUnsafeCastCount(fn, project)).toBe(0);
  });

  test("`{} as Record<string, number>` → 0 (empty-literal idiom excluded)", () => {
    const { fn, project } = parseFnWithProject(
      "function f(){ return {} as Record<string, number>; }",
    );
    expect(computeUnsafeCastCount(fn, project)).toBe(0);
  });

  test("`[] as number[]` → 0 (empty-literal idiom excluded)", () => {
    const { fn, project } = parseFnWithProject(
      "function f(){ return [] as number[]; }",
    );
    expect(computeUnsafeCastCount(fn, project)).toBe(0);
  });

  test("`{ foo: 1 } as Foo` → still counted (non-empty object literal not excluded)", () => {
    const { fn, project } = parseFnWithProject(
      [
        "interface Foo { foo: number; bar: string }",
        "function f(){ return { foo: 1 } as Foo; }",
      ].join("\n"),
    );
    expect(computeUnsafeCastCount(fn, project)).toBe(1);
  });

  test('`"x" as unknown as number` → 0 via base safety logic, not via empty-literal guard', () => {
    // Regression guard: two-step casts must NOT be short-circuited by the
    // empty-literal idiom exclusion. The count here is 0 only because each leg
    // individually has an assignable direction (same as `n as unknown as string`
    // above), not because the LHS is an empty literal.
    const { fn, project } = parseFnWithProject(
      'function f(){ return "x" as unknown as number; }',
    );
    expect(computeUnsafeCastCount(fn, project)).toBe(0);
  });

  test("`as const` excluded entirely", () => {
    const { fn, project } = parseFnWithProject(
      "function f(){ return [1, 2, 3] as const; }",
    );
    expect(computeUnsafeCastCount(fn, project)).toBe(0);
  });

  test("angle-bracket assertions are treated the same way", () => {
    // <string>n where n is number: unrelated → unsafe.
    const { fn, project } = parseFnWithProject(
      "function f(n: number){ return <string>n; }",
    );
    expect(computeUnsafeCastCount(fn, project)).toBe(1);
  });

  test("multiple unsafe casts add up", () => {
    const { fn, project } = parseFnWithProject(
      [
        "function f(n: number){",
        "  const a = n as string;",
        "  const b = ({ x: 1 } as { y: number });",
        "  const c = n as unknown;", // safe
        "  return [a, b, c];",
        "}",
      ].join("\n"),
    );
    expect(computeUnsafeCastCount(fn, project)).toBe(2);
  });

  test("nested function's unsafe cast doesn't bleed into outer", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "function outer(n: number){",
        "  function inner(m: number){ return m as string; }",
        "  return inner(n);",
        "}",
      ].join("\n"),
    );
    const outer = sf.getFunctionOrThrow("outer");
    const inner = outer.getFunctions()[0];
    if (!inner) throw new Error("inner not found");
    expect(computeUnsafeCastCount(outer, project)).toBe(0);
    expect(computeUnsafeCastCount(inner, project)).toBe(1);
  });
});

describe("unsafeCastCountCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function safe(n: number){ return n as unknown; }",
        "export function unsafe(n: number){ return n as string; }",
        "export function mixed(n: number){ const a = n as string; const b = n as unknown; return [a, b]; }",
        "export function constOnly(){ return [1, 2] as const; }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = unsafeCastCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("safe")?.unsafeCastCount).toBe(0);
    expect(byName.get("unsafe")?.unsafeCastCount).toBe(1);
    expect(byName.get("mixed")?.unsafeCastCount).toBe(1);
    expect(byName.get("constOnly")?.unsafeCastCount).toBe(0);
  });

  test("does not double-count with type-assertion-count (independent metrics)", async () => {
    const { typeAssertionCountCollector } = await import(
      "./type-assertion-count.ts"
    );
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      // 2 assertions total (one safe `as unknown`, one unsafe `as string`);
      // as-const assertion excluded from both.
      [
        "export function f(n: number){",
        "  const a = n as unknown;",
        "  const b = n as string;",
        "  const c = [1, 2] as const;",
        "  return [a, b, c];",
        "}",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const ta = typeAssertionCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });
    const uc = unsafeCastCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });
    const decl = declarations.find((d) => d.name === "f");
    if (!decl) throw new Error("decl missing");
    expect(ta.get(decl.id)?.typeAssertionCount).toBe(2);
    expect(uc.get(decl.id)?.unsafeCastCount).toBe(1);
  });
});
