import type {
  Collector,
  CollectorContext,
  Declaration,
  DeclarationId,
} from "./types.ts";

interface MakeCollectorOptions<T> {
  name: string;
  compute: (decl: Declaration) => T;
}

export function makeCollector<T>(opts: MakeCollectorOptions<T>): Collector<T> {
  const { name, compute } = opts;
  return {
    name,
    collect(ctx: CollectorContext): Map<DeclarationId, T> {
      const result = new Map<DeclarationId, T>();
      for (const decl of ctx.declarations) {
        try {
          result.set(decl.id, compute(decl));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            `${name}Collector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
            { cause: err },
          );
        }
      }
      return result;
    },
  };
}
