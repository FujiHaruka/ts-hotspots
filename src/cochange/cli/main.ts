/**
 * Cochange pipeline orchestrator.
 *
 * `runPipeline(parsedArgs, io, deps)` is the production-path entry:
 * composes source loading, the git log walk, raw metric computation,
 * the gate, dismissal-registry application, serialisation, and
 * stdout/stderr framing. Mirrors `src/architecture/cli/main.ts`.
 *
 * `main(argv, io)` is the standalone entry — builds a private commander
 * program with the same `addCochangeCommand` registrar the root CLI
 * uses, parses argv, and runs the pipeline.
 *
 * The git invocation is injected via `deps.runGitLog` so tests can
 * stub it without spawning a real `git log`. In production the default
 * shells out to git in `runGitLog.ts`.
 *
 * Graceful skip path: non-git, missing git binary, empty walker
 * output — return an empty `hotspots[]` (the empty `summary.actualWindow`
 * and `summary.pairsAfterGate` make the degraded state observable in
 * the report itself), mirroring comp's churn graceful-skip shape.
 */

import { sep as pathSep, resolve as resolvePath } from "node:path";
import pkg from "../../../package.json" with { type: "json" };
import {
  buildErrorWriters,
  type CliIO,
  classifyGenericError,
  sniffFormat,
} from "../../cli/streaming.ts";
import { TOOL_NAME } from "../../cli-defaults.ts";
import { DEFAULT_EXCLUDE_GLOBS } from "../../defaults.ts";
import {
  loadRegistry,
  pruneRegistry,
  registryIdSet,
  saveRegistry,
  withProjectPath,
} from "../../dismissal/store.ts";
import {
  renderJson,
  renderMarkdownBody,
  renderMarkdownHead,
} from "../../reporter/render.ts";
import type { DiffInfo, DismissedSummary, ReportTool } from "../../schema.ts";
import { findGitRoot } from "../../util/git/findGitRoot.ts";
import { listChangedFilePaths } from "../../util/git/listChangedFilePaths.ts";
import type { RevRange } from "../../util/git/parseRevRange.ts";
import { resolveDiffEndpoints } from "../../util/git/runner.ts";
import { computeMetrics } from "../metrics/computeMetrics.ts";
import { applyGate } from "../ranking/applyGate.ts";
import {
  DEFAULT_CONFIDENCE_MAX_FLOOR,
  LIFT_FLOOR,
} from "../ranking/defaults.ts";
import { sortCandidates } from "../ranking/sort.ts";
import { sortCandidatesByAnchor } from "../ranking/sortByAnchor.ts";
import type { Candidate } from "../ranking/types.ts";
import type {
  SerializedCochangeReport,
  SlimCochangeHotspot,
} from "../report/schema.ts";
import { serializeReport } from "../report/serializeJson.ts";
import { walkCochange } from "../walk/walkCochange.ts";
import { ArgParseError, type CochangeParsedArgs } from "./args.ts";
import { loadCochangeSources } from "./loadSources.ts";
import { runGitLog, runGitShowPrefix } from "./runGitLog.ts";

const TOOL: ReportTool = { name: TOOL_NAME, version: pkg.version };
const errorWriter = buildErrorWriters("cochange", TOOL);

export function writeCochangeParseError(
  io: CliIO,
  argv: readonly string[],
  err: unknown,
): void {
  const message = err instanceof Error ? err.message : String(err);
  errorWriter.pre(io, sniffFormat(argv), "INVALID_ARGS", message, message);
}

function classifyError(err: unknown): { code: string; message: string } {
  if (err instanceof ArgParseError) {
    return { code: "INVALID_ARGS", message: err.message };
  }
  return classifyGenericError(err);
}

function effectiveExcludeGlobs(args: CochangeParsedArgs): string[] {
  return [...DEFAULT_EXCLUDE_GLOBS, ...args.excludeGlobs];
}

/**
 * Dependencies overridable by tests. Production callers pass nothing —
 * the defaults shell out to real git.
 */
export interface CochangeRunDeps {
  runGitLog: typeof runGitLog;
  runGitShowPrefix: typeof runGitShowPrefix;
  resolveDiffEndpoints: typeof resolveDiffEndpoints;
  listChangedFilePaths: typeof listChangedFilePaths;
}

const DEFAULT_DEPS: CochangeRunDeps = {
  runGitLog,
  runGitShowPrefix,
  resolveDiffEndpoints,
  listChangedFilePaths,
};

