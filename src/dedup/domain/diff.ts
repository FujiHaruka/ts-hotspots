export interface ChangedHunk {
  startLine: number; // head 1-based, inclusive
  endLine: number; // head 1-based, inclusive
}

export interface ChangedFile {
  filePath: string;
  headSha: string;
  baseSha: string;
  text: string;
  hunks: ChangedHunk[];
}
