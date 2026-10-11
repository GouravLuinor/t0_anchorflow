import { expect, test, type Page, type Route } from "@playwright/test";
import { RECORDED } from "../app/tools/anchorflow/_lib/__tests__/fixtures";

/**
 * The resolver JOURNEY — the D3 slice end to end (SPEC §9 AC-4 · AC-5 ·
 * AC-12 · AC-15).
 *
 * Everything external is served by `page.route` from the SAME recorded
 * fixtures the hermetic oracle replays (`_lib/__tests__/fixtures/*.json`), so
 * this journey is deterministic in CI with no live calls, and it proves:
 *
 *   · "Resolve & pin" paints PINNED SHAs into the rewritten YAML, preserving
 *     the author's `# vX` comments byte-for-byte (AC-3);
 *   · the receipts render `<endpoint> → <tag-object-sha> → <commit-sha>`
 *     across BOTH hops of an annotated tag (AC-4);
 *   · the ONLY external URLs are `api.github.com`, and each one carries only
 *     `owner/repo[/subpath]` + the ref — no query, no fragment (AC-12);
 *   · the budget ledger posts back and the rate-limit banner stays silent on
 *     a healthy window;
 *   · autoResolve OFF means first paint makes ZERO external requests (AC-12).
 */

const ROUTE = "/tools/anchorflow";
const READY_TIMEOUT = 15_000;

/** Every external URL the page requested, in call order. */
function trackExternal(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.origin === "http://127.0.0.1:3004" || url.origin === "http://localhost:3004") return;
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    seen.push(request.url());
  });
  return seen;
}

/** Serves the recorded cassette. Unknown paths 404 like GitHub would. */
async function serveCassette(page: Page): Promise<string[]> {
  const calls: string[] = [];
  await page.route("**/api.github.com/**", async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push(request.url());
    const fixture = RECORDED[url.pathname]?.response;
    if (!fixture) {
      await route.fulfill({
        status: 404,
        contentType: "application/json",
        body: JSON.stringify({ message: "Not Found" }),
      });
      return;
    }
    await route.fulfill({
      status: fixture.status,
      contentType: "application/json",
      headers: fixture.headers,
      body: JSON.stringify(fixture.body),
    });
  });
  return calls;
}