interface DiffScope {
  baseSha: string;
  headSha: string;
  threeDot: boolean;
  changedFiles: number;
  isInScope: (filePath: string) => boolean;
}

async function resolveDiffScope(
  rev: RevRange,
  rootDir: string,
  deps: CochangeRunDeps,
): Promise<DiffScope> {
  const { baseSha, headSha } = await deps.resolveDiffEndpoints(
    rootDir,
    rev.baseRef,
    rev.headRef,
    rev.threeDot,
  );
  const repoRelChanged = await deps.listChangedFilePaths(
    rootDir,
    baseSha,
    headSha,
  );
  const scope = new Set<string>(repoRelChanged);
  return {
    baseSha,
    headSha,
    threeDot: rev.threeDot,
    changedFiles: scope.size,
    isInScope: (filePath) => scope.has(filePath),
  };
}

function applyDismissalRegistry(
  rootDir: string,
  hotspots: SlimCochangeHotspot[],
): { hotspots: SlimCochangeHotspot[]; summary?: DismissedSummary } {
  const original = loadRegistry(rootDir);
  if (original.entries.length === 0) return { hotspots };

  const currentIds = new Set<string>();
  for (const h of hotspots) currentIds.add(h.dismissalId);
  const { registry: pruned, prunedCount } = pruneRegistry(
    original,
    "coch",
    currentIds,
  );
  if (prunedCount > 0) {
    saveRegistry(rootDir, withProjectPath(pruned, rootDir));
  }
  const activeIds = registryIdSet(pruned);
  const kept: SlimCochangeHotspot[] = [];
  let filteredThisRun = 0;
  for (const h of hotspots) {
    if (activeIds.has(h.dismissalId)) {
      filteredThisRun += 1;
    } else {
      kept.push(h);
    }
  }
  return {
    hotspots: kept,
    summary: {
      active: pruned.entries.length,
      filteredThisRun,
      prunedThisRun: prunedCount,
    },
  };
}

export async function runPipeline(
  args: CochangeParsedArgs,
  io: CliIO,
  deps: CochangeRunDeps = DEFAULT_DEPS,
): Promise<number> {
  const startDir = args.path === undefined ? io.cwd() : resolvePath(args.path);
  let repoPath: string;
  try {
    repoPath = findGitRoot(startDir);
  } catch (err) {
    const { code, message } = classifyError(err);
    errorWriter.pre(io, args.format, code, message, message);
    return 1;
  }

  if (args.format === "markdown") {
    io.stdout.write(renderMarkdownHead("cochange"));
  }

  try {
    const exclude = effectiveExcludeGlobs(args);
    const filePaths = await loadCochangeSources({
      rootDir: repoPath,
      excludeGlobs: exclude,
    });
    const fileSet = new Set(filePaths);

    let anchor: string | undefined;
    if (args.file !== undefined) {
      const normalized = toRepoRelativePosix(repoPath, args.file);
      if (!fileSet.has(normalized)) {
        throw new ArgParseError(
          `--file ${args.file} is not in the analyzed file-set`,
        );
      }
      anchor = normalized;
    }

    const ref = args.ref ?? "HEAD";
    const prefixRaw = deps.runGitShowPrefix(repoPath);
    const prefix =
      prefixRaw === undefined ? "" : prefixRaw.trim().replace(/\/$/, "");

    const rawLog = deps.runGitLog({
      rootDir: repoPath,
      ref,
      window: args.window,
    });

    const reportInput = buildReportInput({
      args,
      rawLog,
      fileSet,
      prefix,
      analyzedFileCount: filePaths.length,
      anchor,
    });

    const fullReport = serializeReport(reportInput, { verbose: args.verbose });

    let scope: DiffScope | undefined;
    if (args.diff !== undefined) {
      try {
        scope = await resolveDiffScope(args.diff, repoPath, deps);
      } catch (err) {
        const { code, message } = classifyError(err);
        const detail =
          err instanceof Error ? (err.stack ?? err.message) : String(err);
        errorWriter.post(io, args.format, code, message, detail);
        return 1;
      }
    }

    const hotspotsAfterDiff =
      scope === undefined
        ? fullReport.hotspots
        : fullReport.hotspots.filter((h) => {
            const inScope = scope.isInScope.bind(scope);
            if (h.anchor !== undefined && inScope(h.anchor.ref.location)) {
              return true;
            }
            return h.members.some((m) => inScope(m.ref.location));
          });

    const { hotspots: hotspotsAfterDismissal, summary: dismissed } =
      applyDismissalRegistry(repoPath, hotspotsAfterDiff);

    const finalHotspots = Number.isFinite(args.limit)
      ? hotspotsAfterDismissal.slice(0, args.limit)
      : hotspotsAfterDismissal;

    const outReport: SerializedCochangeReport = {
      ...fullReport,
      hotspots: finalHotspots,
    };
    if (scope !== undefined) {
      const diffInfo: DiffInfo = {
        baseSha: scope.baseSha,
        headSha: scope.headSha,
        threeDot: scope.threeDot,
        changedFiles: scope.changedFiles,
      };
      outReport.diff = diffInfo;
    }
    if (dismissed !== undefined) outReport.dismissed = dismissed;

    io.stdout.write(
      args.format === "json"
        ? renderJson(outReport)
        : renderMarkdownBody(outReport),
    );
    return 0;
  } catch (err) {
    const { code, message } = classifyError(err);
    const detail =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    errorWriter.post(io, args.format, code, message, detail);
    return 1;
  }
}

