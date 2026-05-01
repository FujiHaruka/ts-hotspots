import { type CompilerOptions, Project, ts } from "ts-morph";

export interface LoadProjectOptions {
  /**
   * Absolute paths of TypeScript sources to seed the ts-morph `Project`
   * with. The caller (typically `listRepoSources`) decides which files
   * count — `loadProject` does not consult any tsconfig.
   */
  sourcePaths: readonly string[];
}

export interface LoadedProject {
  project: Project;
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

/**
 * Build a ts-morph `Project` from an explicit list of source files, with no
 * tsconfig discovery and no TypeChecker materialization. The compiler
 * options above are deliberately permissive — collectors only need ts-morph
 * to wrap the AST, not to type-check anything.
 */
export function loadProject(options: LoadProjectOptions): LoadedProject {
  const project = new Project({
    skipAddingFilesFromTsConfig: true,
    compilerOptions: { ...PROJECT_COMPILER_OPTIONS },
  });
  if (options.sourcePaths.length > 0) {
    project.addSourceFilesAtPaths([...options.sourcePaths]);
  }
  return { project };
}
