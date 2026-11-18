/**
 * Architecture pipeline orchestrator.
 *
 * `runPipeline(parsedArgs, io)` is the production-path entry: composes
 * source loading, graph build, metric computation (M2), betweenness
 * (M3), scoring (M4), display-filter `--diff` slicing, dismissal-
 * registry application, serialisation, and stdout/stderr framing.
 *
 * `main(argv, io)` is the standalone test entry — builds a private
 * commander program with the same `addArchitectureCommand` registrar
 * the root CLI uses, parses argv, and runs the pipeline. Mirrors
 * `src/duplication/cli/main.ts` exactly so the dup and arch test
 * surfaces are interchangeable shapes.
 *
 * Returns an exit code rather than calling `process.exit` so callers
 * can compose. Streaming Markdown:
 *   - The agent-first head (instruction prelude + YAML fence) is
 *     flushed before the heavy work runs, so consumers with short
 *     stdin timeouts see well-formed Markdown immediately.
 *   - Once the head is out, post-stream failures close the fence
 *     with the error envelope as its YAML body.
 */

import { resolve as resolvePath } from "node:path";
import { Command, CommanderError } from "commander";
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
  resolveRegistryDir,
  saveRegistry,
  withProjectPath,
} from "../../dismissal/store.ts";
import {
  renderJson,
  renderMarkdownBody,
  renderMarkdownHead,
} from "../../reporter/render.ts";
import type { DismissedSummary } from "../../schema.ts";
import { findGitRoot } from "../../util/git/findGitRoot.ts";
import { listChangedFilePaths } from "../../util/git/listChangedFilePaths.ts";
import type { RevRange } from "../../util/git/parseRevRange.ts";
import { resolveDiffEndpoints } from "../../util/git/runner.ts";
import { buildGraph } from "../graph/buildGraph.ts";
import { withBetweenness } from "../metrics/betweenness.ts";
import { computeMetrics } from "../metrics/computeMetrics.ts";
import { serializeReport } from "../report/serializeReport.ts";
import type { ArchHotspot, ArchReport, ArchTool } from "../report/types.ts";
import { readTsconfigResolution } from "../resolve/tsconfigPaths.ts";
import { score } from "../scoring/score.ts";
import { buildLineCounts, collectSmallNodeIds } from "../scoring/sizeFloor.ts";
import { collectTypeOnlyNodeIds } from "../scoring/typeOnlyNodes.ts";
import { buildPackageMap } from "../workspace/buildPackageMap.ts";
import { discoverWorkspace } from "../workspace/discoverWorkspace.ts";
import type { PackageMap } from "../workspace/types.ts";
import { type ArchParsedArgs, ArgParseError } from "./args.ts";
import { loadArchSources } from "./loadSources.ts";
import { addArchitectureCommand } from "./registerCommand.ts";

const TOOL: ArchTool = { name: TOOL_NAME, version: pkg.version };
const errorWriter = buildErrorWriters("architecture", TOOL);

const REAL_IO: CliIO = {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: () => process.cwd(),
};

