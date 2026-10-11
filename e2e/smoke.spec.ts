import { test, expect, type Locator, type Page } from "@playwright/test";

/**
 * Anchorflow smoke & journey suite.
 *
 * The product lives at `/tools/anchorflow` (root `app/page.tsx` server-
 * redirects into it). The page is one centered `max-w-7xl` host: sticky
 * SiteHeader → station (single <h1> + trust pills) → one workstation card
 * (TopToolbar + RawEditorPane | DiagnosticPane) → CompetitorMatrix (#matrix)
 * → KnowledgeHub (#guide) → FaqSection (#faq) → StudioFooter, with the ⌘K
 * command palette, the sign-in modal, the live region and the toaster mounted
 * globally.
 *
 * The compute pipeline is real: every keystroke dispatches to
 * `_workers/compute.worker.ts` behind a monotonic-id stale guard, and the
 * DiagnosticPane renders the worker's payload. The payload now carries the
 * OFFLINE HARDENER CORE: the structural `uses:` classification (per-node class
 * badge + `# line N · jobs.<id>.steps[i].uses` source), the byte-identical
 * rewritten YAML and the red/green diff of that rewrite. These journeys assert
 * exactly that, alongside the shell and keyboard contracts.
 *
 * Scoping notes that keep these specs stable:
 *   - `#workstation` is the single card holding the toolbar AND both panes.
 *   - Radix dropdowns, the command palette and the toaster are portaled to
 *     <body>, so they are queried at page level, not inside #workstation.
 *   - The KnowledgeHub (#guide) renders Radix tabs too, so tabpanel queries
 *     are scoped to #workstation when needed.
 */

const TOOL_URL = "/tools/anchorflow";

/** Bounds for the off-main-thread debounce + first compute (generous). */
const COMPUTE_TIMEOUT = 15_000;

/** Platform-agnostic modifier for ⌘K / Ctrl+K (resolves to Control on Linux). */
const MOD = "ControlOrMeta";

// ── Stable selectors ─────────────────────────────────────────────────────────
/** The single workstation card: TopToolbar + both panes + keycap footer. */
const station = (page: Page) => page.locator("#workstation");
const sourceInput = (page: Page) => page.locator("#tool-source-input");
const diagnosticEcho = (page: Page) => page.getByTestId("diagnostic-echo");
/** The per-`uses:` classification rows the D1 core renders. */
const usesRow = (page: Page) => page.getByTestId("uses-row");
/** The red/green unified diff section. */
const diffSection = (page: Page) =>
  page.locator('section[aria-label="Unified diff"]');

/**
 * Controlled-React inputs only commit once the onChange → store → re-render
 * round-trip sticks; a pre-hydration DOM fill is silently reverted. Retry
 * until the value actually lands so the helper stays hydration-safe.
 */
async function fillStable(locator: Locator, value: string) {
  await expect(async () => {
    await locator.fill(value);
    await expect(locator).toHaveValue(value);
  }).toPass({ timeout: COMPUTE_TIMEOUT });
}

/** Wait until the workstation has booted and the seeded workflow is present. */
async function waitWorkspaceReady(page: Page) {
  await expect(sourceInput(page)).toBeVisible({ timeout: COMPUTE_TIMEOUT });
  await expect(sourceInput(page)).not.toHaveValue("");
}

