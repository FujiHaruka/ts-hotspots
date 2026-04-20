import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { type CompilerOptions, Project, ts } from "ts-morph";

export class TsconfigNotFoundError extends Error {
  readonly code = "TSCONFIG_NOT_FOUND";
  constructor(tsconfigPath: string) {
    super(`tsconfig not found: ${tsconfigPath}`);
    this.name = "TsconfigNotFoundError";
  }
}

export interface LoadProjectOptions {
  tsconfigPath: string;
}

export interface LoadedProject {
  project: Project;
  tsconfigPath: string;
}

const PROJECT_COMPILER_OPTIONS: CompilerOptions = {
  jsx: ts.JsxEmit.Preserve,
  allowJs: true,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  module: ts.ModuleKind.Preserve,
  target: ts.ScriptTarget.ES2022,
  strict: true,
  esModuleInterop: true,
  skipLibCheck: true,
  resolveJsonModule: true,
};

export function loadProject(options: LoadProjectOptions): LoadedProject {
  const rootPath = resolve(options.tsconfigPath);

  if (!existsSync(rootPath)) {
    throw new TsconfigNotFoundError(rootPath);
  }

  const allTsconfigs = walkTsconfigReferences(rootPath);

  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { ...PROJECT_COMPILER_OPTIONS },
  });
  for (const cfg of allTsconfigs) {
    project.addSourceFilesFromTsConfig(cfg);
  }
  project.getTypeChecker();

  return { project, tsconfigPath: rootPath };
}

function walkTsconfigReferences(rootPath: string): string[] {
  const visited = new Set<string>();
  const queue: string[] = [rootPath];
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;
    if (visited.has(current)) continue;
    if (!existsSync(current)) {
      throw new TsconfigNotFoundError(current);
    }
    visited.add(current);
    const raw = readTsconfigJson(current);
    const refs = Array.isArray(raw.references) ? raw.references : [];
    for (const ref of refs) {
      if (typeof ref.path !== "string") continue;
      queue.push(resolveReferencePath(current, ref.path));
    }
  }
  return [...visited];
}

function resolveReferencePath(owner: string, refPath: string): string {
  const abs = resolve(dirname(owner), refPath);
  if (existsSync(abs) && statSync(abs).isDirectory()) {
    return join(abs, "tsconfig.json");
  }
  return abs;
}

interface RawTsconfig {
  references?: { path?: string }[];
}

function readTsconfigJson(tsconfigPath: string): RawTsconfig {
  const result = ts.readConfigFile(tsconfigPath, (path) =>
    readFileSync(path, "utf8"),
  );
  if (result.error || !result.config) {
    return {};
  }
  return result.config as RawTsconfig;
}
