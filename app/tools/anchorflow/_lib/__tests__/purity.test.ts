import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * `_lib` is IO-free (BAR §4.7 · SPEC §9 AC-16). Two scopes:
 *
 *   NETWORK — every module: `_lib` never issues a request. The worker and the
 *   main-thread fallback each supply `fetch` at their own boundary, which is
 *   also the test seam, so no `_lib` file may name it.
 *
 *   DOM / REACT — every COMPUTE module: no `document`, no `window`, no
 *   `localStorage`, no React import. That is what lets one core serve both
 *   compute paths and what makes the unit suites possible.
 *
 *   `authGate.ts` is the single documented exemption: its `bumpSessionCount`
 *   reads/writes `window.localStorage` inside try/catch so a degraded store
 *   degrades gracefully (BAR §5.3), and its policy half is pure. Its
 *   window/storage paths are covered by `authGate.test.ts` with an in-memory
 *   stub, so the exemption is tested rather than assumed.
 */
const LIB_DIR = fileURLToPath(new URL("..", import.meta.url));
const DOM_EXEMPT = new Set(["authGate.ts"]);

function collectSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      files.push(...collectSources(full));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) files.push(full);
  }
  return files;
}

const files = collectSources(LIB_DIR);
const names = files.map((file) => path.basename(file));
const computeFiles = files.filter(
  (file) => !DOM_EXEMPT.has(path.basename(file))
);

describe("_lib purity — no IO, no DOM, no React", () => {
  it("finds the modules it claims to scan", () => {
    expect(names).toContain("analyze.ts");
    expect(names).toContain("types.ts");
    expect(names).toContain("constants.ts");
    expect(names).toContain("compute.ts");
    expect(names).toContain("protocol.ts");
    expect(names).toContain("authGate.ts");
  });

  it.each(files.map((file) => path.basename(file)))(
    "%s never issues a network call",
    (name) => {
      const source = readFileSync(path.join(LIB_DIR, name), "utf8");
      expect(source, `${name} must not call globalThis.fetch`).not.toMatch(
        /globalThis\s*\.\s*fetch/
      );
      // No bare `fetch(` call — `fetchImpl` / `FetchLike` identifiers are fine.
      expect(source, `${name} must not call fetch(...)`).not.toMatch(
        /(?<![A-Za-z$.])fetch\s*\(/
      );
      expect(source, `${name} must not use XMLHttpRequest`).not.toMatch(
        /XMLHttpRequest/
      );
      expect(source, `${name} must not use WebSocket`).not.toMatch(/WebSocket/);
    }
  );

  it.each(computeFiles.map((file) => path.basename(file)))(
    "%s never touches the DOM",
    (name) => {
      const source = readFileSync(path.join(LIB_DIR, name), "utf8");
      expect(source, `${name} must not use document`).not.toMatch(
        /\bdocument\s*\./
      );
      expect(source, `${name} must not use window`).not.toMatch(/\bwindow\s*\./);
      expect(source, `${name} must not use localStorage`).not.toMatch(
        /localStorage/
      );
      expect(source, `${name} must not import React`).not.toMatch(
        /from\s+["']react["']/
      );
    }
  );

  it("types.ts has zero runtime imports", () => {
    const source = readFileSync(path.join(LIB_DIR, "types.ts"), "utf8");
    expect(source).not.toMatch(/^import\s+[^t]/m);
    expect(source).not.toMatch(/\bfrom\s+["']/);
  });
});
