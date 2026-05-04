import { describe, expect, test } from "vitest";
import { parse as parseYaml } from "yaml";
import { emptyFunctionAxisMeta } from "../aggregator/rank.ts";
import type { ErrorReport, FunctionReport } from "../schema.ts";
import {
  renderJson,
  renderMarkdown,
  renderMarkdownBody,
  renderMarkdownErrorBody,
  renderMarkdownHead,
  renderMarkdownPreError,
} from "./render.ts";

function makeFunctionReport(
  overrides: Partial<FunctionReport> = {},
): FunctionReport {
  return {
    tool: { name: "ts-hotspots", version: "0.1.0" },
    project: {
      sourceFileCount: 3,
      functionCount: 5,
    },
    hotspots: [],
    ...overrides,
  };
}

describe("renderJson", () => {
  test("produces deterministic pretty JSON with trailing newline for FunctionReport", () => {
    const report = makeFunctionReport();
    const a = renderJson(report);
    const b = renderJson(report);
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
    expect(JSON.parse(a)).toEqual(report);
  });

  test("renders slim FunctionReport by default with only hotspot candidates", () => {
    const report = makeFunctionReport();
    const parsed = JSON.parse(renderJson(report)) as Record<string, unknown>;
    expect(parsed.hotspots).toBeDefined();
    expect(parsed.functionRankings).toBeUndefined();
    expect(parsed.functionAxisMeta).toBeUndefined();
    expect(parsed.functions).toBeUndefined();
    expect(parsed.functionCoOccurrence).toBeUndefined();
  });

  test("renders optional sections when provided", () => {
    const report = makeFunctionReport({
      functionRankings: {},
      functionAxisMeta: emptyFunctionAxisMeta(),
      functionCoOccurrence: [],
      functions: [],
    });
    const parsed = JSON.parse(renderJson(report)) as Record<string, unknown>;
    expect(parsed.functionRankings).toEqual({});
    expect(parsed.functionAxisMeta).toBeDefined();
    expect(parsed.functionCoOccurrence).toEqual([]);
    expect(parsed.functions).toEqual([]);
  });

  test("renders ErrorReport", () => {
    const err: ErrorReport = {
      status: "error",
      error: { code: "TSCONFIG_NOT_FOUND", message: "missing" },
    };
    expect(JSON.parse(renderJson(err))).toEqual(err);
  });

  test('success reports omit `status`; error reports keep `status: "error"`', () => {
    const ok = JSON.parse(renderJson(makeFunctionReport())) as {
      status?: string;
    };
    expect(ok.status).toBeUndefined();
    const err: ErrorReport = {
      status: "error",
      error: { code: "X", message: "y" },
    };
    const parsed = JSON.parse(renderJson(err)) as { status: string };
    expect(parsed.status).toBe("error");
  });
});

function extractYamlFence(markdown: string): string {
  const match = /```yaml\n([\s\S]*?)\n```/.exec(markdown);
  if (match === null) throw new Error("no ```yaml fence found");
  return match[1] ?? "";
}

describe("renderMarkdown (complexity)", () => {
  test("FunctionReport: includes prompt header and YAML fence whose body round-trips to the report", () => {
    const report = makeFunctionReport();
    const md = renderMarkdown("complexity", report);
    expect(md.startsWith("# ts-hotspots complexity report")).toBe(true);
    expect(md).toContain("## Data");
    const body = extractYamlFence(md);
    expect(parseYaml(body)).toEqual(report);
  });

  test("ErrorReport: produces a Markdown error block, not a fenced data block", () => {
    const err: ErrorReport = {
      status: "error",
      error: { code: "TSCONFIG_NOT_FOUND", message: "missing at /x" },
    };
    const md = renderMarkdown("complexity", err);
    expect(md.startsWith("# ts-hotspots complexity error")).toBe(true);
    expect(md).toContain("missing at /x");
    expect(md).not.toContain("```yaml");
    expect(md).not.toContain("```");
  });

  test("head + body compose to the same string as renderMarkdown", () => {
    const report = makeFunctionReport();
    const composed = `${renderMarkdownHead("complexity")}${renderMarkdownBody(report)}`;
    expect(composed).toBe(renderMarkdown("complexity", report));
  });

  test("head is data-independent (stable across different reports)", () => {
    const a = makeFunctionReport();
    const b = makeFunctionReport({
      project: {
        sourceFileCount: 999,
        functionCount: 123,
      },
    });
    const head = renderMarkdownHead("complexity");
    expect(renderMarkdownHead("complexity")).toBe(head);
    const headA = renderMarkdown("complexity", a).slice(0, head.length);
    const headB = renderMarkdown("complexity", b).slice(0, head.length);
    expect(headA).toBe(head);
    expect(headB).toBe(head);
  });

  test("error body closes the fence and carries the error envelope", () => {
    const err: ErrorReport = {
      status: "error",
      error: { code: "X", message: "boom" },
    };
    const body = renderMarkdownErrorBody(err);
    expect(body.endsWith("```\n")).toBe(true);
    const doc = `${renderMarkdownHead("complexity")}${body}`;
    expect(parseYaml(extractYamlFence(doc))).toEqual(err);
  });
});

describe("renderMarkdown (duplication)", () => {
  test("head starts with the duplication-specific instruction heading and opens a YAML fence", () => {
    const head = renderMarkdownHead("duplication");
    expect(head.startsWith("# ts-hotspots duplication report")).toBe(true);
    expect(head).toContain("## Data");
    expect(head.endsWith("```yaml\n")).toBe(true);
  });

  test("head + body compose to a parseable fenced-YAML Markdown document for any payload", () => {
    const payload = {
      status: "ok" as const,
      tool: { name: "ts-hotspots", version: "0.1.0" },
      groups: [],
    };
    const doc = `${renderMarkdownHead("duplication")}${renderMarkdownBody(payload)}`;
    expect(parseYaml(extractYamlFence(doc))).toEqual(payload);
  });

  test("renderMarkdownPreError emits a stand-alone duplication-error block (no fenced data block)", () => {
    const md = renderMarkdownPreError("duplication", "git ref does not exist");
    expect(md.startsWith("# ts-hotspots duplication error")).toBe(true);
    expect(md).toContain("git ref does not exist");
    expect(md).not.toContain("```");
  });

  test("post-stream error closes the head's open YAML fence with the error envelope", () => {
    const errPayload = {
      status: "error" as const,
      tool: { name: "ts-hotspots", version: "0.1.0" },
      error: { code: "GIT_FAILED", message: "boom" },
    };
    const doc = `${renderMarkdownHead("duplication")}${renderMarkdownErrorBody(errPayload)}`;
    expect(doc.endsWith("```\n")).toBe(true);
    expect(parseYaml(extractYamlFence(doc))).toEqual(errPayload);
  });

  test("YAML body preserves common ts-hotspots string shapes (paths with `:`, glob-like `*`, dismissal IDs)", () => {
    const payload = {
      hotspots: [
        {
          ref: { location: "src/cli.ts:200-209", name: "parseFlag" },
          evidence: { properties: ["argv.*", "args.format"] },
          dismissalId: "dup:f649e613aab247d9",
        },
      ],
    };
    const doc = `${renderMarkdownHead("duplication")}${renderMarkdownBody(payload)}`;
    expect(parseYaml(extractYamlFence(doc))).toEqual(payload);
  });
});