export function writeArchitectureParseError(
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
): Promise<DiffScope> {
  const gitRoot = findGitRoot(rootDir);
  const { baseSha, headSha } = await resolveDiffEndpoints(
    gitRoot,
    rev.baseRef,
    rev.headRef,
    rev.threeDot,
  );
  const repoRelChanged = await listChangedFilePaths(gitRoot, baseSha, headSha);
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
  hotspots: ArchHotspot[],
): { hotspots: ArchHotspot[]; summary?: DismissedSummary } {
  const original = loadRegistry(rootDir);
  if (original.entries.length === 0) return { hotspots };

  const currentIds = new Set<string>();
  for (const h of hotspots) currentIds.add(h.dismissalId);
  const { registry: pruned, prunedCount } = pruneRegistry(
    original,
    "arch",
    currentIds,
  );
  if (prunedCount > 0) {
    saveRegistry(rootDir, withProjectPath(pruned, rootDir));
  }
  const activeIds = registryIdSet(pruned);
  const kept: ArchHotspot[] = [];
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
  args: ArchParsedArgs,
  io: CliIO,
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
    io.stdout.write(renderMarkdownHead("architecture"));
  }

  try {
    const exclude = [...DEFAULT_EXCLUDE_GLOBS, ...args.excludeGlobs];
    const sources = await loadArchSources({
      rootDir: repoPath,
      ref: args.ref,
      excludeGlobs: exclude,
    });
    const packageMap = discoverAndBuildPackageMap(repoPath);
    const tsconfig = readTsconfigResolution(repoPath, { packageMap });
    const graph = buildGraph({
      sources,
      resolveCtx: { tsconfig, packageMap },
    });

    const { metrics: baseMetrics, adjacency } = computeMetrics(graph, {
      includeTypes: args.includeTypes,
    });
    const metrics = withBetweenness(baseMetrics, adjacency);

    const excludedNodeIds = new Set<string>();
    for (const id of collectTypeOnlyNodeIds(graph)) excludedNodeIds.add(id);
    for (const id of collectSmallNodeIds(graph.nodes)) excludedNodeIds.add(id);

    const candidates = score(metrics, {
      excludedNodeIds,
      lineCounts: buildLineCounts(graph.nodes),
    });

    const refLabel = args.ref ?? "working-tree";
    const fullReport = serializeReport(candidates, {
      tool: TOOL,
      verbose: args.verbose,
      ref: refLabel,
      graph,
      sourceFileCount: sources.length,
    });

    let scope: DiffScope | undefined;
    if (args.diff !== undefined) {
      try {
        scope = await resolveDiffScope(args.diff, repoPath);
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
        : fullReport.hotspots.filter((h) =>
            scope.isInScope(splitFile(h.ref.location)),
          );

    const { hotspots: hotspotsAfterDismissal, summary: dismissed } =
      applyDismissalRegistry(resolveRegistryDir(repoPath), hotspotsAfterDiff);

    const finalHotspots = Number.isFinite(args.limit)
      ? hotspotsAfterDismissal.slice(0, args.limit)
      : hotspotsAfterDismissal;

    const outReport: ArchReport = { ...fullReport, hotspots: finalHotspots };
    if (scope !== undefined) {
      outReport.diff = {
        baseSha: scope.baseSha,
        headSha: scope.headSha,
        threeDot: scope.threeDot,
        changedFiles: scope.changedFiles,
      };
      if (scope.changedFiles === 0) {
        outReport.notice = {
          code: "DIFF_SCOPE_EMPTY",
          message:
            "Changed files contain no exported components tracked by this graph — nothing to rank",
        };
      }
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

function splitFile(location: string): string {
  const idx = location.lastIndexOf(":");
  return idx === -1 ? location : location.slice(0, idx);
}

function discoverAndBuildPackageMap(repoPath: string): PackageMap | undefined {
  const ws = discoverWorkspace(repoPath);
  if (ws === null) return undefined;
  return buildPackageMap({
    repoRoot: repoPath,
    packageRoots: ws.packageRoots,
  });
}

export async function main(
  argv: readonly string[],
  io: CliIO = REAL_IO,
): Promise<number> {
  let parsed: ArchParsedArgs | undefined;
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: (s) => {
      io.stdout.write(s);
    },
    writeErr: (s) => {
      io.stderr.write(s);
    },
  });

  addArchitectureCommand(program, (args) => {
    parsed = args;
  });

  try {
    await program.parseAsync(["node", TOOL_NAME, "architecture", ...argv]);
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === "commander.helpDisplayed") return 0;
      const message = err.message;
      errorWriter.pre(io, sniffFormat(argv), "INVALID_ARGS", message, message);
      return 1;
    }
    if (err instanceof ArgParseError) {
      errorWriter.pre(
        io,
        sniffFormat(argv),
        "INVALID_ARGS",
        err.message,
        err.message,
      );
      return 1;
    }
    throw err;
  }

  if (parsed === undefined) {
    io.stderr.write(
      "ts-hotspots architecture: internal error — command did not run\n",
    );
    return 1;
  }

  return runPipeline(parsed, io);
}
