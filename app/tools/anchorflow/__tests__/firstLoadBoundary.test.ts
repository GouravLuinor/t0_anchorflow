import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The First-Load-JS boundary (BAR §1 / §6 — ≤ 200 kB for `/tools/anchorflow`).
 *
 * Everything the workstation paints on first load is statically reachable from
 * the route entries below. That graph may NOT contain a runtime import of the
 * compute core — `_lib/analyze.ts` → `_lib/yamlParse.ts` → eemeli `yaml` — nor
 * of the resolver, because that is the heavy half of the payload and it buys
 * the FIRST paint nothing. The core is reached through exactly two boundaries:
 *
 *   · `_workers/compute.worker.ts` — a SEPARATE chunk the worker itself fetches
 *     (the happy path, and the ONLY place the compute lives by default);
 *   · `await import("../_lib/analyze")` inside `degradeToMainThread` — the
 *     degraded path, fetching the SAME pure core on demand. Degradation is
 *     rare, so it is never paid up front.
 *
 * The rule is therefore mechanical: no module in the first-load graph may name
 * a heavy specifier in a *runtime* import. `import type` is erased by the
 * compiler and carries no weight, so it stays legal — that is what lets
 * `_store` type-check against `WorkerOutputPayload` without dragging the core
 * into the client bundle.
 *
 * This is a graph walk over source, not a bundle measurement: it fails in
 * milliseconds on a PR, whereas the build only tells you afterwards.
 */

const ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const TOOL_DIR = fileURLToPath(new URL("../", import.meta.url));

/** The route entries the workstation's first load is built from. */
const ENTRIES = [
  path.join(ROOT, "app", "layout.tsx"),
  path.join(ROOT, "app", "page.tsx"),
  path.join(ROOT, "app", "tools", "anchorflow", "page.tsx"),
];

/** Specifiers no first-load module may import at runtime. */
const HEAVY = new Set([
  "analyze",
  "yamlParse",
  "compute",
  "refResolver",
  "yaml",
]);

const STORE_DIR = path.join(TOOL_DIR, "_store");

/** Strips block and line comments so doc prose can never look like code. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const RE_VALUE_IMPORT =
  /(?:^|\n)\s*(?:import|export)\s+(?!type\b)([^;]*?)from\s*["']([^"']+)["']/g;
const RE_SIDE_EFFECT = /(?:^|\n)\s*import\s*["']([^"']+)["']/g;
const RE_DYNAMIC = /(?:^|\n)\s*import\s*\(\s*["']([^"']+)["']\s*\)/g;

function resolveSpecifier(spec: string, fromFile: string): string | null {
  let base: string | null = null;
  if (spec.startsWith("@/")) {
    base = path.resolve(ROOT, spec.slice(2));
  } else if (spec.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), spec);
  }
  if (base === null) return null;
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.jsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

/** Module name as it appears in the HEAVY set, or null when light. */
function heavyName(spec: string, fromFile: string): string | null {
  if (HEAVY.has(spec)) return spec;
  const resolved = resolveSpecifier(spec, fromFile);
  if (resolved !== null) {
    const base = path.basename(resolved).replace(/\.(tsx?|jsx?)$/, "");
    if (HEAVY.has(base)) return base;
  }
  return null;
}

interface Edge {
  from: string;
  spec: string;
  line: number;
  fromLine: number;
}

function graph(entries: string[]): { files: string[]; edges: Edge[] } {
  const seen = new Set<string>();
  const edges: Edge[] = [];
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.shift();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    const source = stripComments(readFileSync(file, "utf8"));
    const specs: Array<[string, number]> = [];
    for (const match of source.matchAll(RE_VALUE_IMPORT)) {
      specs.push([match[2], source.slice(0, match.index).split("\n").length]);
    }
    for (const match of source.matchAll(RE_SIDE_EFFECT)) {
      specs.push([match[1], source.slice(0, match.index).split("\n").length]);
    }
    for (const [spec, line] of specs) {
      const resolved = resolveSpecifier(spec, file);
      if (resolved === null) continue;
      edges.push({ from: file, spec, line, fromLine: line });
      queue.push(resolved);
    }
  }
  return { files: [...seen].sort(), edges };
}

const rel = (file: string) => path.relative(ROOT, file);
const firstLoad = graph(ENTRIES);

