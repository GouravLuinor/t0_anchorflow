import { describe, expect, it } from "vitest";
import { analyzeLocal } from "../analyze";
import { analyzeResolve } from "../compute";
import { DEFAULT_WORKFLOW } from "../presets";
import { DEFAULT_RATE_LIMIT } from "../constants";
import { RECORDED, recordedResponse } from "./fixtures";
import type { RecordedFixture } from "./fixtures";

/**
 * The Phase-B merge contract applied to a REAL workflow (SPEC §9 AC-13):
 * the offline report survives a 429 with every finding, permission row, uses
 * classification and diff intact, and the unresolved refs are MARKED, never
 * silently dropped.
 */

const NOW = 1_770_270_100_000;
const BUDGET = { ...DEFAULT_RATE_LIMIT };

/** Serves the recorded fixtures, or `override` for every request. */
function fakeNetwork(override?: RecordedFixture) {
  const calls: string[] = [];
  const fetchImpl = (async (url: string) => {
    calls.push(url);
    const path = url.replace("https://api.github.com", "");
    const fixture = override ?? RECORDED[path];
    if (!fixture) throw new Error(`no recording for ${path}`);
    return recordedResponse(fixture);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const SAMPLE_WORKFLOW = `name: release

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
      - run: npm test
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4 # v4
        with:
          ref: main
      - run: npm publish
`;

describe("analyzeResolve — the resolved run", () => {
  it("pins the sample workflow's refs and preserves the # comment", async () => {
    const { fetchImpl } = fakeNetwork();
    const phaseA = analyzeLocal(SAMPLE_WORKFLOW);

    const merged = await analyzeResolve(phaseA, {
      fetchImpl,
      resolve: true,
      budget: { ...BUDGET },
      now: () => NOW,
      negativeCache: new Map<string, number>(),
    });

    // The comment survives the pin (AC-3).
    expect(merged.rewrittenYaml).toContain(
      "- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4"
    );
    // A non-moving pinned tag is replaced too.
    expect(merged.rewrittenYaml).toContain(
      "actions/setup-node@1d0ff469b7ec7b3cb9d8673fde0c81c44821de2a # v4.2.0"
    );
    // Untouched lines survive byte-for-byte.
    expect(merged.rewrittenYaml).toContain("- run: npm ci");
    expect(merged.ok).toBe(phaseA.ok);
    // Every workflow line that held a remote ref is now one changed line.
    const remoteRefs = phaseA.uses.filter((u) => u.cls === "remoteRef");
    expect(remoteRefs).toHaveLength(3);
    expect(merged.diff?.changed).toBe(remoteRefs.length);
    expect(merged.metrics.resolvedCount).toBe(remoteRefs.length);
    // The pinned pins are exactly the recorded SHAs.
    const pins = (merged.rewrittenYaml ?? "").match(/@[0-9a-f]{40}/g) ?? [];
    expect(new Set(pins).size).toBe(2);
  });

  it("keeps the source it was handed when nothing resolves (the AC-2 no-op)", async () => {
    const phaseA = analyzeLocal(SAMPLE_WORKFLOW);
    const merged = await analyzeResolve(phaseA, {
      fetchImpl: (async () => {
        throw new Error("never called — resolve is false");
      }) as unknown as typeof fetch,
      resolve: false,
      budget: { ...BUDGET },
      now: () => NOW,
    });
    expect(merged.rewrittenYaml).toBe(phaseA.rewrittenYaml);
    expect(merged.resolutions).toEqual([]);
    expect(merged.findings).toEqual(phaseA.findings);
  });

  it("preserves every offline audit finding on the resolved run", async () => {
    const { fetchImpl } = fakeNetwork();
    const phaseA = analyzeLocal(SAMPLE_WORKFLOW);
    const offline = phaseA.findings.map((f) => f.id);
    const merged = await analyzeResolve(phaseA, {
      fetchImpl,
      resolve: true,
      budget: { ...BUDGET },
      now: () => NOW,
      negativeCache: new Map<string, number>(),
    });

    const ids = merged.findings.map((f) => f.id);
    for (const id of offline) expect(ids).toContain(id);
    expect(merged.permissions).toEqual(phaseA.permissions);
    expect(merged.uses).toEqual(phaseA.uses);
  });

  it("emits only resolution-category Phase-B findings", async () => {
    const { fetchImpl } = fakeNetwork();
    const phaseA = analyzeLocal(SAMPLE_WORKFLOW);
    const offline = new Set(phaseA.findings.map((f) => f.id));
    const merged = await analyzeResolve(phaseA, {
      fetchImpl,
      resolve: true,
      budget: { ...BUDGET },
      now: () => NOW,
      negativeCache: new Map<string, number>(),
    });
    const added = merged.findings.filter((f) => !offline.has(f.id));
    expect(added.length).toBeGreaterThan(0);
    for (const finding of added) {
      expect(finding.category).toBe("resolution");
    }
  });
});

describe("analyzeResolve — the 429 Phase-B (SPEC AC-13, the C1 invariant)", () => {
  it("keeps the COMPLETE offline report across a 429 and marks the refs", async () => {
    // The same path, re-captured as a rate-headless secondary-limit 429.
    const rateLimited: RecordedFixture = {
      request: { method: "GET", path: "/repos/actions/checkout/git/ref/tags/v4" },
      response: {
        status: 429,
        headers: { "retry-after": "60", "x-ratelimit-resource": "core" },
        body: { message: "You have exceeded a secondary rate limit." },
      },
    };
    const { calls, fetchImpl } = fakeNetwork(rateLimited);
    const phaseA = analyzeLocal(SAMPLE_WORKFLOW);
    const offline = phaseA.findings;
    const before = phaseA.rewrittenYaml ?? "";

    const merged = await analyzeResolve(phaseA, {
      fetchImpl,
      resolve: true,
      budget: { ...BUDGET },
      now: () => NOW,
      negativeCache: new Map<string, number>(),
    });

    // 1. the offline report SURVIVES: every offline finding, unchanged.
    expect(merged.ok).toBe(true);
    for (const finding of offline) {
      expect(merged.findings).toContainEqual(finding);
    }
    expect(merged.findings.length).toBeGreaterThanOrEqual(offline.length);
    expect(merged.permissions).toEqual(phaseA.permissions);
    expect(merged.uses).toEqual(phaseA.uses);
    expect(merged.metrics.parseTimeMs).toBe(phaseA.metrics.parseTimeMs);

    // 2. nothing was rewritten — the source is untouched.
    expect(merged.rewrittenYaml).toBe(before);
    expect(merged.diff?.changed ?? 0).toBe(0);

    // 3. the refs are MARKED, not dropped: resolution findings say why.
    const added = merged.findings.filter(
      (f) => f.category === "resolution"
    );
    expect(added.length).toBeGreaterThan(0);
    const statusFindings = added.filter(
      (f) => f.title.startsWith("Not resolved") || f.title.startsWith("Unknown ref")
    );
    expect(statusFindings.length).toBeGreaterThan(0);
    for (const finding of statusFindings) {
      expect(finding.detail).toContain("still complete");
    }
    // The moving-ref drift finding is the third Phase-B kind.
    const moving = added.filter((f) => f.title.startsWith("Moving ref"));
    expect(moving.length).toBeGreaterThan(0);
    for (const finding of moving) {
      expect(finding.title).toContain("not pinned to a SHA");
    }

    // 4. every remoteRef either resolved or carries a status.
    const withStatus = (merged.uses ?? []).filter(
      (use) => use.cls === "remoteRef"
    );
    const resolved = new Set(merged.resolutions.map((r) => r.ref.id));
    expect(resolved.size).toBe(withStatus.length);
    expect(calls.length).toBeGreaterThan(0);
  });

  it("keeps the offline report across a 403 with x-ratelimit-remaining: 0", async () => {
    const hourly: RecordedFixture = {
      request: { method: "GET", path: "/repos/actions/checkout/git/ref/tags/v4" },
      response: {
        status: 403,
        headers: {
          "content-type": "application/json",
          "x-ratelimit-limit": "60",
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1770271111",
          "x-ratelimit-resource": "core",
        },
        body: { message: "API rate limit exceeded for 203.0.113.10." },
      },
    };
    const { fetchImpl } = fakeNetwork(hourly);
    const phaseA = analyzeLocal(SAMPLE_WORKFLOW);
    const offline = phaseA.findings;

    const merged = await analyzeResolve(phaseA, {
      fetchImpl,
      resolve: true,
      budget: { ...BUDGET },
      now: () => NOW,
      negativeCache: new Map<string, number>(),
    });

    expect(merged.rewrittenYaml).toBe(phaseA.rewrittenYaml);
    for (const finding of offline) {
      expect(merged.findings).toContainEqual(finding);
    }
    expect(merged.rateLimit.remaining).toBe(0);
    expect(merged.rateLimit.resetAt).toBe(
      Number(hourly.response.headers["x-ratelimit-reset"]) * 1000
    );
  });
});

describe("analyzeResolve — partial budget and the cap", () => {
  it("stops fan-out at the reserve floor, still returning the offline report", async () => {
    const { calls, fetchImpl } = fakeNetwork();
    const phaseA = analyzeLocal(SAMPLE_WORKFLOW);
    const merged = await analyzeResolve(phaseA, {
      fetchImpl,
      resolve: true,
      budget: { limit: 60, remaining: 3, resetAt: 0 },
      now: () => NOW,
      negativeCache: new Map<string, number>(),
    });

    expect(merged.ok).toBe(true);
    expect(calls.length).toBe(1);
    expect(merged.findings.length).toBeGreaterThan(phaseA.findings.length);
    const unresolved = merged.resolutions.filter(
      (r) => r.status !== "resolved"
    );
    expect(unresolved.length).toBeGreaterThan(0);
    for (const resolution of unresolved) {
      expect(resolution.status).toBe("rate-limited");
      expect(resolution.receipt?.note).toContain("floor");
    }
  });

  it("marks a ref that exceeds MAX_RESOLVES_PER_RUN without dropping it", async () => {
    const many = [
      "name: many",
      "",
      "jobs:",
      "  build:",
      "    steps:",
      ...Array.from(
        { length: 60 },
        (_, index) => `      - uses: owner-${index}/repo@v1`
      ),
    ].join("\n");
    const { fetchImpl } = fakeNetwork();
    const phaseA = analyzeLocal(many);
    const merged = await analyzeResolve(phaseA, {
      fetchImpl,
      resolve: true,
      budget: { ...BUDGET },
      now: () => NOW,
      negativeCache: new Map<string, number>(),
    });

    expect(merged.resolutions).toHaveLength(60);
    expect(merged.ok).toBe(true);
    const refused = merged.resolutions.filter(
      (r) => r.status === "rate-limited"
    );
    expect(refused.length).toBeGreaterThan(0);
  });
});

describe("analyzeResolve — the seeded default workflow", () => {
  it("keeps the default workflow on the zero-egress path until asked", async () => {
    const phaseA = analyzeLocal(DEFAULT_WORKFLOW);
    // No fetchImpl, no resolve flag → the scaffold no-op that never egresses.
    const merged = await analyzeResolve(phaseA, { now: () => NOW });
    expect(merged.rewrittenYaml).toBe(phaseA.rewrittenYaml);
    expect(merged.resolutions).toEqual([]);
    expect(merged.findings).toEqual(phaseA.findings);
  });

  it("resolves every moving ref in the seeded workflow", async () => {
    const { fetchImpl } = fakeNetwork();
    const phaseA = analyzeLocal(DEFAULT_WORKFLOW);
    const merged = await analyzeResolve(phaseA, {
      fetchImpl,
      resolve: true,
      budget: { ...BUDGET },
      now: () => NOW,
      negativeCache: new Map<string, number>(),
    });

    const remoteRefs = phaseA.uses.filter((u) => u.cls === "remoteRef");
    expect(remoteRefs.length).toBeGreaterThan(1);
    expect(merged.resolutions).toHaveLength(remoteRefs.length);
    // Every remote ref became a 40-hex pin carrying its original ref comment.
    for (const resolution of merged.resolutions) {
      if (resolution.status !== "resolved") continue;
      const uses = resolution.ref;
      const pin = `@${resolution.commitSha}`;
      expect(merged.rewrittenYaml).toContain(pin);
      expect(resolution.receipt?.returnedSha).toBe(resolution.commitSha);
      // The comment the author wrote survives the pin VERBATIM, and the pin
      // label is appended after it (AC-3).
      if (uses.raw === "actions/checkout@v4") {
        expect(merged.rewrittenYaml).toContain(`${pin}   # needed for CI # v4`);
      }
    }
    expect(merged.rewrittenYaml).not.toBe(phaseA.rewrittenYaml);
  });
});

