import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const MODULE = join(import.meta.dirname, "exitAfterFlush.ts");
const PAYLOAD_BYTES = 1024 * 1024;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ts-hotspots-exit-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function writeScript(body: string): string {
  const path = join(dir, "script.ts");
  writeFileSync(
    path,
    `import { exitAfterFlush, exitQuietlyOnClosedPipe } from ${JSON.stringify(MODULE)};\n${body}\n`,
  );
  return path;
}

interface ChildResult {
  code: number | null;
  stdoutBytes: number;
  stderr: string;
}

function runChild(
  script: string,
  closeStdoutAfterFirstChunk = false,
): Promise<ChildResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdoutBytes = 0;
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (closeStdoutAfterFirstChunk) child.stdout.destroy();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdoutBytes, stderr });
    });
  });
}

describe("exitAfterFlush", () => {
  test("delivers all piped stdout before exiting with the given code", async () => {
    const script = writeScript(
      `process.stdout.write("x".repeat(${String(PAYLOAD_BYTES)}));\nawait exitAfterFlush(3);`,
    );
    const result = await runChild(script);
    expect(result.stdoutBytes).toBe(PAYLOAD_BYTES);
    expect(result.code).toBe(3);
  });

  test("a reader closing the pipe early ends the process quietly", async () => {
    const script = writeScript(
      `exitQuietlyOnClosedPipe(process.stdout);\nfor (let i = 0; i < 64; i++) process.stdout.write("x".repeat(${String(PAYLOAD_BYTES)}));\nawait new Promise((r) => setTimeout(r, 5000));\nawait exitAfterFlush(0);`,
    );
    const result = await runChild(script, true);
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
  });
});
