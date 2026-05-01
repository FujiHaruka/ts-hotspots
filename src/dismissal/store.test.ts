import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  addEntry,
  loadRegistry,
  pruneRegistry,
  registryIdSet,
  registryPath,
  removeEntry,
  saveRegistry,
  withProjectPath,
} from "./store.ts";
import {
  DISMISSAL_REGISTRY_VERSION,
  type DismissalEntry,
  emptyRegistry,
} from "./types.ts";

let tmpRoot: string;
let tmpXdg: string;
let savedXdg: string | undefined;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "ts-hotspots-store-"));
  tmpXdg = mkdtempSync(join(tmpdir(), "ts-hotspots-xdg-"));
  savedXdg = process.env.XDG_CONFIG_HOME;
  process.env.XDG_CONFIG_HOME = tmpXdg;
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
  rmSync(tmpXdg, { recursive: true, force: true });
  if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
  else process.env.XDG_CONFIG_HOME = savedXdg;
});

function makeEntry(id: string): DismissalEntry {
  return {
    id,
    feature: "comp",
    reason: "test",
    dismissedAt: "2026-04-20T00:00:00Z",
  };
}

describe("loadRegistry", () => {
  test("missing file returns empty registry", () => {
    const reg = loadRegistry(tmpRoot);
    expect(reg.entries).toEqual([]);
    expect(reg.version).toBe(DISMISSAL_REGISTRY_VERSION);
  });

  test("corrupted file yields warning + empty registry, preserves file", () => {
    const path = registryPath(tmpRoot);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "not json", "utf8");
    const warnings: string[] = [];
    const reg = loadRegistry(tmpRoot, { onWarning: (m) => warnings.push(m) });
    expect(reg.entries).toEqual([]);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain(path);
    expect(readFileSync(path, "utf8")).toBe("not json");
  });

  test("load/save round-trip", () => {
    const reg = emptyRegistry();
    const added = addEntry(reg, makeEntry("comp:abc")).registry;
    saveRegistry(tmpRoot, added);
    const reloaded = loadRegistry(tmpRoot);
    expect(reloaded.entries.map((e) => e.id)).toEqual(["comp:abc"]);
  });

  test("projectPath round-trips through save + load", () => {
    const reg = withProjectPath(emptyRegistry(), tmpRoot);
    const added = addEntry(reg, makeEntry("comp:abc")).registry;
    saveRegistry(tmpRoot, added);
    const reloaded = loadRegistry(tmpRoot);
    expect(reloaded.projectPath).toBe(tmpRoot);
  });

  test("migrates pre-M2 sha256:<hex> entries to comp:<hex> on load", () => {
    // A pre-M2 registry that lacks the `<feature>:` prefix should load as
    // `comp:<hex>` — that is the whole point of the M2 migration. We
    // bypass the public API and write a legacy file directly so the
    // assertion exercises the load path, not the save path.
    const path = registryPath(tmpRoot);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: DISMISSAL_REGISTRY_VERSION,
        entries: [
          {
            id: "sha256:legacyhex",
            reason: "old",
            dismissedAt: "2026-04-20T00:00:00Z",
          },
        ],
      }),
      "utf8",
    );
    const reloaded = loadRegistry(tmpRoot);
    expect(reloaded.entries).toHaveLength(1);
    expect(reloaded.entries[0]?.id).toBe("comp:legacyhex");
    expect(reloaded.entries[0]?.feature).toBe("comp");
  });

  test("registryPath is isolated per project root under XDG_CONFIG_HOME", () => {
    const other = mkdtempSync(join(tmpdir(), "ts-hotspots-other-"));
    try {
      const a = registryPath(tmpRoot);
      const b = registryPath(other);
      expect(a).not.toBe(b);
      expect(a.startsWith(join(tmpXdg, "ts-hotspots"))).toBe(true);
      expect(b.startsWith(join(tmpXdg, "ts-hotspots"))).toBe(true);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("addEntry", () => {
  test("appends new entry", () => {
    const { registry, added } = addEntry(emptyRegistry(), makeEntry("comp:a"));
    expect(added).toBe(true);
    expect(registry.entries).toHaveLength(1);
  });

  test("no-op when id already present", () => {
    const start = addEntry(emptyRegistry(), makeEntry("comp:a")).registry;
    const { registry, added } = addEntry(start, makeEntry("comp:a"));
    expect(added).toBe(false);
    expect(registry).toBe(start);
  });
});

describe("removeEntry", () => {
  test("removes existing id", () => {
    const start = addEntry(emptyRegistry(), makeEntry("comp:a")).registry;
    const { registry, removed } = removeEntry(start, "comp:a");
    expect(removed).toBe(true);
    expect(registry.entries).toEqual([]);
  });

  test("returns removed=false when id absent", () => {
    const { removed } = removeEntry(emptyRegistry(), "comp:nope");
    expect(removed).toBe(false);
  });
});

describe("pruneRegistry", () => {
  test("drops entries whose id is not in current set", () => {
    const reg = emptyRegistry();
    const withA = addEntry(reg, makeEntry("comp:a")).registry;
    const withAB = addEntry(withA, makeEntry("comp:b")).registry;
    const { registry, prunedCount } = pruneRegistry(
      withAB,
      new Set(["comp:a"]),
    );
    expect(prunedCount).toBe(1);
    expect(registry.entries.map((e) => e.id)).toEqual(["comp:a"]);
  });

  test("prunes nothing when all ids are present", () => {
    const reg = addEntry(emptyRegistry(), makeEntry("comp:a")).registry;
    const { prunedCount } = pruneRegistry(reg, new Set(["comp:a"]));
    expect(prunedCount).toBe(0);
  });
});

describe("registryIdSet", () => {
  test("returns ids", () => {
    const reg = addEntry(emptyRegistry(), makeEntry("comp:a")).registry;
    expect([...registryIdSet(reg)]).toEqual(["comp:a"]);
  });
});
