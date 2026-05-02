import { describe, expect, test } from "vitest";
import { type ChurnLogVisitor, walkChurnLog } from "./walkChurnLog.ts";

const cmt = "CMT";

interface CapturedEvent {
  kind: "commit" | "change";
  path?: string;
}

function capture(
  raw: string,
  fileSet: ReadonlySet<string>,
  prefix = "",
): CapturedEvent[] {
  const events: CapturedEvent[] = [];
  const visitor: ChurnLogVisitor = {
    onCommit: () => {
      events.push({ kind: "commit" });
    },
    onChange: (path) => {
      events.push({ kind: "change", path });
    },
  };
  walkChurnLog(raw, fileSet, { prefix }, visitor);
  return events;
}

describe("walkChurnLog", () => {
  test("emits onCommit at every commit boundary", () => {
    const raw = [cmt, "M\tsrc/foo.ts", cmt, "M\tsrc/bar.ts"].join("\n");
    const events = capture(raw, new Set(["src/foo.ts", "src/bar.ts"]));
    expect(events).toEqual([
      { kind: "commit" },
      { kind: "change", path: "src/foo.ts" },
      { kind: "commit" },
      { kind: "change", path: "src/bar.ts" },
    ]);
  });

  test("emits onChange for every tracked touch in a commit (no dedup)", () => {
    // Pathological but legal: the same canonical path appears twice in one
    // commit. The walker is expected to emit both events and let the visitor
    // decide whether to dedupe.
    const raw = [cmt, "M\tsrc/foo.ts", "M\tsrc/foo.ts"].join("\n");
    const events = capture(raw, new Set(["src/foo.ts"]));
    expect(events).toEqual([
      { kind: "commit" },
      { kind: "change", path: "src/foo.ts" },
      { kind: "change", path: "src/foo.ts" },
    ]);
  });

  test("drops paths not in fileSet", () => {
    const raw = [cmt, "M\tREADME.md", "M\tpackage.json", "M\tsrc/foo.ts"].join(
      "\n",
    );
    const events = capture(raw, new Set(["src/foo.ts"]));
    expect(events).toEqual([
      { kind: "commit" },
      { kind: "change", path: "src/foo.ts" },
    ]);
  });

  test("rename: emits canonical path and follows the chain backward", () => {
    // Newest → oldest:
    //   c3: modified after rename
    //   c2: rename src/old.ts → src/new.ts
    //   c1: modified before rename (as src/old.ts)
    const raw = [
      cmt,
      "M\tsrc/new.ts",
      cmt,
      "R100\tsrc/old.ts\tsrc/new.ts",
      cmt,
      "M\tsrc/old.ts",
    ].join("\n");
    const events = capture(raw, new Set(["src/new.ts"]));
    expect(events).toEqual([
      { kind: "commit" },
      { kind: "change", path: "src/new.ts" },
      { kind: "commit" },
      { kind: "change", path: "src/new.ts" },
      { kind: "commit" },
      { kind: "change", path: "src/new.ts" },
    ]);
  });

  test("addition before a rename at the same destination is not credited", () => {
    // Newest → oldest:
    //   c2: rename src/old.ts → src/new.ts
    //   c1: add an unrelated earlier file at src/new.ts (presumably deleted
    //       before c2). Going back in time from c2, src/new.ts no longer
    //       refers to the canonical file.
    const raw = [
      cmt,
      "R100\tsrc/old.ts\tsrc/new.ts",
      cmt,
      "A\tsrc/new.ts",
    ].join("\n");
    const events = capture(raw, new Set(["src/new.ts"]));
    expect(events).toEqual([
      { kind: "commit" },
      { kind: "change", path: "src/new.ts" },
      { kind: "commit" },
    ]);
  });

  test("copy emits the destination event but does not follow the source", () => {
    // c2: copy src/source.ts → src/copy.ts (we track src/copy.ts)
    // c1: modify src/source.ts — not tracked, no event
    const raw = [
      cmt,
      "C75\tsrc/source.ts\tsrc/copy.ts",
      cmt,
      "M\tsrc/source.ts",
    ].join("\n");
    const events = capture(raw, new Set(["src/copy.ts"]));
    expect(events).toEqual([
      { kind: "commit" },
      { kind: "change", path: "src/copy.ts" },
      { kind: "commit" },
    ]);
  });

  test("prefix strips monorepo sub-package offset before fileSet lookup", () => {
    const raw = [cmt, "M\tpackages/core/src/foo.ts", "M\tdocs/x.md"].join("\n");
    const events = capture(raw, new Set(["src/foo.ts"]), "packages/core");
    expect(events).toEqual([
      { kind: "commit" },
      { kind: "change", path: "src/foo.ts" },
    ]);
  });

  test("rename crossing into the prefix emits the rename but stops the chain", () => {
    const raw = [
      cmt,
      "R100\tother/old.ts\tpackages/core/src/new.ts",
      cmt,
      "M\tother/old.ts",
    ].join("\n");
    const events = capture(raw, new Set(["src/new.ts"]), "packages/core");
    expect(events).toEqual([
      { kind: "commit" },
      { kind: "change", path: "src/new.ts" },
      { kind: "commit" },
    ]);
  });

  test("empty input emits no events", () => {
    expect(capture("", new Set())).toEqual([]);
  });

  test("onCommit visitor is optional", () => {
    const raw = [cmt, "M\tsrc/foo.ts", cmt, "M\tsrc/foo.ts"].join("\n");
    const changes: string[] = [];
    walkChurnLog(
      raw,
      new Set(["src/foo.ts"]),
      {},
      {
        onChange: (p) => {
          changes.push(p);
        },
      },
    );
    expect(changes).toEqual(["src/foo.ts", "src/foo.ts"]);
  });

  test("malformed lines (no tab) are skipped", () => {
    const raw = [cmt, "garbage-line-no-tab", "M\tsrc/foo.ts"].join("\n");
    const events = capture(raw, new Set(["src/foo.ts"]));
    expect(events).toEqual([
      { kind: "commit" },
      { kind: "change", path: "src/foo.ts" },
    ]);
  });
});