async function gotoReady(page: Page) {
  await page.goto(ROUTE, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#tool-source-input")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
  await expect(page.getByTestId("diagnostic-echo")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

const SAMPLE = `name: release

on:
  push:
    branches: [main]

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4 # v4
        with:
          ref: main
      - uses: actions/setup-node@v4.2.0
      - run: npm ci
`;

test.describe("Resolve & pin", () => {
  test("pins the workflow to SHAs and paints both receipt hops", async ({ page }) => {
    const external = trackExternal(page);
    const calls = await serveCassette(page);
    await gotoReady(page);

    // Zero external requests before the user asks (AC-12, the default path).
    await expect(page.getByTestId("rate-limit-banner")).toHaveCount(0);
    await expect(page.getByTestId("receipt-list")).toHaveCount(0);
    expect(external, "first paint must be hermetic").toEqual([]);

    await page.locator("#tool-source-input").fill(SAMPLE);
    await expect(page.getByTestId("resolve-pin-button")).toBeEnabled();
    await page.getByTestId("resolve-pin-button").click();

    // ── the pinned YAML repaints ──────────────────────────────────────────
    const echo = page.getByTestId("diagnostic-echo");
    await expect(echo).toContainText(
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262"
    );
    // The author's own comment survives the pin, and the pin label follows it.
    await expect(echo).toContainText(
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4"
    );
    await expect(echo).toContainText(
      "actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.2.0"
    );
    await expect(echo).toContainText("- run: npm ci");

    // ── the diff populates ───────────────────────────────────────────────
    const changed = page.getByTestId("diff-changed-count");
    await expect(changed).toContainText("2 changes");

    // ── the receipts: one block per remote ref, in call order ─────────────
    const items = page.getByTestId("receipt-item");
    await expect(items).toHaveCount(2);

    const checkout = items.filter({ hasText: "actions/checkout@v4" }).first();
    await expect(checkout).toHaveAttribute("data-status", "resolved");
    await expect(checkout.getByTestId("receipt-chain")).toContainText(
      "GET /repos/actions/checkout/git/ref/tags/v4 → 11d5960a3267… (200)"
    );
    // The FULL sha is quoted below the chain, copy-ready.
    await expect(checkout).toContainText(
      "11d5960a326750d5838078e36cf38b85af677262"
    );
    await expect(checkout.getByTestId("receipt-resolved-at")).toContainText(
      /resolvedAt \d{4}-\d{2}-\d{2}T/
    );
    await expect(checkout).toContainText(
      "The pinned SHA is a point-in-time snapshot"
    );

    // ── the budget ledger posted back, so no banner on a healthy window ───
    await expect(page.getByTestId("rate-limit-banner")).toHaveCount(0);

    // ── AC-12: the ONLY egress is api.github.com, path-shaped only ───────
    expect(calls.length).toBeGreaterThan(0);
    const SHAPE =
      /^\/repos\/[^/]+\/[^/]+\/git\/(ref\/(tags|heads)\/[^?#]+|tags\/[0-9a-f]{40})$/;
    for (const url of external) {
      const parsed = new URL(url);
      expect(parsed.origin).toBe("https://api.github.com");
      expect(parsed.search).toBe("");
      expect(parsed.hash).toBe("");
      expect(SHAPE.test(parsed.pathname), url).toBe(true);
    }
  });

  test("pins an annotated tag through BOTH hops", async ({ page }) => {
    await serveCassette(page);
    await gotoReady(page);

    await page.locator("#tool-source-input").fill(`name: ci

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: pnpm/pnpm@v9.12.0
`);
    await page.getByTestId("resolve-pin-button").click();

    const item = page
      .getByTestId("receipt-item")
      .filter({ hasText: "pnpm/pnpm@v9.12.0" })
      .first();
    await expect(item).toHaveAttribute("data-status", "resolved");
    // BOTH hops: the tag ref names the TAG OBJECT, the deref names the COMMIT.
    await expect(item.getByTestId("receipt-chain")).toContainText(
      "GET /repos/pnpm/pnpm/git/ref/tags/v9.12.0 → 85b44e09fb09… (200)"
    );
    await expect(item.getByTestId("receipt-chain")).toContainText(
      "GET /repos/pnpm/pnpm/git/tags/85b44e09fb0988e3e307fa59de1cf79a525b51e9 → fc7eed08c5d2… (200)"
    );
    await expect(item).toContainText(
      "85b44e09fb0988e3e307fa59de1cf79a525b51e9"
    );
    await expect(item).toContainText(
      "fc7eed08c5d25b7e7349863bec0e43dca4247cd0"
    );
    // The pin is the COMMIT, never the tag object.
    await expect(page.getByTestId("diagnostic-echo")).toContainText(
      "pnpm/pnpm@fc7eed08c5d25b7e7349863bec0e43dca4247cd0"
    );
  });

  test("resolves a branch through the tag→heads fallback", async ({ page }) => {
    const calls = await serveCassette(page);
    await gotoReady(page);

    await page.locator("#tool-source-input").fill(`name: ci

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@main
`);
    await page.getByTestId("resolve-pin-button").click();

    const item = page.getByTestId("receipt-item").first();
    await expect(item).toHaveAttribute("data-status", "resolved");
    await expect(item).toContainText("f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a");
    // Both namespaces were tried, in order.
    await expect(item.getByTestId("receipt-chain")).toContainText(
      "GET /repos/actions/checkout/git/ref/tags/main"
    );
    await expect(item.getByTestId("receipt-chain")).toContainText(
      "GET /repos/actions/checkout/git/ref/heads/main"
    );
    expect(calls.map((url) => new URL(url).pathname)).toEqual([
      "/repos/actions/checkout/git/ref/tags/main",
      "/repos/actions/checkout/git/ref/heads/main",
    ]);
  });

  test("marks an unknown ref without touching the offline report", async ({ page }) => {
    await serveCassette(page);
    await gotoReady(page);

    await page.locator("#tool-source-input").fill(`name: ci

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: pnpm/pnpm@v9.12.0-does-not-exist
`);
    await page.getByTestId("resolve-pin-button").click();

    const item = page.getByTestId("receipt-item").first();
    await expect(item).toHaveAttribute("data-status", "unknown-ref");
    await expect(item).toContainText("offline report above is still complete");
    // The finding carries the same friendly copy (ARCH §8).
    await expect(
      page.getByTestId("finding-item").filter({ hasText: "unknown ref" }).first()
    ).toContainText("offline report above is still complete");
    // The source is left untouched — an unknown ref is never pinned.
    await expect(page.getByTestId("diagnostic-echo")).toContainText(
      "pnpm/pnpm@v9.12.0-does-not-exist"
    );
    await expect(page.getByTestId("diff-changed-count")).toContainText(
      "0 changes"
    );
  });

  test("re-pinning the tool's own output is a zero-diff", async ({ page }) => {
    await serveCassette(page);
    await gotoReady(page);

    await page.locator("#tool-source-input").fill(SAMPLE);
    await page.getByTestId("resolve-pin-button").click();
    await expect(page.getByTestId("diff-changed-count")).toContainText(
      "2 changes"
    );
    // The PINNED workflow, read straight out of the pane.
    const pinned = await page.getByTestId("diagnostic-echo").innerText();
    expect(pinned).toContain(
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4"
    );

    // Feed the tool its own output: every ref is now a 40-hex pin, so there is
    // nothing left to resolve and the rewrite is a byte-identical NO-OP.
    await page.locator("#tool-source-input").fill(pinned);
    await expect(page.getByTestId("diff-changed-count")).toContainText(
      "0 changes"
    );
    // Nothing to spend quota on, so the action disables itself.
    await expect(page.getByTestId("resolve-pin-button")).toBeDisabled();
    await expect(page.getByTestId("receipt-list")).toHaveCount(0);
    // And the echo is exactly the pinned text that went in.
    await expect(page.getByTestId("diagnostic-echo")).toContainText(
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4"
    );
  });

  test("the copied YAML is the PINNED workflow", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await serveCassette(page);
    await gotoReady(page);

    await page.locator("#tool-source-input").fill(SAMPLE);
    await page.getByTestId("resolve-pin-button").click();
    await expect(page.getByTestId("diagnostic-echo")).toContainText(
      "11d5960a326750d5838078e36cf38b85af677262"
    );

    await page.getByRole("button", { name: /^copy$/i }).click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(
      "actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4"
    );
    expect(copied).toContain("actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.2.0");
  });

  test("surfaces a rate-limited window with the friendly banner", async ({ page }) => {
    await page.route("**/api.github.com/**", async (route) => {
      await route.fulfill({
        status: 403,
        contentType: "application/json",
        headers: {
          // CORS: a browser only lets JS read the headers a cross-origin
          // response explicitly exposes, exactly as api.github.com does.
          "access-control-allow-origin": "*",
          "access-control-expose-headers":
            "Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Used, X-RateLimit-Resource, X-RateLimit-Reset",
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": String(Math.floor(Date.now() / 1000) + 3600),
          "x-ratelimit-resource": "core",
        },
        body: JSON.stringify({ message: "API rate limit exceeded" }),
      });
    });
    await gotoReady(page);

    await page.locator("#tool-source-input").fill(SAMPLE);
    await page.getByTestId("resolve-pin-button").click();

    const banner = page.getByTestId("rate-limit-banner");
    await expect(banner).toHaveAttribute("data-remaining", "0");
    await expect(banner).toContainText("hourly API limit is reached");
    await expect(banner).toContainText(
      "The offline report above is still complete"
    );
    await expect(banner).toContainText("0 of 60 left");
    // The offline report is intact.
    await expect(page.getByTestId("diagnostic-echo")).toContainText(
      "actions/checkout@v4 # v4"
    );
    await expect(page.getByTestId("receipt-item").first()).toHaveAttribute(
      "data-status",
      "rate-limited"
    );
  });
});
