import { defineConfig, devices } from "@playwright/test";

/**
 * Anchorflow Playwright config — reconciled to the real production runtime.
 *
 * Production serves the STANDALONE build (`node .next/standalone/server.js`,
 * port 3004) under PM2 as `anchor-norai`, reverse-proxied to
 * anchor.norai.tech. So the webServer builds once and then boots THAT SAME
 * standalone server with its static/public assets staged in — exactly what the
 * Dockerfile does — so e2e exercises the shipped artifact (CSP, worker
 * packaging, hydration), not a loose dev server.
 *
 * Overrides for local iteration only:
 *   - PW_DEV=1            → boot `next dev` instead (fast to start, but slow
 *                          first-compile here; use for quick debugging).
 *   - reuseExistingServer → if a 3004 server (dev or prod) is already up it is
 *                          adopted, so `npm run start && npm run test:e2e` runs
 *                          the production build with near-zero overhead.
 */
export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  // Serial execution: the workstation leans on worker debounce + font-load
  // timing that parallel workers on one server make flaky.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3004",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Standalone output must be packaged (public + .next/static staged in) the
    // same way the Dockerfile does, then served by the real server.js. PW_DEV=1
    // swaps to the dev server for quick local debugging.
    command: process.env.PW_DEV
      ? "npm run dev"
      : "npm run build && rm -rf .next/standalone/public .next/standalone/.next/static && cp -r public .next/standalone/public && cp -r .next/static .next/standalone/.next/static && PORT=3004 HOSTNAME=0.0.0.0 node .next/standalone/server.js",
    url: "http://127.0.0.1:3004",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
