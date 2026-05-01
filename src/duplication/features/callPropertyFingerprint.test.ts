import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { Fragment } from "../domain/fragment.ts";
import { extractFragments } from "../indexer/extractFragments.ts";
import { parseSource } from "../indexer/parseSource.ts";
import { buildCallPropertyFingerprints } from "./callPropertyFingerprint.ts";

function firstFunction(
  src: string,
  filePath = "a.ts",
): {
  fragment: Fragment;
  sourceFile: ReturnType<typeof parseSource>["sourceFile"];
} {
  const parsed = parseSource(filePath, src);
  const fragments = extractFragments(parsed, defaultConfig);
  const fn = fragments.find((f) => f.kind === "function");
  if (fn === undefined) {
    throw new Error("no function fragment");
  }
  return { fragment: fn, sourceFile: parsed.sourceFile };
}

describe("buildCallPropertyFingerprints", () => {
  it("plain call: findById(x) emits CALL:findById", () => {
    const src = `function f(x: string) {
  findById(x);
}`;
    const { fragment, sourceFile } = firstFunction(src);
    const keys = buildCallPropertyFingerprints(fragment, sourceFile);
    expect(keys).toContain("call:CALL:findById");
  });

  it("awaited method call: await client.get() emits AWAIT_CALL:client.get", () => {
    const src = `async function f() {
  await client.get();
}`;
    const { fragment, sourceFile } = firstFunction(src);
    const keys = buildCallPropertyFingerprints(fragment, sourceFile);
    expect(keys).toContain("call:AWAIT_CALL:client.get");
  });

  it("property read: response.status emits PROP:response.status", () => {
    const src = `function f(response: { status: number }) {
  const s = response.status;
  return s;
}`;
    const { fragment, sourceFile } = firstFunction(src);
    const keys = buildCallPropertyFingerprints(fragment, sourceFile);
    expect(keys).toContain("call:PROP:response.status");
  });

  it("new expression emits NEW:UserRepo", () => {
    const src = `function f() {
  const r = new UserRepo();
  return r;
}`;
    const { fragment, sourceFile } = firstFunction(src);
    const keys = buildCallPropertyFingerprints(fragment, sourceFile);
    expect(keys).toContain("call:NEW:UserRepo");
  });

  it("chain a.b.c() collapses to CALL:a.c", () => {
    const src = `function f(a: { b: { c: () => void } }) {
  a.b.c();
}`;
    const { fragment, sourceFile } = firstFunction(src);
    const keys = buildCallPropertyFingerprints(fragment, sourceFile);
    expect(keys).toContain("call:CALL:a.c");
  });

  it("this.foo() keeps `this` literally", () => {
    const src = `class C {
  foo() {}
  bar() {
    this.foo();
  }
}`;
    const parsed = parseSource("a.ts", src);
    const fragments = extractFragments(parsed, defaultConfig);
    const bar = fragments.find(
      (f) =>
        f.kind === "function" &&
        f.astNodeKind === "MethodDeclaration" &&
        f.text.includes("this.foo()"),
    );
    if (bar === undefined) throw new Error("no bar");
    const keys = buildCallPropertyFingerprints(bar, parsed.sourceFile);
    expect(keys).toContain("call:CALL:this.foo");
  });

  it('element access with string key: obj["key"] → PROP:obj.key', () => {
    const src = `function f(obj: Record<string, string>) {
  const v = obj["key"];
  return v;
}`;
    const { fragment, sourceFile } = firstFunction(src);
    const keys = buildCallPropertyFingerprints(fragment, sourceFile);
    expect(keys).toContain("call:PROP:obj.key");
  });

  it("element access with non-string key: obj[i] → PROP:obj.*", () => {
    const src = `function f(obj: string[], i: number) {
  const v = obj[i];
  return v;
}`;
    const { fragment, sourceFile } = firstFunction(src);
    const keys = buildCallPropertyFingerprints(fragment, sourceFile);
    expect(keys).toContain("call:PROP:obj.*");
  });

  it("does not emit a PROP key for the callee of a method call", () => {
    const src = `function f(client: { get: () => void }) {
  client.get();
}`;
    const { fragment, sourceFile } = firstFunction(src);
    const keys = buildCallPropertyFingerprints(fragment, sourceFile);
    // CALL:client.get yes; PROP:client.get must NOT appear.
    expect(keys).toContain("call:CALL:client.get");
    expect(keys).not.toContain("call:PROP:client.get");
  });
});
