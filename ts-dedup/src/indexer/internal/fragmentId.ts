import type { FragmentKind } from "../../domain/fragment.ts";

/**
 * Deterministic id allocator for fragments within a single file.
 *
 * Base id format: `${filePath}#${startLine}-${endLine}-${kind}`.
 * When the same base id would be produced more than once (e.g. two arrow
 * functions on the same line), subsequent ids get a `-2`, `-3` ... suffix
 * in visit order, keeping ids unique and deterministic.
 */
export class FragmentIdAllocator {
  private readonly counts = new Map<string, number>();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  allocate(startLine: number, endLine: number, kind: FragmentKind): string {
    const base = `${this.filePath}#${String(startLine)}-${String(endLine)}-${kind}`;
    const prev = this.counts.get(base) ?? 0;
    const next = prev + 1;
    this.counts.set(base, next);
    if (next === 1) {
      return base;
    }
    return `${base}-${String(next)}`;
  }
}
