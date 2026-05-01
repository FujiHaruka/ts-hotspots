import { describe, expect, it } from "vitest";
import { parseSource } from "../../parser/parseSource.ts";
import { extractImports } from "./extractImports.ts";

function importsOf(text: string) {
  return extractImports(parseSource("src/x.ts", text));
}

describe("extractImports", () => {
  it("recognises named imports with and without aliases", () => {
    expect(importsOf(`import { foo, bar as baz } from './m';`)).toEqual([
      {
        localName: "foo",
        remoteName: "foo",
        kind: "named",
        moduleSpecifier: "./m",
        isTypeOnly: false,
      },
      {
        localName: "baz",
        remoteName: "bar",
        kind: "named",
        moduleSpecifier: "./m",
        isTypeOnly: false,
      },
    ]);
  });

  it("recognises default imports as remoteName='default'", () => {
    expect(importsOf(`import Foo from './m';`)).toEqual([
      {
        localName: "Foo",
        remoteName: "default",
        kind: "default",
        moduleSpecifier: "./m",
        isTypeOnly: false,
      },
    ]);
  });

  it("recognises namespace imports with empty remoteName", () => {
    expect(importsOf(`import * as ns from './m';`)).toEqual([
      {
        localName: "ns",
        remoteName: "",
        kind: "namespace",
        moduleSpecifier: "./m",
        isTypeOnly: false,
      },
    ]);
  });

  it("recognises mixed default + named imports", () => {
    const result = importsOf(`import Foo, { bar } from './m';`);
    expect(result.map((b) => b.kind)).toEqual(["default", "named"]);
    expect(result.map((b) => b.localName)).toEqual(["Foo", "bar"]);
  });

  it("propagates `import type` to every binding", () => {
    const result = importsOf(`import type { Foo, Bar } from './m';`);
    expect(result.every((b) => b.isTypeOnly)).toBe(true);
  });

  it("propagates per-specifier `type` modifier", () => {
    const result = importsOf(`import { type A, B } from './m';`);
    expect(result.map((b) => [b.localName, b.isTypeOnly])).toEqual([
      ["A", true],
      ["B", false],
    ]);
  });

  it("ignores side-effect imports (`import 'm'`)", () => {
    expect(importsOf(`import './m';`)).toEqual([]);
  });
});
