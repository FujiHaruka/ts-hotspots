import { createHash } from "node:crypto";
import type { Node } from "ts-morph";

export function computeBodyHash(node: Node): string {
  return hashText(node.getText());
}

export function hashText(raw: string): string {
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const hex = createHash("sha256").update(stripped).digest("hex");
  return `sha256:${hex}`;
}
