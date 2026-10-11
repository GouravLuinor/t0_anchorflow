import { defineConfig } from "vitest/config";
import path from "node:path";

/**
 * Anchorflow vitest config.
 *
 * Coverage is scoped to the PURE CORE (`app/tools/anchorflow/_lib`) and gated
 * — the beat-the-bar §9(d) thresholds, adopted from SchemaCraft: functions
 * ≥ 90, lines/statements ≥ 80, branches ≥ 70. The thresholds are real gates:
 * `npm run test:coverage` exits non-zero below them, and CI runs it (see
 * `.github/workflows/ci.yml`).
 *
 * What is deliberately OUTSIDE the gate, and why (honest scoping, never faked
 * numbers):
 *   · the `__tests__` folder under `_lib` — test code and fixtures are not
 *     product code;
 *   · `_lib/supabaseClient.ts` — the env-gated lazy SDK seam: its bodies are
 *     null-guards that only run when keys are present, so a unit run can never
 *     reach them (covered indirectly by the e2e no-op journey);
 *   · `_lib/presets.ts` and `_lib/guide.ts` — content data, not logic;
 *   · `_lib/constants.ts` — a file of exported constants, asserted by its own
 *     grep suite rather than by line coverage.
 */
export default defineConfig({
  test: {
    include: ["**/__tests__/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary"],
      // The pure core only — the boundary the bar measures.
      include: ["app/tools/anchorflow/_lib/**/*.ts"],
      exclude: [
        "app/tools/anchorflow/_lib/**/__tests__/**",
        "app/tools/anchorflow/_lib/supabaseClient.ts",
        "app/tools/anchorflow/_lib/presets.ts",
        "app/tools/anchorflow/_lib/guide.ts",
        "app/tools/anchorflow/_lib/constants.ts",
      ],
      thresholds: {
        functions: 90,
        lines: 80,
        statements: 80,
        branches: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