interface BuildReportInputArgs {
  args: CochangeParsedArgs;
  rawLog: string | undefined;
  fileSet: ReadonlySet<string>;
  prefix: string;
  analyzedFileCount: number;
  /**
   * Single-anchor mode pivot. When set, the gated candidate list is filtered
   * to pairs containing the anchor, each surviving candidate carries
   * `anchor` so the serializer emits the schema-shifted shape, and sort
   * keys flip to `confidence(anchor -> partner)`. `--limit` is applied
   * to the anchored sort the same way as in default mode.
   */
  anchor?: string;
}

function buildReportInput(input: BuildReportInputArgs): {
  candidates: ReturnType<typeof sortCandidates>;
  perFileChanges: ReadonlyMap<string, number>;
  windowCommits: number;
  analyzedFileCount: number;
  pairCandidateCountBeforeGate: number;
  pairsAfterGate: number;
  commitsSkippedAsLargeChange: number;
  requestedWindow: number;
  actualWindow: number;
  tool: ReportTool;
} {
  const { args, rawLog, fileSet, prefix, analyzedFileCount, anchor } = input;
  if (rawLog === undefined) {
    return {
      candidates: [],
      perFileChanges: new Map(),
      windowCommits: 0,
      analyzedFileCount,
      pairCandidateCountBeforeGate: 0,
      pairsAfterGate: 0,
      commitsSkippedAsLargeChange: 0,
      requestedWindow: args.window,
      actualWindow: 0,
      tool: TOOL,
    };
  }
  const walkResult = walkCochange(rawLog, fileSet, {
    prefix,
    maxFilesPerCommit: args.maxFilesPerCommit,
  });
  const metricsMap = computeMetrics(walkResult);
  const pairsBeforeGate = metricsMap.size;
  const gated = applyGate(metricsMap, walkResult.pairs, {
    minSupport: args.minSupport,
    confidenceMaxFloor: DEFAULT_CONFIDENCE_MAX_FLOOR,
    liftFloor: LIFT_FLOOR,
  });
  const pairsAfterGate = gated.length;
  const sorted =
    anchor === undefined
      ? sortCandidates(gated, { limit: args.limit })
      : sortCandidatesByAnchor(reorientForAnchor(gated, anchor), {
          limit: args.limit,
        });
  return {
    candidates: sorted,
    perFileChanges: walkResult.perFileChanges,
    windowCommits: walkResult.actualWindow,
    analyzedFileCount,
    pairCandidateCountBeforeGate: pairsBeforeGate,
    pairsAfterGate,
    commitsSkippedAsLargeChange: walkResult.commitsSkippedAsLargeChange,
    requestedWindow: args.window,
    actualWindow: walkResult.actualWindow,
    tool: TOOL,
  };
}

function reorientForAnchor(
  candidates: readonly Candidate[],
  anchor: string,
): Candidate[] {
  const out: Candidate[] = [];
  for (const c of candidates) {
    if (c.pathA !== anchor && c.pathB !== anchor) continue;
    out.push({ ...c, anchor });
  }
  return out;
}

function toRepoRelativePosix(rootDir: string, input: string): string {
  const abs = resolvePath(rootDir, input);
  const root = resolvePath(rootDir);
  const rootWithSep = root.endsWith(pathSep) ? root : root + pathSep;
  let rel: string;
  if (abs === root) {
    rel = "";
  } else if (abs.startsWith(rootWithSep)) {
    rel = abs.slice(rootWithSep.length);
  } else {
    rel = abs;
  }
  return pathSep === "/" ? rel : rel.split(pathSep).join("/");
}
