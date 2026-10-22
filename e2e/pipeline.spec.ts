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
 *     main-thread notice with `data-engine="main"`;
 *   · the CATASTROPHIC path never hangs: a worker that accepts a dispatch and
 *     never answers is killed by the 1.5 s Phase-A watchdog, which settles the
 *     friendly verdict and leaves the editor usable (BAR §10 item 7);
 *   · the CAP journey: an oversize paste is reported at its TRUE original byte
 *     count with the amber "trimmed to 256 KiB" chip, on BOTH engines, while
 *     the worker payload itself stays bounded at the cap (SPEC §9 AC-13);
 *   · neither path issues a single external request (the offline default), so
 *     this suite doubles as a privacy regression guard.
 *
 * The forced failures are real browser-side Worker behaviours — a worker that
 * dies on construction (the `onerror` degradation signal, exactly what a CSP or
 * the platform produces) and a worker that never answers a dispatch (the
 * watchdog's reason to exist) — never test-only backdoors in the app.
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

/**
 * Reads one measurement off the readout under the editor. Lines and bytes are
 * printed there; all four ride on its `data-*` attributes so the two engines
 * can be compared measurement for measurement.
 */
async function metric(page: Page, label: "characters" | "words" | "bytes" | "lines"): Promise<string> {
  return (await page.locator("#workflow-meta").getAttribute(`data-${label}`)) ?? "";
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

/**
 * A worker that accepts the FIRST dispatch and never answers it — the
 * catastrophic case the watchdog exists for. Every worker spawned afterwards
 * is the real one, so the journey also proves the terminate + respawn path
 * recovers instead of leaving the instrument dead.
 */
async function swallowFirstDispatch(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const RealWorker = window.Worker;
    let spawned = 0;

    class SilentFirstWorker {
      inner: Worker;
      silent: boolean;

      constructor(url: URL | string) {
        spawned += 1;
        this.inner = new RealWorker(url);
        // Only the FIRST worker is silent: the watchdog's respawn must be able
        // to answer, which is what makes this a recovery journey too.
        this.silent = spawned === 1;
      }

      get onmessage(): ((event: MessageEvent) => void) | null {
        return this.inner.onmessage;
      }
      set onmessage(handler: ((event: MessageEvent) => void) | null) {
        this.inner.onmessage = handler;
      }
      get onerror(): ((event: ErrorEvent) => void) | null {
        return this.inner.onerror;
      }
      set onerror(handler: ((event: ErrorEvent) => void) | null) {
        this.inner.onerror = handler;
      }
      get onmessageerror(): ((event: MessageEvent) => void) | null {
        return this.inner.onmessageerror;
      }
      set onmessageerror(handler: ((event: MessageEvent) => void) | null) {
        this.inner.onmessageerror = handler;
      }

      postMessage(message: unknown): void {
        // Swallowed: no reply will ever come for this dispatch.
        if (this.silent) return;
        this.inner.postMessage(message);
      }

      terminate(): void {
        this.inner.terminate();
      }
    }

    window.Worker = SilentFirstWorker as unknown as typeof Worker;
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

/**
 * The instrument is settled when the rewrite is painted and no skeleton
 * remains — the diagnostic echo mirrors the core's own output text.
 *
 * `marker` ties the settle to WHAT was typed: without it, the seeded workflow's
 * own report already satisfies the wait, so a fingerprint taken after a fill
 * could still be describing the seed and pass for the wrong reason. A marker
 * only the fresh source contains closes that race.
 */
async function settleReport(page: Page, marker?: string): Promise<void> {
  const echo = page.getByTestId("diagnostic-echo");
  await expect(echo).not.toHaveText("", { timeout: READY_TIMEOUT });
  if (marker) {
    await expect(echo).toContainText(marker, { timeout: READY_TIMEOUT });
  }
  await expect(station(page).getByText(/computed in this tab/)).toBeVisible({
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
  await settleReport(page, "name: fingerprint");

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
    await settleReport(p, "name: fingerprint");
    const fp = await fingerprint(p);
    await p.close();
    return fp;
  })();

  await killWorkerOnSpawn(page);
  const external = trackExternal(page);
  await bootWorkspace(page);

  // The degradation notice and the engine flag both tell the truth.
  await expect(
    page.getByText("so the check runs on the main thread", { exact: false })
  ).toBeVisible({ timeout: READY_TIMEOUT });
  await expect(station(page)).toHaveAttribute("data-engine", "main", {
    timeout: READY_TIMEOUT,
  });

  await fillStable(page, FINGERPRINT_INPUT);
  await settleReport(page, "name: fingerprint");

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

  // The degraded notice states the same engine, not a substitute.
  await expect(
    page.getByText("Same engine, same results", { exact: false })
  ).toBeVisible();

  // Zero egress on the degraded default path too.
  expect(external).toEqual([]);
});

test("catastrophic path: a worker that never answers settles the watchdog verdict, never a hang", async ({
  page,
}) => {
  await swallowFirstDispatch(page);
  const external = trackExternal(page);
  await bootWorkspace(page);

  // The friendly verdict, within a BOUNDED timeout: the Phase-A watchdog is
  // 1.5 s, so anything past 10 s would be a hang, not a slow compute.
  const verdict = page.getByText(
    /Analysis exceeded the time budget/i
  );
  await expect(verdict).toBeVisible({ timeout: 10_000 });
  await expect(verdict).toContainText("too complex to process in time");

  // The headline agrees, and says what happened rather than spinning forever.
  await expect(station(page).getByText("This workflow took too long to check.")).toBeVisible({
    timeout: 10_000,
  });

  // NEVER A HANG: the editor is still enabled, still holds the seeded
  // workflow, and accepts input.
  const input = page.locator("#tool-source-input");
  await expect(input).toBeEnabled();
  await expect(input).not.toHaveValue("");
  await fillStable(page, FINGERPRINT_INPUT);
  await expect(input).toBeEnabled();

  // And the instrument RECOVERS: the respawned worker answers the next
  // dispatch, so the same report the happy path produces settles here too.
  await settleReport(page, "name: fingerprint");
  const echoed = await page.getByTestId("diagnostic-echo").textContent();
  expect(echoed).toBe(FINGERPRINT_INPUT);

  // Still no external request on the offline default path.
  expect(external).toEqual([]);
});

/**
 * The input-cap journey (SPEC §9 AC-13).
 *
 * A paste larger than `MAX_INPUT_BYTES` used to arrive at the worker ALREADY
 * sliced: the dispatch carried 262,144 bytes of text and nothing else, so
 * `analyzeLocal` measured the slice and reported `bytes = 262144` with no
 * "trimmed" chip — the workflow looked ~73 kB smaller than it really was, and
 * the forced-degrade path (which receives the full source) reported the true
 * size. The two engines therefore disagreed on the same paste.
 *
 * What this journey pins:
 *   · the `bytes` metric is the TRUE original byte count, not the cap;
 *   · the amber "trimmed to 256 KiB for analysis" chip is visible;
 *   · the worker path and the forced-degrade path agree, metric for metric;
 *   · the dispatch payload that crossed into the worker really was capped —
 *     bounded payload, truthful count, not one at the expense of the other.
 */

/** Comfortably past the 256 KiB cap; the bytes live in one big block. */
const OVERSIZE_TARGET_BYTES = 320_000;

/**
 * An oversize workflow with a SMALL node count: thousands of `jobs:` would
 * measure the report renderer's throughput rather than the input cap, and the
 * fixture exists to be pasted, not to be admired. The bytes live in one long
 * generated block, exactly like a generated workflow with an embedded script.
 */
function oversizeWorkflow(): string {
  const lines = [
    "name: oversize",
    "on:",
    "  push:",
    "    branches: [main]",
    "",
    "permissions:",
    "  contents: read",
    "",
    "jobs:",
    "  build:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - name: generated bootstrap",
    "        run: |",
  ];
  let n = 0;
  while (byteLength(lines.join("\n") + "\n") < OVERSIZE_TARGET_BYTES) {
    n += 1;
    lines.push(
      `          # shard ${n} padding line to reach the byte cap with the same structural shape`
    );
  }
  return `${lines.join("\n")}\n`;
}

/** UTF-8 byte length — the same unit `countBytes` reports. */
function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

const OVERSIZE_INPUT = oversizeWorkflow();
const OVERSIZE_TRUE_BYTES = byteLength(OVERSIZE_INPUT);

/** The readout renders `value.toLocaleString("en-US")` — grouped digits. */
const grouped = (value: number): string => value.toLocaleString("en-US");

/**
 * Sets the textarea the way the browser does for a paste — the native value
 * setter plus one `input` event — so React's synthetic `onChange` runs the
 * normal pipeline (debounce → worker → render).
 *
 * `fill()` is deliberately NOT used here: Playwright's `fill` on a
 * `<textarea>` selects all and routes the text through the keyboard
 * (`Input.insertText`), which for a 320 kB paste is one editing command per
 * character — measured at ~30 s on this box. That is Playwright's typing
 * path, not a property of the app, and it would make this journey a
 * stopwatch test. Everything after the set is the real pipeline on real DOM.
 * The value is asserted to round-trip, exactly as `fillStable` does.
 */
async function pasteStable(page: Page, value: string): Promise<void> {
  const input = page.locator("#tool-source-input");
  await expect(async () => {
    await input.evaluate((element, next) => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      )!.set;
      setter!.call(element, next);
      element.dispatchEvent(
        new Event("input", { bubbles: true, composed: true })
      );
    }, value);
    await expect(input).toHaveValue(value);
  }).toPass({ timeout: READY_TIMEOUT });
}

