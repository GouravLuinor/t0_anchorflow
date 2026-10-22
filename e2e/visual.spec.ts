import { test, expect, type Page } from "@playwright/test";

/**
 * Responsive structure + zero-egress guards — NON-BRITTLE.
 *
 * Pixel baselines are deliberately not pinned here: a human must regenerate
 * them against the built page (`npx playwright test e2e/visual.spec.ts
 * --update-snapshots`) before they are enabled. Per policy this suite is
 * GREEN or SKIPPED — never RED on stale goldens.
 *
 * The checks that ARE active are structural and contractual:
 *   · no horizontal overflow at 390px and 1440px (BAR §2.2);
 *   · the workstation (editor | certified copy) stacks to one column below `lg`;
 *   · ZERO external requests on the default path (autoResolve defaults false,
 *     so first paint is hermetic — SPEC §9 AC-12);
 *   · zero uncaught page errors.
 */

const ROUTE = "/tools/anchorflow";
const READY_TIMEOUT = 15_000;

async function gotoReady(page: Page) {
  await page.goto(ROUTE, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#tool-source-input")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
  // Let the first worker result settle so the panes are at full height (the
  // pinned-file view is a force-mounted tab, so wait on its text).
  await expect(page.getByTestId("diagnostic-echo")).toContainText("name: ci", {
    timeout: READY_TIMEOUT,
  });
}

/** Assert the document never scrolls horizontally (tolerant epsilon). */
async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  // 2px epsilon absorbs sub-pixel scrollbar/rounding noise.
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth + 2);
}

test.describe("Anchorflow responsive structure", () => {
  test("no horizontal overflow at mobile 390 and the workstation renders", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoReady(page);

    await expectNoHorizontalOverflow(page);
    await expect(page.locator("#workstation")).toBeVisible();
  });

  test("no horizontal overflow at desktop 1440 and the workstation renders", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoReady(page);

    await expectNoHorizontalOverflow(page);
    await expect(page.locator("#workstation")).toBeVisible();
  });

  test("the two panes stack below lg and sit side by side at lg", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoReady(page);

    const copyPane = page.locator('section[aria-label="Certified copy"]');
    const editor = await page.locator("#tool-source-input").boundingBox();
    const echo = await copyPane.boundingBox();
    expect(editor).not.toBeNull();
    expect(echo).not.toBeNull();
    // Stacked: the certified copy starts below the editor's bottom edge.
    expect(echo!.y).toBeGreaterThanOrEqual(editor!.y + editor!.height - 8);

    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoReady(page);
    const wideEditor = await page.locator("#tool-source-input").boundingBox();
    const wideEcho = await copyPane.boundingBox();
    expect(wideEditor).not.toBeNull();
    expect(wideEcho).not.toBeNull();
    // Side by side: the certified copy starts to the RIGHT of the editor.
    expect(wideEcho!.x).toBeGreaterThanOrEqual(
      wideEditor!.x + wideEditor!.width - 8
    );
  });

  test("sections stack vertically on mobile and never spill", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await gotoReady(page);

    const cardBox = await page.locator("#workstation").boundingBox();
    expect(cardBox).not.toBeNull();

    // Single column: each marketing section renders below the previous one and
    // never spills wider than the viewport.
    let prevBottom = cardBox!.y + cardBox!.height;
    for (const id of ["compare", "guide", "faq"]) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box, `#${id} should render`).not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(prevBottom - 8);
      expect(box!.width).toBeLessThanOrEqual(390 + 2);
      prevBottom = box!.y + box!.height;
    }
  });

  test("main never carries a max-width and every section is centered", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoReady(page);

    const mainClassName = await page
      .getByRole("main")
      .evaluate((el) => el.className);
    expect(mainClassName).toContain("w-full");
    expect(mainClassName).toContain("overflow-x-hidden");
    expect(mainClassName).not.toMatch(/max-w-/);

    for (const id of ["compare", "guide", "faq"]) {
      // A full-bleed band (the guide) centres its first child instead.
      const className = await page
        .locator(`#${id}`)
        .evaluate((el) =>
          el.className.includes("mx-auto") ? el.className : (el.firstElementChild?.className ?? "")
        );
      expect(className).toContain("mx-auto");
      expect(className).toContain("max-w-");
    }
  });
});

test.describe("Anchorflow privacy posture — zero egress, zero uncaught errors", () => {
  test("first paint makes zero external requests (autoResolve defaults false)", async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    const uncaught: string[] = [];

    page.on("request", (request) => {
      const host = new URL(request.url()).hostname;
      if (!["localhost", "127.0.0.1"].includes(host)) {
        externalRequests.push(request.url());
      }
    });
    page.on("pageerror", (error) => uncaught.push(error.message));

    await gotoReady(page);

    // Let the debounced compute + settle run to completion.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const pre = document.querySelector(
              '[data-testid="diagnostic-echo"]'
            );
            return pre?.textContent?.length ?? 0;
          }),
        { timeout: READY_TIMEOUT }
      )
      .toBeGreaterThan(100);

    // The allow-list is EMPTY: with autoResolve off, nothing leaves the origin.
    expect(externalRequests, "no payload may leave the origin").toEqual([]);
    expect(uncaught, "no uncaught runtime errors").toEqual([]);
  });

  test("typing and computing still makes zero external requests", async ({
    page,
  }) => {
    const externalRequests: string[] = [];
    page.on("request", (request) => {
      const host = new URL(request.url()).hostname;
      if (!["localhost", "127.0.0.1"].includes(host)) {
        externalRequests.push(request.url());
      }
    });

    await gotoReady(page);
    await page.locator("#tool-source-input").fill("name: typed\non: push\n");
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              document.querySelector('[data-testid="diagnostic-echo"]')
                ?.textContent ?? ""
          ),
        { timeout: READY_TIMEOUT }
      )
      .toContain("name: typed");

    expect(externalRequests, "analysis never egresses").toEqual([]);
  });
});

/**
 * Pixel baselines pinned here must be regenerated by a human against the built
 * page before they are enabled — see the note above. Skipped so the suite
 * never goes RED on stale goldens.
 */
test.describe("Anchorflow pixel baselines (regenerate before enabling)", () => {
  test.skip("wide workstation screenshot", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await gotoReady(page);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("wide-workstation.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.02,
      timeout: 30_000,
    });
  });

  test.skip("narrow workstation screenshot", async ({ page }) => {
    await page.setViewportSize({ width: 800, height: 900 });
    await gotoReady(page);
    await page.evaluate(() => document.fonts.ready);
    await expect(page).toHaveScreenshot("narrow-workstation.png", {
      animations: "disabled",
      maxDiffPixelRatio: 0.02,
      timeout: 30_000,
    });
  });
});
