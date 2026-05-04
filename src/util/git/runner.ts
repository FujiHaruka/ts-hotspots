import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface ExecGitOptions {
  /** Maximum stdout buffer (bytes). Defaults to 64 MiB. */
  maxBuffer?: number;
}

/**
 * Execute `git` with the given args in `cwd` and return stdout as UTF-8.
 *
 * Throws when git exits with a non-zero status (the thrown Error carries
 * stderr on `.stderr`).
 */
export async function execGit(
  cwd: string,
  args: readonly string[],
  options: ExecGitOptions = {},
): Promise<string> {
  const maxBuffer = options.maxBuffer ?? 64 * 1024 * 1024;
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf-8",
    maxBuffer,
  });
  return stdout;
}

/**
 * Resolve a ref (sha, branch, tag, ...) to a full commit sha.
 */
export async function resolveSha(cwd: string, ref: string): Promise<string> {
  const out = await execGit(cwd, ["rev-parse", ref]);
  return out.trim();
}

/**
 * Resolve the merge-base of two refs to a full commit sha.
 * Used for three-dot (`A...B`) PR semantics.
 */
async function mergeBaseSha(
  cwd: string,
  a: string,
  b: string,
): Promise<string> {
  const out = await execGit(cwd, ["merge-base", a, b]);
  return out.trim();
}

interface BatchCatFileResult {
  /** Map keyed by the input `<ref>:<path>` spec. Missing / unreadable specs are absent. */
  contents: Map<string, string>;
}

/**
 * Read many `<ref>:<path>` blobs in a single `git cat-file --batch` child
 * process. Replaces the N-fork-per-file pattern of N back-to-back
 * `git show <ref>:<path>` calls; on a 173-file repo this drops the wall
 * cost from ~600ms to <50ms.
 *
 * Decodes blobs as UTF-8. Specs that resolve to a missing object or to a
 * non-blob are silently skipped (matching the silent-skip behavior of the
 * legacy per-file path that callers depended on for binary blobs and
 * submodule gitlinks).
 */
export async function gitCatFileBatch(
  cwd: string,
  specs: readonly string[],
): Promise<BatchCatFileResult> {
  const contents = new Map<string, string>();
  if (specs.length === 0) return { contents };

  // `--batch` emits `<sha> <type> <size>\n<size bytes>\n` per resolved
  // object, or `<spec> missing\n` per unknown one. We stream stdout into
  // one growing buffer and walk it in order, matching responses to specs
  // by the input ordering (cat-file preserves order).
  return await new Promise((resolve, reject) => {
    const child = spawn("git", ["-C", cwd, "cat-file", "--batch"], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf-8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      totalBytes += chunk.length;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0 && code !== null) {
        reject(
          new Error(
            `git cat-file --batch exited with code ${String(code)}: ${stderr}`,
          ),
        );
        return;
      }
      const buf = Buffer.concat(chunks, totalBytes);
      let offset = 0;
      const decoder = new TextDecoder("utf-8", { fatal: false });
      for (const spec of specs) {
        if (offset >= buf.length) break;
        const nl = buf.indexOf(0x0a, offset);
        if (nl === -1) break;
        const header = buf.toString("utf-8", offset, nl);
        offset = nl + 1;
        // Header forms:
        //   "<sha> blob <size>"        (resolved blob)
        //   "<spec> missing"           (unknown ref)
        //   "<sha> <other-type> <size>" (resolved non-blob — tree, commit, tag)
        // For non-blobs we still consume the body bytes per protocol, then
        // skip the entry without populating `contents`.
        if (header.endsWith(" missing")) continue;
        const lastSpace = header.lastIndexOf(" ");
        const secondLastSpace = header.lastIndexOf(" ", lastSpace - 1);
        if (lastSpace === -1 || secondLastSpace === -1) continue;
        const type = header.slice(secondLastSpace + 1, lastSpace);
        const size = Number.parseInt(header.slice(lastSpace + 1), 10);
        if (!Number.isFinite(size) || size < 0) continue;
        const bodyEnd = offset + size;
        if (bodyEnd > buf.length) break;
        if (type === "blob") {
          contents.set(spec, decoder.decode(buf.subarray(offset, bodyEnd)));
        }
        offset = bodyEnd;
        // Each entry is followed by a single LF terminator.
        if (offset < buf.length && buf[offset] === 0x0a) offset += 1;
      }
      resolve({ contents });
    });

    // Stream specs in. `cat-file --batch` is line-oriented on input.
    const input = `${specs.join("\n")}\n`;
    child.stdin.end(input, "utf-8");
  });
}

/**
 * Resolve a ts-hotspots revrange to concrete shas.
 *
 *   - two-dot (`A..B`):  baseSha = rev-parse A, headSha = rev-parse B
 *   - three-dot (`A...B`): baseSha = merge-base(A, headSha), headSha = rev-parse B
 */
export async function resolveDiffEndpoints(
  cwd: string,
  baseRef: string,
  headRef: string,
  threeDot: boolean,
): Promise<{ baseSha: string; headSha: string }> {
  const headSha = await resolveSha(cwd, headRef);
  const baseSha = threeDot
    ? await mergeBaseSha(cwd, baseRef, headSha)
    : await resolveSha(cwd, baseRef);
  return { baseSha, headSha };
}
