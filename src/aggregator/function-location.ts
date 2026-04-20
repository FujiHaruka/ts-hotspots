export function buildFunctionLocation(
  file: string,
  startLine: number,
  endLine: number,
): string {
  if (startLine === endLine) return `${file}:${String(startLine)}`;
  return `${file}:${String(startLine)}-${String(endLine)}`;
}

export function splitFunctionLocation(location: string): [string, number] {
  const idx = location.lastIndexOf(":");
  const file = location.slice(0, idx);
  const suffix = location.slice(idx + 1);
  const dashIdx = suffix.indexOf("-");
  const startStr = dashIdx === -1 ? suffix : suffix.slice(0, dashIdx);
  return [file, Number(startStr)];
}

interface FunctionIdentity {
  location: string;
  name: string;
  kind: string;
}

// Total deterministic ordering: file → start line → name → kind.
export function compareFunctionByLocation(
  a: FunctionIdentity,
  b: FunctionIdentity,
): number {
  const [af, al] = splitFunctionLocation(a.location);
  const [bf, bl] = splitFunctionLocation(b.location);
  if (af !== bf) return af < bf ? -1 : 1;
  if (al !== bl) return al - bl;
  if (a.name !== b.name) return a.name < b.name ? -1 : 1;
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1;
  return 0;
}
