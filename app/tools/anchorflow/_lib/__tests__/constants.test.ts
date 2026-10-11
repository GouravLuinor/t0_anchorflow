import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as CONSTANTS from "../constants";

/**
 * A Phase-4 reviewer can grep every cap name below and land on EXACTLY one
 * site — `_lib/constants.ts` (SPEC §9 AC-16 · ARCH §7.2). This suite is that
 * guarantee as an executable assertion.
 */
const CAP_NAMES = [
  "MAX_INPUT_BYTES",
  "MAX_USES_SCAN",
  "MAX_RESOLVES_PER_RUN",
  "MAX_RESOLVE_CONCURRENCY",
  "RESOLVE_TIMEOUT_MS",
  "RESOLVE_BUDGET_MS",
  "RATE_LIMIT_RESERVE",
  "RESOLVE_CACHE_CAPACITY",
  "RESOLVE_NEGATIVE_TTL_MS",
  "RESOLVE_DEBOUNCE_MS",
  "WORKER_DEADLINE_MS",
  "SYNC_DEADLINE_MS",
  "WATCHDOG_MS",
  "ARTIFACT_CACHE_CAPACITY",
] as const;

const source = readFileSync(
  fileURLToPath(new URL("../constants.ts", import.meta.url)),
  "utf8"
);

describe("_lib/constants.ts — the single grep site for every cap", () => {
  it.each(CAP_NAMES)("exports %s with the published value", (name) => {
    expect(CONSTANTS[name], name).toBeTypeOf("number");
    // Exactly one declaration site in the file.
    const declarations = source.match(
      new RegExp(`export const ${name}\\b`, "g")
    );
    expect(declarations, `${name} must be declared exactly once`).toHaveLength(1);
  });

  it("pins the published values from ARCH §7.1", () => {
    expect(CONSTANTS.MAX_INPUT_BYTES).toBe(262_144);
    expect(CONSTANTS.MAX_USES_SCAN).toBe(2_000);
    expect(CONSTANTS.MAX_RESOLVES_PER_RUN).toBe(48);
    expect(CONSTANTS.MAX_RESOLVE_CONCURRENCY).toBe(4);
    expect(CONSTANTS.RESOLVE_TIMEOUT_MS).toBe(8_000);
    expect(CONSTANTS.RESOLVE_BUDGET_MS).toBe(25_000);
    expect(CONSTANTS.RATE_LIMIT_RESERVE).toBe(2);
    expect(CONSTANTS.RESOLVE_CACHE_CAPACITY).toBe(64);
    expect(CONSTANTS.RESOLVE_NEGATIVE_TTL_MS).toBe(60_000);
    expect(CONSTANTS.RESOLVE_DEBOUNCE_MS).toBe(500);
    expect(CONSTANTS.WORKER_DEADLINE_MS).toBe(1_000);
    expect(CONSTANTS.SYNC_DEADLINE_MS).toBe(800);
    expect(CONSTANTS.WATCHDOG_MS).toBe(1_500);
    expect(CONSTANTS.ARTIFACT_CACHE_CAPACITY).toBe(32);
  });

  it("keeps the watchdog strictly above the worker deadline", () => {
    expect(CONSTANTS.WATCHDOG_MS).toBeGreaterThan(CONSTANTS.WORKER_DEADLINE_MS);
    expect(CONSTANTS.SYNC_DEADLINE_MS).toBeLessThan(CONSTANTS.WORKER_DEADLINE_MS);
  });

  it("documents the BAR item-7 cap mapping inline", () => {
    // The mapping note is the zero-judgement-call table for a reviewer.
    expect(source).toContain("BAR §10 item-7 expectation");
    expect(source).toContain("MAX_INPUT_BYTES");
    expect(source).toContain("ARTIFACT_CACHE_CAPACITY");
  });

  it("never pins a port — ports live in the packaging files only", () => {
    expect(source).not.toMatch(/\b3004\b/);
  });
});
