import { describe, expect, it } from "vitest";
import type { Component, Edge, Graph } from "../graph/types.ts";
import { collectTypeOnlyNodeIds } from "./typeOnlyNodes.ts";

function comp(
  filePath: string,
  exportName: string,
  exportKind: Component["exportKind"],
): Component {
  return {
    id: `${filePath}::${exportName}::${exportKind}`,
    filePath,
    exportName,
    exportKind,
    line: 1,
  };
}

function edge(from: string, to: string, kind: Edge["kind"]): Edge {
  return { from, to, kind, uncertain: false };
}

function graphOf(nodes: Component[], edges: Edge[]): Graph {
  return { nodes, edges };
}

describe("collectTypeOnlyNodeIds", () => {
  it("includes a pure interface whose every incident edge is type-only", () => {
    const iface = comp("src/a.ts", "Foo", "interface");
    const consumer = comp("src/b.ts", "Bar", "type");
    const g = graphOf([iface, consumer], [edge(consumer.id, iface.id, "type")]);
    expect([...collectTypeOnlyNodeIds(g)]).toEqual([iface.id, consumer.id]);
  });

  it("excludes an interface that has any runtime incident edge", () => {
    // A class extending an interface produces an `extends` (runtime) edge
    // — the interface is structurally load-bearing at runtime via the
    // class's vtable layout.
    const iface = comp("src/a.ts", "Foo", "interface");
    const cls = comp("src/b.ts", "Impl", "class");
    const g = graphOf([iface, cls], [edge(cls.id, iface.id, "extends")]);
    expect([...collectTypeOnlyNodeIds(g)]).toEqual([]);
  });

  it("excludes runtime export kinds even when their incident edges are all type-only", () => {
    // A class whose every consumer happens to use it only as a type today
    // is still runtime-load-bearing — don't drop it.
    const cls = comp("src/a.ts", "Impl", "class");
    const consumer = comp("src/b.ts", "Bar", "type");
    const g = graphOf([cls, consumer], [edge(consumer.id, cls.id, "type")]);
    expect([...collectTypeOnlyNodeIds(g)]).toEqual([consumer.id]);
  });

  it("excludes enums (runtime objects) even with only type edges", () => {
    const en = comp("src/a.ts", "Color", "enum");
    const consumer = comp("src/b.ts", "Bar", "type");
    const g = graphOf([en, consumer], [edge(consumer.id, en.id, "type")]);
    expect([...collectTypeOnlyNodeIds(g)]).toEqual([consumer.id]);
  });

  it("excludes default exports (treated as runtime)", () => {
    const def = comp("src/a.ts", "default", "default");
    const consumer = comp("src/b.ts", "Bar", "type");
    const g = graphOf([def, consumer], [edge(consumer.id, def.id, "type")]);
    expect([...collectTypeOnlyNodeIds(g)]).toEqual([consumer.id]);
  });

  it("includes a type alias with no edges at all", () => {
    const t = comp("src/a.ts", "Foo", "type");
    const g = graphOf([t], []);
    expect([...collectTypeOnlyNodeIds(g)]).toEqual([t.id]);
  });

  it("returns an empty set on an empty graph", () => {
    expect(collectTypeOnlyNodeIds(graphOf([], [])).size).toBe(0);
  });

  it("checks both edge directions — outgoing runtime edge also disqualifies", () => {
    // Hypothetical: an interface whose declaration somehow holds a
    // runtime outgoing edge (e.g. decorator metadata). Either direction
    // counts as runtime-load-bearing.
    const iface = comp("src/a.ts", "Foo", "interface");
    const target = comp("src/b.ts", "Bar", "class");
    const g = graphOf([iface, target], [edge(iface.id, target.id, "value")]);
    expect([...collectTypeOnlyNodeIds(g)]).toEqual([]);
  });
});
