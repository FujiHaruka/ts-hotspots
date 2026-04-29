// Smoke-test that the source tree loads under Node's strip-only TypeScript
// mode. Re-introducing parameter properties, enums, namespaces, etc. throws
// ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX at module load time here, before reaching
// any test or build step. Intentionally invoked via plain `node` (no flags).
import "../src/dedup/cli/main.ts";
