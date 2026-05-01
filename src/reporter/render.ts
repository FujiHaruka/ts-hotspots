import { REPORT_PROMPTS, type ReportFeature } from "./prompt.ts";

export type { ReportFeature };

export function renderJson(report: object): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

/**
 * Markdown head: agent-first instruction prelude + opening JSON fence.
 * Data-independent, so streaming consumers (e.g. `claude --permission-mode
 * plan`'s 3s detect window) see well-formed Markdown before the heavy
 * analysis runs.
 */
export function renderMarkdownHead(feature: ReportFeature): string {
  return `${REPORT_PROMPTS[feature].ok}\n## Data\n\n\`\`\`json\n`;
}

/**
 * Closing fence around any JSON-serializable payload (ok or error). Use
 * after `renderMarkdownHead` so the head + body compose to a well-formed
 * fenced-JSON Markdown document.
 */
export function renderMarkdownBody(payload: object): string {
  return `${JSON.stringify(payload, null, 2)}\n\`\`\`\n`;
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
 * instead so the JSON fence stays well-formed.
 */
export function renderMarkdownPreError(
  feature: ReportFeature,
  message: string,
): string {
  return `${REPORT_PROMPTS[feature].error}\n${message}\n`;
}

/**
 * Single-shot Markdown for callers that don't stream — the head and body
 * are concatenated. Errors render as a stand-alone block (no JSON fence)
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

/**
 * stderr summary line shared across subcommands. Format:
 * `ts-hotspots <feature>: <payload>\n`. The payload is feature-specific
 * but the prefix is fixed so consumers can grep across both.
 */
export function renderStatsLine(
  feature: ReportFeature,
  payload: string,
): string {
  return `ts-hotspots ${feature}: ${payload}\n`;
}
