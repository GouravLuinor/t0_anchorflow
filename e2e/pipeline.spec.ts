import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The compute-pipeline JOURNEY — the one contract the whole architecture rests
 * on (BAR §2.3 · ARCH §4):
 *
 *   · the HAPPY path computes off the main thread in
 *     `_workers/compute.worker.ts`, and the UI says so (`data-engine="worker"`
 *     on `#workstation`) — proved by the engine flag AND by recording the
 *     Phase-A messages the page really posted into the worker;
 *   · the DEGRADED path runs the SAME pure core on the main thread and returns
 *     the SAME report — proved by forcing a worker death and asserting the
 *     instrument still settles with byte-identical output, under the amber
 *     "Main-thread mode active" banner with `data-engine="main"`;
 *   · neither path issues a single external request (the offline default), so
 *     this suite doubles as a privacy regression guard.
 *
 * The forced failure is a real browser-side `onerror` on a Worker that dies on
 * construction — the same signal `spawnWorker` handles when a CSP or the
 * platform kills workers — never a test-only backdoor in the app.
 */

const TOOL_URL = "/tools/anchorflow";
const READY_TIMEOUT = 15_000;

/**
 * A deterministic, distinctive workflow. It exercises every offline surface at
 * once so the two engines' outputs are comparable as a whole rather than by a
 * single lucky number: a moving major, a fixed dotted tag, an already-pinned
 * SHA, a local action, an over-broad token grant and one untrusted
 * interpolation. With no resolutions the rewrite is a NO-OP, so the expected
 * rewritten text is the input verbatim.
 */
const FINGERPRINT_INPUT = `name: fingerprint
on:
  push:
    branches: [main]

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4.2.0
      - uses: actions/cache@8f002d5b1a0e6c4dd2b6a2d3f0d1a6e5b1234abc
      - uses: ./.github/actions/setup
      - run: echo "\${{ github.event.pull_request.title }}"

  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions: write-all
    steps:
      - run: ./deploy.sh
`;

interface Fingerprint {
  /** The compute engine the UI reports on `#workstation`. */
  engine: string;
  characters: string;
  words: string;
  bytes: string;
  lines: string;
  usesCount: number;
  findingSummary: string;
  grantRows: number;
  /** The rewritten YAML verbatim (whitespace and newlines preserved). */
  rewritten: string;
}

const station = (page: Page): Locator => page.locator("#workstation");

/** Reads a `<dt>`'s adjacent `<dd>` from the metrics grid. */
async function metric(page: Page, label: string): Promise<string> {
  const value = station(page)
    .locator("dl dt")
    .getByText(label, { exact: true })
    .locator("+ dd");
  return (await value.innerText()).trim();
}

async function fingerprint(page: Page): Promise<Fingerprint> {
  await expect(station(page)).toHaveAttribute("data-engine", "worker", {
    timeout: READY_TIMEOUT,
  });
  return {
    engine: "worker",
    characters: await metric(page, "characters"),
    words: await metric(page, "words"),
    bytes: await metric(page, "bytes"),
    lines: await metric(page, "lines"),
    usesCount: await page.getByTestId("uses-row").count(),
    findingSummary: (
      await page.getByTestId("findings-counts").innerText()
    ).replace(/\s+/g, " "),
    grantRows: await page.getByTestId("grant-row").count(),
    rewritten: (await page.getByTestId("diagnostic-echo").textContent()) ?? "",
  };
}

/**
 * Records every message the page posts into a worker, so the happy path can
 * prove — not merely assume — that the compute really left the main thread.
 */
async function recordWorkerPosts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const posted: Array<Record<string, unknown>> = [];
    (window as unknown as { __workerPosts: typeof posted }).__workerPosts = posted;
    const RealWorker = window.Worker;

    function RecordingWorker(this: unknown, url: URL | string): Worker {
      const worker = new RealWorker(url);
      const nativePost = worker.postMessage.bind(worker);
      worker.postMessage = (message: unknown): void => {
        posted.push(message as Record<string, unknown>);
        nativePost(message);
      };
      return worker;
    }

    window.Worker = RecordingWorker as unknown as typeof Worker;
  });
}

/** A worker that constructs and then dies — the `onerror` degradation signal. */
async function killWorkerOnSpawn(page: Page): Promise<void> {
  await page.addInitScript(() => {
    class DeadWorker {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: ((event: MessageEvent) => void) | null = null;

      constructor(_url: URL | string) {
        // Mirrors a platform/CSP worker death: the constructor resolves, then
        // the browser reports the failure through `onerror`.
        setTimeout(() => {
          this.onerror?.(
            new ErrorEvent("error", {
              message: "forced worker failure (pipeline journey)",
            })
          );
        }, 0);
      }

      postMessage(): void {}
      terminate(): void {}
    }

    window.Worker = DeadWorker as unknown as typeof Worker;
  });
}

/** Every external URL the page asked for — must stay empty on this journey. */
function trackExternal(page: Page): string[] {
  const seen: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      url.origin === "http://127.0.0.1:3004" ||
      url.origin === "http://localhost:3004"
    ) {
      return;
    }
    if (url.protocol === "data:" || url.protocol === "blob:") return;
    seen.push(request.url());
  });
  return seen;
}

