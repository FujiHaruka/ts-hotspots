export interface ChangedHunk {
  startLine: number; // head 1-based, inclusive
  endLine: number; // head 1-based, inclusive
}

export interface HunkSpan {
  baseStart: number;
  baseCount: number;
  headStart: number;
  headCount: number;
}

export interface ChangedFile {
  filePath: string;
  basePath: string | undefined;
  headSha: string;
  baseSha: string;
  text: string;
  hunks: ChangedHunk[];
  spans: HunkSpan[];
}
