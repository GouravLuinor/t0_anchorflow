/**
 * Phase-A benchmark — the pure offline core, `analyzeLocal` (SPEC §9 AC-11).
 *
 * Run it: `npm run bench`. It prints the input size of each case, the
 * median / p95 / max wall-clock over N runs, the machine it ran on, and the
 * margin against `WATCHDOG_MS` (1,500 ms). `BENCHMARKS.md` records the numbers
 * THIS script printed on the machine it names — the bar wants a re-runnable
 * command, not an aspirational table.
 *
 * Dependency-light on purpose (tsx + node): the script imports the pure core
 * directly, so nothing in the measurement depends on the UI, the worker
 * packaging or a browser.
 *
 *   npm run bench                       timings + the nested-flow memory probe
 *   npm run bench -- --memory flat      one memory case, as a clean process
 *   npm run bench -- --memory nested    the other, likewise
 */

import { execFileSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { ANALYZE_TIMEOUT_ERROR, MAX_INPUT_BYTES, WATCHDOG_MS } from "../app/tools/anchorflow/_lib/constants";
import { analyzeLocal } from "../app/tools/anchorflow/_lib/analyze";

/** Runs of the timing loop per case; one warm-up run is discarded. */
const RUNS = 50;

/** The memory probe's shared byte budget, kept safely under the input cap. */
const MEMORY_BYTES = MAX_INPUT_BYTES - 8_192;
/** Jobs that fill that budget when every step is a flat action line. */
const MEMORY_JOBS = 264;

const bytesOf = (text: string) => new TextEncoder().encode(text).length;

/**
 * A realistic workflow: N jobs × M steps, mixing actions, `with:` inputs,
 * untrusted interpolations and shell steps — the structures a real monorepo CI
 * file gives the parser.
 */
function workflow(jobs: number, stepsPerJob: number): string {
  const lines = ["name: bench", "", "on:", "  push:", "    branches: [main]", ""];
  lines.push("permissions:", "  contents: read", "");
  lines.push("jobs:");
  for (let j = 0; j < jobs; j += 1) {
    lines.push(`  build-${j}:`, "    runs-on: ubuntu-latest", "    steps:");
    for (let s = 0; s < stepsPerJob; s += 1) {
      lines.push("      - uses: actions/checkout@v4");
      lines.push("        with:");
      lines.push("          ref: ${{ github.event.pull_request.head.sha }}");
      lines.push("      - uses: actions/setup-node@v4.2.0");
      lines.push("        with:");
      lines.push("          node-version: 20");
      lines.push(`      - run: echo "step ${s}" && npm ci && npm test`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** The same byte budget spent as one deeply nested flow mapping. */
function nestedFlow(targetBytes: number): string {
  const lines = [
    "name: nested",
    "on: [push]",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "        with:",
    "          flow:",
  ];
  let depth = 0;
  while (bytesOf(lines.join("\n")) < targetBytes) {
    depth += 1;
    lines.push(
      `            d${depth}: { a: { b: { c: { d: { e: { f: { g: ${
        depth % 2 ? "1" : "'str'"
      } } } } } } } }`
    );
  }
  return lines.join("\n");
}

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    max: sorted[sorted.length - 1],
  };
}

function report(label: string, source: string, samples: number[]): void {
  const { median, p95, max } = stats(samples);
  const analysed = analyzeLocal(source);
  console.log(
    [
      label.padEnd(24),
      `${source.split("\n").length - 1} lines`.padEnd(12),
      `${bytesOf(source)} B`.padEnd(12),
      `median ${median.toFixed(3)} ms`.padEnd(21),
      `p95 ${p95.toFixed(3)} ms`.padEnd(18),
      `max ${max.toFixed(3)} ms`.padEnd(17),
      `watchdog margin ${(WATCHDOG_MS / max).toFixed(1)}x`,
      analysed.metrics.truncated
        ? `(${bytesOf(source)} B in → analysed at the ${MAX_INPUT_BYTES} B cap)`
        : "",
    ]
      .filter(Boolean)
      .join(" · ")
  );
}

function bench(label: string, source: string): void {
  analyzeLocal(source); // warm the module + the JIT before measuring
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i += 1) {
    const t0 = performance.now();
    analyzeLocal(source);
    samples.push(performance.now() - t0);
  }
  report(label, source, samples);
}

/**
 * The nested-flow memory probe, one shape per CLEAN PROCESS: a shared heap
 * measures the previous case as much as the current one, so each shape is
 * spawned as its own node process and reports its own heap / RSS after one
 * parse of a budget-sized input.
 */
function memoryProbe(): void {
  const self = process.execPath;
  const script = process.argv[1];

  console.log("");
  console.log(
    "Memory probe — the SAME byte budget, two shapes, one clean process each:"
  );
  for (const shape of ["flat", "nested"] as const) {
    const out = execFileSync(self, ["--import", "tsx", script, "--memory", shape], {
      encoding: "utf8",
      env: { ...process.env },
    });
    process.stdout.write(out);
  }
  console.log(
    "The nested case spends the same bytes on a far deeper Document tree\n" +
      "(pairs inside pairs inside pairs), so its heap cost per byte is higher —\n" +
      "that is the amplification this probe exists to make visible."
  );
}

function memoryCase(shape: "flat" | "nested"): void {
  // Both cases fill the input budget and are NOT sliced: a slice cuts the YAML
  // mid-structure, which would turn the comparison into a parse-error
  // comparison instead of a shape comparison.
  const source =
    shape === "flat" ? workflow(MEMORY_JOBS, 4) : nestedFlow(MEMORY_BYTES);
  const before = process.memoryUsage().heapUsed;
  const result = analyzeLocal(source);
  const after = process.memoryUsage();
  console.log(
    `  ${shape === "flat" ? "flat workflow          " : "nested flow mappings   "}: ` +
      `${(bytesOf(source) / 1024).toFixed(0)} KiB in · parsed=${result.ok} · ` +
      `heap +${((after.heapUsed - before) / 1024 / 1024).toFixed(1)} MiB · ` +
      `rss ${(after.rss / 1024 / 1024).toFixed(1)} MiB`
  );
}

// ── entry point ──────────────────────────────────────────────────────────────
const memoryFlag = process.argv.indexOf("--memory");
if (memoryFlag !== -1) {
  memoryCase(process.argv[memoryFlag + 1] as "flat" | "nested");
} else {
  console.log("Anchorflow — Phase-A benchmark (analyzeLocal)");
  console.log(
    `node ${process.version} · ${process.platform}/${process.arch} · ` +
      `${process.env.npm_config_user_agent ?? "npm"}`
  );
  console.log(`n = ${RUNS} runs per case (1 warm-up run discarded)\n`);

  // ~1,000 lines / ~33 KiB.
  bench("1,000-line workflow", workflow(31, 4));
  // ~5,000 lines / ~167 KiB — still under the cap, so nothing is trimmed.
  bench("5,000-line workflow", workflow(155, 4));
  // Oversize: 3x the input cap, so the cap bites and the original size is
  // still reported.
  bench("oversize (3x cap)", workflow(83, 40));

  memoryProbe();

  console.log(`\nWatchdog: WATCHDOG_MS = ${WATCHDOG_MS} (Phase A only)`);
  console.log(`Friendly verdict it settles: "${ANALYZE_TIMEOUT_ERROR}"`);
}