async function bootWorkspace(page: Page): Promise<void> {
  await page.goto(TOOL_URL, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#tool-source-input")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
  await expect(page.locator("#tool-source-input")).not.toHaveValue("");
}

/** Controlled-React inputs only commit once the onChange round-trip lands. */
async function fillStable(page: Page, value: string): Promise<void> {
  const input = page.locator("#tool-source-input");
  await expect(async () => {
    await input.fill(value);
    await expect(input).toHaveValue(value);
  }).toPass({ timeout: READY_TIMEOUT });
}

async function settleReport(page: Page): Promise<void> {
  // The instrument is settled when the rewrite is painted and no skeleton
  // remains — the diagnostic echo mirrors the core's own output text.
  await expect(page.getByTestId("diagnostic-echo")).not.toHaveText("", {
    timeout: READY_TIMEOUT,
  });
  await expect(station(page).getByText("Ready")).toBeVisible({
    timeout: READY_TIMEOUT,
  });
}

test("happy path: the compute runs in the worker and settles the offline report", async ({
  page,
}) => {
  await recordWorkerPosts(page);
  const external = trackExternal(page);
  await bootWorkspace(page);

  // The worker is live, and it received the seeded workflow.
  await expect(station(page)).toHaveAttribute("data-engine", "worker", {
    timeout: READY_TIMEOUT,
  });

  await fillStable(page, FINGERPRINT_INPUT);
  await settleReport(page);

  // The page really posted a Phase-A dispatch into a real worker carrying the
  // text the user typed — the off-main-thread claim, observed rather than
  // inferred.
  const posts = await page.evaluate(
    () =>
      (
        window as unknown as {
          __workerPosts: Array<Record<string, unknown>>;
        }
      ).__workerPosts
  );
  expect(posts.length).toBeGreaterThan(0);
  expect(posts.some((post) => post.phase === "A")).toBe(true);
  const phaseA = posts.filter((post) => post.phase === "A");
  expect(phaseA.every((post) => post.resolve === false)).toBe(true);
  expect(
    posts.some((post) => post.source === FINGERPRINT_INPUT)
  ).toBe(true);

  // Still the worker after the settle.
  await expect(station(page)).toHaveAttribute("data-engine", "worker");

  // Byte-identical NO-OP rewrite (AC-2): with no resolutions the core re-emits
  // the input exactly.
  const echoed = await page.getByTestId("diagnostic-echo").textContent();
  expect(echoed).toBe(FINGERPRINT_INPUT);

  // Zero egress on the default path.
  expect(external).toEqual([]);
});

test("degraded path: a forced worker death still computes the SAME report on the main thread", async ({
  page,
}) => {
  // 1 — the worker fingerprint, recorded on the happy path first.
  const happy = await (async () => {
    const ctx = page.context();
    const p = await ctx.newPage();
    await bootWorkspace(p);
    await fillStable(p, FINGERPRINT_INPUT);
    await settleReport(p);
    const fp = await fingerprint(p);
    await p.close();
    return fp;
  })();

  await killWorkerOnSpawn(page);
  const external = trackExternal(page);
  await bootWorkspace(page);

  // The degradation banner and the engine flag both tell the truth.
  await expect(
    page.getByText("Main-thread mode active", { exact: false })
  ).toBeVisible({ timeout: READY_TIMEOUT });
  await expect(station(page)).toHaveAttribute("data-engine", "main", {
    timeout: READY_TIMEOUT,
  });

  await fillStable(page, FINGERPRINT_INPUT);
  await settleReport(page);

  const degraded: Fingerprint = {
    engine: await station(page).getAttribute("data-engine").then((v) => v ?? ""),
    characters: await metric(page, "characters"),
    words: await metric(page, "words"),
    bytes: await metric(page, "bytes"),
    lines: await metric(page, "lines"),
    usesCount: await page.getByTestId("uses-row").count(),
    findingSummary: (
      await page.getByTestId("findings-counts").innerText()
    ).replace(/\s+/g, " "),
    grantRows: await page.getByTestId("grant-row").count(),
    rewritten: (await page.getByTestId("diagnostic-echo").textContent()) ?? "",
  };

  // 3 — identical engines of truth. The fallback runs the SAME pure core, so
  // every measurement and every rendered count must match the worker run
  // byte-for-byte. Only the engine label differs, by design.
  expect(degraded.characters).toBe(happy.characters);
  expect(degraded.words).toBe(happy.words);
  expect(degraded.bytes).toBe(happy.bytes);
  expect(degraded.lines).toBe(happy.lines);
  expect(degraded.usesCount).toBe(happy.usesCount);
  expect(degraded.usesCount).toBeGreaterThan(0);
  expect(degraded.findingSummary).toBe(happy.findingSummary);
  expect(degraded.grantRows).toBe(happy.grantRows);
  expect(degraded.rewritten).toBe(happy.rewritten);
  expect(degraded.rewritten).toBe(FINGERPRINT_INPUT);
  expect(degraded.engine).toBe("main");
  expect(happy.engine).toBe("worker");

  // The degraded banner states the same core, not a substitute.
  await expect(
    page.getByText("same core", { exact: false })
  ).toBeVisible();

  // Zero egress on the degraded default path too.
  expect(external).toEqual([]);
});
