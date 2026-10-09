import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

test("guardian source does not persist or log private material", () => {
  const appFiles = sourceFiles(resolve(repositoryRoot, "frontend/src"));
  const backendFiles = sourceFiles(resolve(repositoryRoot, "backend/src"));
  const source = [...appFiles, ...backendFiles].map((path) => readFileSync(path, "utf8")).join("\n");

  assert.doesNotMatch(source, /\b(?:localStorage|sessionStorage|indexedDB)\b/i);
  assert.doesNotMatch(source, /console\.(?:log|debug|info|warn|error)\s*\([^\n]*(?:secretKey|seedText|guardian\.current)/i);
});
