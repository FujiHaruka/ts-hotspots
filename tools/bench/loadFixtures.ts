import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface Range {
  filePath: string;
  startLine?: number;
  endLine?: number;
}

export interface ExpectedPositive {
  changed: Range;
  existing: Range;
  rationale?: string;
  minScore?: {
    combined?: number;
    tokenOverlap?: number;
    statementKindSimilarity?: number;
    callOverlap?: number;
  };
}

export interface ExpectedNegative {
  changed: { filePath: string };
  existing: { filePath: string };
  rationale?: string;
}

export interface ExpectedJson {
  description: string;
  tags: string[];
  expectedPositive: ExpectedPositive[];
  expectedNegative: ExpectedNegative[];
}

export interface FileSnapshot {
  relPath: string;
  text: string;
}

export interface Fixture {
  id: string;
  dir: string;
  expected: ExpectedJson;
  baseFiles: FileSnapshot[];
  headFiles: FileSnapshot[];
}

/**
 * Walk a directory recursively and return file snapshots relative to `root`.
 * Paths are returned with forward-slash separators so the same fixture works
 * on Windows runners without re-normalising later in the pipeline.
 */
function readTree(root: string): FileSnapshot[] {
  const out: FileSnapshot[] = [];
  const walk = (dir: string): void => {
    const entries = readdirSync(dir);
    entries.sort();
    for (const name of entries) {
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        walk(full);
      } else if (st.isFile()) {
        const rel = relative(root, full).split("\\").join("/");
        out.push({ relPath: rel, text: readFileSync(full, "utf-8") });
      }
    }
  };
  walk(root);
  return out;
}

function parseExpected(path: string): ExpectedJson {
  const raw = readFileSync(path, "utf-8");
  const data = JSON.parse(raw) as ExpectedJson;
  if (typeof data.description !== "string") {
    throw new Error(`${path}: missing "description"`);
  }
  if (!Array.isArray(data.tags)) {
    throw new Error(`${path}: missing "tags" array`);
  }
  if (!Array.isArray(data.expectedPositive)) {
    throw new Error(`${path}: missing "expectedPositive" array`);
  }
  if (!Array.isArray(data.expectedNegative)) {
    throw new Error(`${path}: missing "expectedNegative" array`);
  }
  return data;
}

export function loadFixtures(suiteRoot: string, only?: string): Fixture[] {
  const entries = readdirSync(suiteRoot);
  entries.sort();
  const fixtures: Fixture[] = [];
  for (const name of entries) {
    const dir = join(suiteRoot, name);
    const st = statSync(dir);
    if (!st.isDirectory()) continue;
    if (!/^\d{3}-/.test(name)) continue;
    if (only !== undefined && !name.startsWith(only) && name !== only) continue;

    const expectedPath = join(dir, "expected.json");
    const baseDir = join(dir, "base");
    const headDir = join(dir, "head");

    const expected = parseExpected(expectedPath);
    const baseFiles = readTree(baseDir);
    const headFiles = readTree(headDir);

    fixtures.push({ id: name, dir, expected, baseFiles, headFiles });
  }
  return fixtures;
}