test.describe("Anchorflow shell journeys", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(TOOL_URL, { waitUntil: "domcontentloaded" });
    await waitWorkspaceReady(page);
  });

  test("landing route redirects into the workstation", async ({ page }) => {
    await page.goto("/");

    await expect(page).toHaveURL(new RegExp(`/tools/anchorflow$`));
    await expect(sourceInput(page)).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("header, single h1, nav, theme toggle and sign-in are present", async ({
    page,
  }) => {
    // Exactly one <h1>, named Anchorflow.
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      /Anchorflow/i
    );

    const header = page.getByRole("banner");
    await expect(header).toBeVisible();

    // In-page anchors to the station / comparison / guide / faq sections.
    const nav = header.getByRole("navigation");
    await expect(
      nav.getByRole("link", { name: /workstation/i })
    ).toBeVisible();
    await expect(nav.getByRole("link", { name: /why anchorflow/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /guide/i })).toBeVisible();
    await expect(nav.getByRole("link", { name: /faq/i })).toBeVisible();

    // Brand wordmark link points home.
    await expect(
      header.getByRole("link", { name: /Anchorflow/i }).first()
    ).toBeVisible();

    // Theme + auth controls (accessible names carry "theme" / "sign in").
    await expect(page.getByRole("button", { name: /theme/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  });

  test("landmarks exist: banner, main, contentinfo and the skip link", async ({
    page,
  }) => {
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /skip to workstation/i })
    ).toHaveAttribute("href", "#workstation");
  });

  test("seeded first run paints a non-blank instrument with a live result", async ({
    page,
  }) => {
    // Seeded example: the editor carries the default (non-empty) workflow.
    const seeded = await sourceInput(page).inputValue();
    expect(seeded.length).toBeGreaterThan(200);

    // The worker result mirrors into the diagnostic pane immediately.
    await expect(diagnosticEcho(page)).toContainText("name: ci", {
      timeout: COMPUTE_TIMEOUT,
    });
    await expect(diagnosticEcho(page)).toContainText("actions/checkout@v4");

    // The measurement readouts are real numbers, not placeholders.
    const chars = station(page).getByText("characters", { exact: true });
    await expect(chars).toBeVisible({ timeout: COMPUTE_TIMEOUT });
    await expect(
      station(page).getByText("bytes", { exact: true })
    ).toBeVisible();

    // The status strip settles on Ready with the counts on it.
    await expect(
      station(page).getByText(/^\d+$/).first()
    ).toBeVisible({ timeout: COMPUTE_TIMEOUT });
    await expect(station(page).getByText("Ready")).toBeVisible({
      timeout: COMPUTE_TIMEOUT,
    });
  });

  test("the D1 core classifies every seeded uses line (AC-1 · AC-14)", async ({
    page,
  }) => {
    // The seed is a real workflow with ≥1 moving ref and ≥1 remoteRef (AC-14),
    // so the classification list is non-blank on first paint with NO network.
    const rows = usesRow(page);
    await expect(rows.first()).toBeVisible({ timeout: COMPUTE_TIMEOUT });
    expect(await rows.count()).toBeGreaterThanOrEqual(8);

    // A MOVING ref is highlighted amber … (@v4 is a floating major)
    const moving = page.locator('[data-testid="uses-row"][data-moving="true"]');
    await expect(moving).toHaveCount(3);
    const movingRow = moving.filter({ hasText: "actions/checkout@v4" });
    await expect(movingRow).toBeVisible();
    await expect(movingRow).toContainText("moving");
    await expect(movingRow).toContainText(
      "# line",
      { useInnerText: true }
    );
    await expect(movingRow).toContainText("jobs.build.steps[0].uses");

    // An already-pinned SHA is lime "pinned" and never moving …
    const pinned = page.locator('[data-testid="uses-row"][data-class="sha40"]');
    await expect(pinned).toHaveCount(2);
    await expect(pinned.first()).toContainText("pinned");
    await expect(pinned.first()).toHaveAttribute("data-moving", "false");

    // … a fixed dotted tag is a violet "pending" remoteRef …
    const pending = page.locator(
      '[data-testid="uses-row"][data-class="remoteRef"][data-moving="false"]'
    );
    await expect(pending).toHaveCount(1);
    await expect(pending).toContainText("actions/setup-node@v4.2.0");

    // … and local + docker are collected but never flagged for resolution.
    await expect(
      page.locator('[data-testid="uses-row"][data-class="local"]')
    ).toContainText("./.github/actions/setup");
    await expect(
      page.locator('[data-testid="uses-row"][data-class="docker"]')
    ).toContainText("docker://alpine:3.20");

    // The job-level reusable-workflow call carries scope "job".
    await expect(
      page.locator('[data-testid="uses-row"]', {
        hasText: "release.yml@main",
      })
    ).toContainText("jobs.release.uses");

    // The classification summary counts every class (AC-9 change counter).
    const summary = page.locator('section[aria-label="Uses classification"]');
    await expect(summary).toContainText("8 uses");
    await expect(summary).toContainText("pinned");
  });

  test("the rewritten YAML is byte-identical to the seed on first paint (AC-2)", async ({
    page,
  }) => {
    // With no resolutions the rewrite is a NO-OP: the output must equal the
    // editor's own text, byte for byte, comments and flow spacing included.
    const seeded = await sourceInput(page).inputValue();
    const rewritten = diagnosticEcho(page);
    await expect(rewritten).toBeVisible({ timeout: COMPUTE_TIMEOUT });
    expect(await rewritten.innerText()).toBe(seeded);

    // The comment-preservation fixtures survive verbatim.
    expect(seeded).toContain("branches: [main]     # only main");
    expect(seeded).toContain("actions/checkout@v4   # needed for CI");
  });

  test("the diff is empty until refs resolve (AC-9 empty state)", async ({
    page,
  }) => {
    await expect(diagnosticEcho(page)).toBeVisible({ timeout: COMPUTE_TIMEOUT });
    const diff = diffSection(page);
    await expect(diff).toBeVisible();
    await expect(diff).toContainText("No changes yet — resolve refs to pin.");
    await expect(page.getByTestId("diff-changed-count")).toHaveText("0 changes");
    // The diff view itself carries no +/- lines in this state.
    await expect(diff.locator("pre")).toHaveCount(0);
  });

  test("the rewritten-YAML copy button copies the exact pinned output", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const seeded = await sourceInput(page).inputValue();
    await expect(diagnosticEcho(page)).toBeVisible({ timeout: COMPUTE_TIMEOUT });

    const copyButton = station(page).getByRole("button", { name: /^copy$/i });
    await expect(copyButton).toBeEnabled({ timeout: COMPUTE_TIMEOUT });
    await copyButton.click();

    // Tactile success toast, then the clipboard holds the rewritten YAML —
    // byte-identical to the seeded workflow, because nothing is resolved yet.
    await expect(page.getByText(/diagnostic output copied/i)).toBeVisible({
      timeout: COMPUTE_TIMEOUT,
    });
    const clipboard = await page.evaluate(() =>
      navigator.clipboard.readText()
    );
    expect(clipboard).toBe(seeded);
    expect(clipboard).toContain("branches: [main]     # only main");
  });

  test("a pasted workflow is classified and stays a no-op rewrite", async ({
    page,
  }) => {
    const workflow = [
      "name: probe",
      "on: push",
      "jobs:",
      "  build:",
      "    steps:",
      "      - uses: actions/checkout@v4   # needed for CI",
      "      - uses: actions/setup-node@11bd71901bbe5b1630ceea73d27597364c9af683",
      "      - run: echo hi",
      "",
    ].join("\n");
    await fillStable(sourceInput(page), workflow);

    const rows = usesRow(page);
    await expect(rows).toHaveCount(2, { timeout: COMPUTE_TIMEOUT });
    const moving = page.locator('[data-testid="uses-row"][data-moving="true"]');
    await expect(moving).toHaveCount(1);
    await expect(moving).toContainText("actions/checkout@v4");
    await expect(moving).toContainText("jobs.build.steps[0].uses");
    await expect(
      page.locator('[data-testid="uses-row"][data-class="sha40"]')
    ).toContainText("actions/setup-node@11bd71901bbe5b1630ceea73d27597364c9af683");

    // Nothing resolved ⇒ the diff stays empty and the output stays identical.
    await expect(diffSection(page)).toContainText(
      "No changes yet — resolve refs to pin."
    );
    expect(await diagnosticEcho(page).innerText()).toBe(workflow);
  });

  test("a malformed workflow settles a friendly parse error (AC-1 error value)", async ({
    page,
  }) => {
    await fillStable(sourceInput(page), "jobs:\n\tbuild: 1\n");
    await expect(
      station(page).getByText(/doesn't parse as a workflow YAML — 2:1/)
    ).toBeVisible({ timeout: COMPUTE_TIMEOUT });
    await expect(station(page).getByText("Analysis failed")).toBeVisible();
    // No classification rows and no hollow echo once the parse failed.
    await expect(usesRow(page)).toHaveCount(0);
    await expect(diagnosticEcho(page)).toHaveCount(0);
  });

  test("worker round-trip: a paste is measured and mirrored back", async ({
    page,
  }) => {
    // Deterministic, distinctive payload. The multibyte character makes the
    // four measurements distinct, so each readout is unambiguous:
    // 11 characters · 2 words · 12 bytes · 1 line.
    const payload = "alpha béta\n";
    await fillStable(sourceInput(page), payload);

    // The worker echoes the analyzed text back into the diagnostic pane.
    await expect(diagnosticEcho(page)).toHaveText(payload, {
      timeout: COMPUTE_TIMEOUT,
    });

    // …and the measurement grid reports the same numbers the pure core does.
    const diagnostics = station(page).locator("dl");
    await expect(diagnostics.getByText("characters")).toBeVisible();
    await expect(diagnostics.getByText("words")).toBeVisible();
    await expect(diagnostics.getByText("bytes")).toBeVisible();
    await expect(diagnostics.getByText("lines")).toBeVisible();
    await expect(diagnostics.getByText("11", { exact: true })).toBeVisible({
      timeout: COMPUTE_TIMEOUT,
    });
    await expect(diagnostics.getByText("2", { exact: true })).toBeVisible();
    await expect(diagnostics.getByText("12", { exact: true })).toBeVisible();

    // The status strip reflects the new counts too.
    await expect(station(page).getByText("Ready")).toBeVisible({
      timeout: COMPUTE_TIMEOUT,
    });
  });

  test("⌘K opens and closes the command palette", async ({ page }) => {
    const dialog = page.getByRole("dialog", { name: /command palette/i });

    await page.keyboard.press(`${MOD}+K`);
    await expect(dialog).toBeVisible({ timeout: COMPUTE_TIMEOUT });

    // The palette search is a combobox (aria-controls the option list).
    const search = dialog.locator("#command-palette-search-input");
    await expect(search).toBeVisible({ timeout: COMPUTE_TIMEOUT });
    await search.fill("copy");
    await expect(dialog.getByRole("option").first()).toBeVisible({
      timeout: COMPUTE_TIMEOUT,
    });

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden({ timeout: COMPUTE_TIMEOUT });
  });

  test("⌘⇧C copies the diagnostic output with a lime success toast", async ({
    page,
    context,
  }) => {
    // The clipboard API needs an explicit grant in headless Chromium.
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    await fillStable(sourceInput(page), "name: clipboard-check\n");
    await expect(diagnosticEcho(page)).toHaveText("name: clipboard-check\n", {
      timeout: COMPUTE_TIMEOUT,
    });

    await page.keyboard.press(`${MOD}+Shift+C`);

    // Tactile success toast names exactly what was copied.
    const toast = page.getByText(/diagnostic output copied/i);
    await expect(toast).toBeVisible({ timeout: COMPUTE_TIMEOUT });

    // The clipboard really holds the mirrored output.
    const clipboard = await page.evaluate(() =>
      navigator.clipboard.readText()
    );
    expect(clipboard).toBe("name: clipboard-check\n");
  });

  test("per-pane copy button copies the same output", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);

    const copyButton = station(page).getByRole("button", { name: /^copy$/i });
    await expect(copyButton).toBeVisible();
    await copyButton.click();

    await expect(page.getByText(/diagnostic output copied/i)).toBeVisible({
      timeout: COMPUTE_TIMEOUT,
    });
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard.length).toBeGreaterThan(0);
  });

  test("theme toggle flips the <html class> between light and dark", async ({
    page,
  }) => {
    const htmlClass = () =>
      page.evaluate(() => document.documentElement.className);

    // The toggle is mounted-gated: disabled until hydration, then live.
    const toggle = page.getByRole("button", { name: /theme/i });
    await expect(toggle).toBeEnabled({ timeout: COMPUTE_TIMEOUT });

    const before = await htmlClass();
    await toggle.click();
    await expect
      .poll(htmlClass, { timeout: COMPUTE_TIMEOUT })
      .not.toBe(before);

    const after = await htmlClass();
    expect(after.includes("dark")).toBe(!before.includes("dark"));

    // The preference is stored under the tool-specific theme key.
    const stored = await page.evaluate(() =>
      localStorage.getItem("anchorflow-theme")
    );
    expect(stored).toBe(after.includes("dark") ? "dark" : "light");

    // Toggling back restores the original class.
    await toggle.click();
    await expect
      .poll(htmlClass, { timeout: COMPUTE_TIMEOUT })
      .toBe(before);
  });

  test("clear empties the editor, example re-seeds it", async ({ page }) => {
    const input = sourceInput(page);
    await expect(input).not.toHaveValue("");

    await station(page).getByRole("button", { name: /clear/i }).click();
    await expect(input).toHaveValue("", { timeout: COMPUTE_TIMEOUT });

    await station(page).getByRole("button", { name: /example/i }).click();
    await expect(input).toHaveValue(/name: ci/, { timeout: COMPUTE_TIMEOUT });
  });

  test("persistence: the workflow survives a reload via localStorage", async ({
    page,
  }) => {
    const distinctive = "# anchorflow-persist-probe-7f3a\nname: ci\n";
    await fillStable(sourceInput(page), distinctive);

    // zustand persist writes on every set(); the payload IS the settled signal.
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            localStorage.getItem("anchorflow-tool-storage") ?? ""
          ),
        { timeout: COMPUTE_TIMEOUT }
      )
      .toContain("anchorflow-persist-probe-7f3a");

    await page.reload();
    await waitWorkspaceReady(page);

    await expect(sourceInput(page)).toHaveValue(distinctive, {
      timeout: COMPUTE_TIMEOUT,
    });
  });

  test("persisted payload is content-only and auto-resolve stays off", async ({
    page,
  }) => {
    // Persist writes on state change, so commit an edit first.
    await fillStable(sourceInput(page), "name: persist-shape\n");

    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("anchorflow-tool-storage") ?? "{}")
    );
    expect(stored.version).toBe(1);
    // Persist is partialized to { source, autoResolve } — no UI chrome, no
    // metrics, no announcement state.
    expect(Object.keys(stored.state).sort()).toEqual([
      "autoResolve",
      "source",
    ]);
    expect(stored.state.autoResolve).toBe(false);
  });

  test("below-the-fold education renders from its single sources", async ({
    page,
  }) => {
    await expect(page.locator("#matrix")).toBeVisible();
    await expect(page.locator("#guide")).toBeVisible();
    await expect(page.locator("#faq")).toBeVisible();

    // The guide renders its first tab's copy from _lib/guide.ts.
    await expect(
      page.locator("#guide").getByText(/Pin every action to an immutable commit/i)
    ).toBeVisible();

    // The FAQ accordion is native <details>, no JS needed to read it.
    const faq = page.locator("#faq details").first();
    await expect(faq).toBeVisible();
    await expect(faq.locator("summary")).toContainText(/leave my browser/i);

    // Zero-drift SEO: the FAQPage JSON-LD is derived from the same array.
    const jsonLd = await page
      .locator('script[type="application/ld+json"]')
      .innerText();
    const parsed = JSON.parse(jsonLd);
    expect(parsed["@type"]).toBe("FAQPage");
    expect(parsed.mainEntity.length).toBeGreaterThan(0);
    expect(parsed.mainEntity[0].name).toContain("leave my browser");
  });

  test("sign-in is offer-never-lock: an unconfigured install explains, never gates", async ({
    page,
  }) => {
    // Supabase env is absent → the button opens an explanatory notice instead
    // of a dead-end modal (BAR §11).
    await page.getByRole("button", { name: /sign in/i }).click();
    const notice = page.getByText(/sign-in isn.t enabled yet/i);
    await expect(notice).toBeVisible({ timeout: COMPUTE_TIMEOUT });
    await expect(
      page.getByText(/never need an account/i)
    ).toBeVisible();

    // Core work is never gated: the copy affordance is still live.
    const copyButton = station(page).getByRole("button", { name: /^copy$/i });
    await expect(copyButton).toBeEnabled();

    // The command palette can still drive the sign-in affordance.
    await page.keyboard.press(`${MOD}+K`);
    const palette = page.getByRole("dialog", { name: /command palette/i });
    await expect(palette).toBeVisible({ timeout: COMPUTE_TIMEOUT });
    await palette.locator("#command-palette-search-input").fill("sign in");
    await expect(palette.getByRole("option").first()).toBeVisible({
      timeout: COMPUTE_TIMEOUT,
    });
  });
});
