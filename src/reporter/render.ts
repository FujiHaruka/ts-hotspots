import { stringify as stringifyYaml } from "yaml";
import { REPORT_PROMPTS, type ReportFeature } from "./prompt.ts";

export type { ReportFeature };

export function renderJson(report: object): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * YAML chosen over JSON for the markdown body: same data, fewer tokens for
 * downstream LLM agents (no key quotes, no commas, no closing braces).
 * `--format json` still emits raw JSON via `renderJson`.
 */
function renderYaml(payload: object): string {
  return stringifyYaml(payload, { indent: 2, lineWidth: 0 });
}

/**
 * Markdown head: agent-first instruction prelude + opening YAML fence.
 * Data-independent, so streaming consumers (e.g. `claude --permission-mode
 * plan`'s 3s detect window) see well-formed Markdown before the heavy
 * analysis runs.
 */
export function renderMarkdownHead(feature: ReportFeature): string {
  return `${REPORT_PROMPTS[feature].ok}\n## Data\n\n\`\`\`yaml\n`;
}

/**
 * Closing fence around any YAML-serializable payload (ok or error). Use
 * after `renderMarkdownHead` so the head + body compose to a well-formed
 * fenced-YAML Markdown document.
 */
export function renderMarkdownBody(payload: object): string {
  return `${renderYaml(payload)}\`\`\`\n`;
}

/**
 * Same shape as `renderMarkdownBody`. Re-exported under a distinct name so
 * the post-head error path is grep-discoverable from call sites.
 */
export const renderMarkdownErrorBody = renderMarkdownBody;

/**
 * Pre-stream error block: stand-alone Markdown for the path where the
 * head has not yet been emitted. Use this when a fast-fail validation
 * (e.g. "tsconfig not found") rejects the request before streaming
 * starts. Once the head is on stdout, switch to `renderMarkdownErrorBody`
 * instead so the YAML fence stays well-formed.
 */
export function renderMarkdownPreError(
  feature: ReportFeature,
  message: string,
): string {
  return `${REPORT_PROMPTS[feature].error}\n${message}\n`;
}

/**
 * Single-shot Markdown for callers that don't stream — the head and body
 * are concatenated. Errors render as a stand-alone block (no YAML fence)
 * because nothing has been emitted yet.
 */
/**
 * Success reports omit `status` entirely; only the error envelope keeps
 * `status: "error"`. The function discriminates on that field's presence.
 */
export function renderMarkdown(
  feature: ReportFeature,
  report: { status?: "error"; error?: { message: string } } & object,
): string {
  if (report.status === "error") {
    const message = report.error?.message ?? "";
    return renderMarkdownPreError(feature, message);
  }
  return `${renderMarkdownHead(feature)}${renderMarkdownBody(report)}`;
}