test("the input cap: an oversize paste reports its TRUE byte count on both engines", async ({
  page,
}) => {
  // Sanity on the fixture itself: over the cap, or the journey below would
  // pass for the wrong reason.
  expect(OVERSIZE_TRUE_BYTES).toBeGreaterThan(262_144);

  // 1 — the WORKER path, on its own page, with every message posted into the
  //    worker recorded (the engine flag alone would not prove what was
  //    dispatched).
  const worker = await (async () => {
    const ctx = page.context();
    const workerPage = await ctx.newPage();
    await recordWorkerPosts(workerPage);
    const external = trackExternal(workerPage);
    await bootWorkspace(workerPage);

    await expect(station(workerPage)).toHaveAttribute(
      "data-engine",
      "worker",
      { timeout: READY_TIMEOUT }
    );

    await pasteStable(workerPage, OVERSIZE_INPUT);
    await settleReport(workerPage, "name: oversize");

    // The TRUE original byte count, not the cap — the number that used to read
    // 262144 on this path.
    const bytes = await metric(workerPage, "bytes");
    const characters = await metric(workerPage, "characters");
    const lines = await metric(workerPage, "lines");
    expect(bytes).toBe(String(OVERSIZE_TRUE_BYTES));
    await expect(workerPage.locator("#workflow-meta")).toContainText(
      `${grouped(OVERSIZE_TRUE_BYTES)} bytes`
    );

    // The ochre notice states the trim (driven by `metrics.truncated`).
    await expect(
      workerPage.getByText("trimmed to 256 KiB for analysis")
    ).toBeVisible();

    // The payload that crossed into the worker was genuinely capped, AND it
    // carried the true original byte count alongside it. Bounding the clone
    // and telling the truth are both required; this proves the payload did
    // both at once — and that the compute really left the main thread.
    const posts = await workerPage.evaluate(
      () =>
        (
          window as unknown as {
            __workerPosts: Array<Record<string, unknown>>;
          }
        ).__workerPosts
    );
    const phaseA = posts.filter((post) => post.phase === "A");
    expect(phaseA.length).toBeGreaterThan(0);
    const last = phaseA[phaseA.length - 1];
    expect(last.originalByteCount).toBe(OVERSIZE_TRUE_BYTES);
    const dispatched = byteLength(last.source as string);
    expect(dispatched).toBeLessThanOrEqual(262_144);
    expect(dispatched).toBeLessThan(OVERSIZE_TRUE_BYTES);
    // The dispatched text is a prefix of what the user pasted.
    expect(OVERSIZE_INPUT.startsWith(last.source as string)).toBe(true);

    // The analysis covered the CAPPED text: its line count is the capped one,
    // not the original's — the cap is applied to the analysis, not to the
    // reported size.
    expect(Number(lines.replace(/,/g, ""))).toBeGreaterThan(0);
    expect(Number(lines.replace(/,/g, ""))).toBeLessThan(
      OVERSIZE_INPUT.split("\n").length
    );
    expect(Number(characters.replace(/,/g, ""))).toBeLessThan(
      OVERSIZE_INPUT.length
    );

    // Zero egress on the default path, even for an oversize paste.
    expect(external).toEqual([]);

    await workerPage.close();
    return { bytes, characters, lines };
  })();

  // 2 — the FORCED-DEGRADE path: the same paste on the main thread, which
  //    receives the FULL source and must land on the same numbers.
  await killWorkerOnSpawn(page);
  const degradedExternal = trackExternal(page);
  await bootWorkspace(page);

  await expect(station(page)).toHaveAttribute("data-engine", "main", {
    timeout: READY_TIMEOUT,
  });

  await pasteStable(page, OVERSIZE_INPUT);
  await settleReport(page, "name: oversize");

  // Identical engines of truth: byte count, characters and lines all match.
  expect(await metric(page, "bytes")).toBe(worker.bytes);
  expect(worker.bytes).toBe(String(OVERSIZE_TRUE_BYTES));
  expect(await metric(page, "characters")).toBe(worker.characters);
  expect(await metric(page, "lines")).toBe(worker.lines);

  // ...and the same chip on the main-thread path.
  await expect(page.getByText("trimmed to 256 KiB for analysis")).toBeVisible();

  expect(degradedExternal).toEqual([]);
});
