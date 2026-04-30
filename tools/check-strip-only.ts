// Smoke-test that the source tree loads under Node's strip-only TypeScript
// mode. Re-introducing parameter properties, enums, namespaces, etc. throws
// ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX at module load time here, before reaching
// any test or build step. Intentionally invoked via plain `node` (no flags).
//
// `src/cli.ts` pulls in every hotspots and duplication module via static imports,
// so a single import here covers the full src/ tree.
import "../src/cli.ts";