describe("First-Load-JS boundary — the heavy core never rides the first paint", () => {
  it("walks the graph it claims to walk", () => {
    // The walk must actually reach the workstation hook and the store, or the
    // assertions below would pass by finding nothing at all.
    const reachable = firstLoad.files.map(rel);
    expect(reachable.length).toBeGreaterThan(10);
    expect(reachable).toContain("app/tools/anchorflow/_hooks/useToolWorker.ts");
    expect(reachable).toContain("app/tools/anchorflow/_store/useToolStore.ts");
    expect(reachable).toContain("components/ui/toast.tsx");
    // The worker is its OWN chunk and must not be part of the walk — it is
    // fetched by the worker, not by the route.
    expect(reachable).not.toContain(
      "app/tools/anchorflow/_workers/compute.worker.ts"
    );
  });

  it("no first-load module statically imports the compute core or its parser", () => {
    const violations = firstLoad.edges
      .map((edge) => ({ ...edge, heavy: heavyName(edge.spec, edge.from) }))
      .filter((edge) => edge.heavy !== null)
      .map(
        (edge) =>
          `${rel(edge.from)}:${edge.line} statically imports "${edge.spec}"`
      );
    expect(violations).toEqual([]);
  });

  it("no first-load module statically imports the eemeli yaml package", () => {
    const direct = firstLoad.edges
      .filter((edge) => edge.spec === "yaml")
      .map((edge) => `${rel(edge.from)}:${edge.line} imports "yaml"`);
    expect(direct).toEqual([]);
  });

  it("framer-motion is not statically reachable from first load either", () => {
    // The toast animation runtime is ~40 kB gz for a chunk that only ever
    // appears after a copy failure.
    const framer = firstLoad.files.filter((file) => {
      try {
        return /from\s+["']framer-motion["']/.test(readFileSync(file, "utf8"));
      } catch {
        return false;
      }
    });
    expect(framer.map(rel)).toEqual([]);
  });

  it("the store reaches _lib for TYPES only, never the compute core", () => {
    for (const file of [
      path.join(STORE_DIR, "useToolStore.ts"),
      path.join(STORE_DIR, "useAuthPromptStore.ts"),
    ]) {
      const source = stripComments(readFileSync(file, "utf8"));
      // Every `_lib` runtime import must be one of the weightless seed modules;
      // `_lib/analyze` (and friends) may only be named via `import type`.
      const runtime = [...source.matchAll(RE_VALUE_IMPORT)]
        .filter((match) => match[1].startsWith("../_lib/"))
        .map((match) => match[2]);
      for (const spec of runtime) {
        expect(HEAVY.has(path.basename(spec))).toBe(false);
      }
      for (const match of source.matchAll(RE_VALUE_IMPORT)) {
        if (!match[2].startsWith("../_lib/")) continue;
        const resolved = resolveSpecifier(match[2], file);
        expect(resolved).toBe(path
          .resolve(TOOL_DIR, "_lib", match[2].replace("../_lib/", "") + ".ts"));
      }
      // Type imports stay type imports.
      expect(source).not.toMatch(
        /import\s+(?!type\b)[^;]*(?:analyze|yamlParse|compute|refResolver)[^;]*from\s*["']\.\.\/_lib\//
      );
    }
  });
});

describe("the two boundaries that DO carry the core", () => {
  it("the worker statically imports the pure core — the happy path owns it", () => {
    const worker = path.join(
      TOOL_DIR,
      "_workers",
      "compute.worker.ts"
    );
    const source = stripComments(readFileSync(worker, "utf8"));
    for (const spec of ["../_lib/analyze", "../_lib/compute"]) {
      expect(source).toMatch(
        new RegExp(`from\\s*["']${spec.replace(/\//g, "\\/")}["']`)
      );
    }
  });

  it("the main-thread fallback fetches the SAME core dynamically", () => {
    const hook = path.join(TOOL_DIR, "_hooks", "useToolWorker.ts");
    const source = stripComments(readFileSync(hook, "utf8"));
    const dynamic = [...source.matchAll(RE_DYNAMIC)].map((match) => match[1]);
    expect(dynamic).toContain("../_lib/analyze");
    expect(dynamic).toContain("../_lib/compute");
  });
});
