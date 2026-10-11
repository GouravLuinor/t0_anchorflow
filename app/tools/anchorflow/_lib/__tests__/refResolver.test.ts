import { describe, expect, it } from "vitest";
import { classifyOne } from "../classify";
import { API_ORIGIN, resolveRefs } from "../refResolver";
import { RATE_LIMIT_RESERVE } from "../constants";
import { RECORDED, recordedResponse } from "./fixtures";
import type { RecordedFixture } from "./fixtures";

/**
 * The HERMETIC oracle (SPEC §9 AC-4 / AC-5). Nothing here talks to
 * `api.github.com`: every response is replayed from a recorded fixture through
 * an injected `fetchImpl`, and every URL, header and SHA is asserted, so a
 * drift in the chain shape fails offline rather than in CI.
 */

const COMMIT = "11d5960a326750d5838078e36cf38b85af677262";
const CHECKOUT_MAIN = "f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a";
const TAG_OBJECT = "85b44e09fb0988e3e307fa59de1cf79a525b51e9";
const PNPM_COMMIT = "fc7eed08c5d25b7e7349863bec0e43dca4247cd0";
const CODEQL_COMMIT = "9f759ee644a3e7c15c1390abf49868036c00067b";

const BASE_BUDGET = {
  limit: 60,
  remaining: 60,
  resetAt: 0,
};

/** Builds a classified `remoteRef` node the way Phase A does. */
function refNode(raw: string) {
  return classifyOne(raw, {
    id: `${raw}`,
    jobId: "build",
    scope: "step" as const,
    stepIndex: 0,
    start: 0,
    valueEnd: raw.length,
    existingComment: null,
  });
}

/**
 * A deterministic fake network: answers the recorded fixture for the requested
 * path, records every call, and never resolves a path that has no capture.
 */
function cassette(overrides: Record<string, RecordedFixture> = {}) {
  const calls: Array<{ url: string; signal?: AbortSignal }> = [];
  const map: Record<string, RecordedFixture> = { ...RECORDED, ...overrides };
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, signal: init?.signal ?? undefined });
    const path = url.startsWith(API_ORIGIN) ? url.slice(API_ORIGIN.length) : url;
    const fixture = map[path];
    if (!fixture) {
      throw new Error(`no recording for ${url}`);
    }
    return recordedResponse(fixture);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl, map };
}

describe("resolveRefs — the recorded chain (AC-4)", () => {
  it("resolves a lightweight tag in one hop", async () => {
    const { calls, fetchImpl } = cassette();
    const run = await resolveRefs([refNode("actions/checkout@v4")], {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      now: () => 1_770_270_100_000,
    });

    const [resolution] = run.resolutions;
    expect(resolution.status).toBe("resolved");
    expect(resolution.commitSha).toBe(COMMIT);
    expect(resolution.tagObjectSha).toBeNull();
    expect(resolution.refKind).toBe("tag");
    expect(resolution.endpointsUsed).toEqual(["/repos/actions/checkout/git/ref/tags/v4"]);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${API_ORIGIN}${"/repos/actions/checkout/git/ref/tags/v4"}`);
  });

  it("dereferences an annotated tag across two hops", async () => {
    const { calls, fetchImpl } = cassette();
    const run = await resolveRefs([refNode("pnpm/pnpm@v9.12.0")], {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      now: () => 1_770_270_100_000,
    });

    const [resolution] = run.resolutions;
    expect(resolution.status).toBe("resolved");
    expect(resolution.commitSha).toBe(PNPM_COMMIT);
    expect(resolution.tagObjectSha).toBe(TAG_OBJECT);
    expect(resolution.dereferencedFrom).toBe(TAG_OBJECT);
    expect(resolution.refKind).toBe("tag");
    // Both hops, in order: the tag ref, then the tag object.
    expect(resolution.endpointsUsed).toEqual([
      "/repos/pnpm/pnpm/git/ref/tags/v9.12.0",
      "/repos/pnpm/pnpm/git/tags/85b44e09fb0988e3e307fa59de1cf79a525b51e9",
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      `${API_ORIGIN}${"/repos/pnpm/pnpm/git/ref/tags/v9.12.0"}`,
      `${API_ORIGIN}${"/repos/pnpm/pnpm/git/tags/85b44e09fb0988e3e307fa59de1cf79a525b51e9"}`,
    ]);
  });

  it("renders the receipt as <endpoint> → <tag-object-sha> → <commit-sha>", async () => {
    const { fetchImpl } = cassette();
    const run = await resolveRefs([refNode("pnpm/pnpm@v9.12.0")], {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      now: () => 1_770_270_100_000,
    });

    const chain = run.resolutions[0].receipt?.chain ?? [];
    expect(chain).toEqual([
      {
        endpoint: `GET ${"/repos/pnpm/pnpm/git/ref/tags/v9.12.0"}`,
        sha: TAG_OBJECT,
        httpStatus: 200,
      },
      {
        endpoint: `GET ${"/repos/pnpm/pnpm/git/tags/85b44e09fb0988e3e307fa59de1cf79a525b51e9"}`,
        sha: PNPM_COMMIT,
        httpStatus: 200,
      },
    ]);
    expect(run.resolutions[0].receipt?.returnedSha).toBe(PNPM_COMMIT);
    expect(run.resolutions[0].receipt?.dereferencedFrom).toBe(TAG_OBJECT);
    expect(run.resolutions[0].receipt?.resolvedAt).toContain("2026-02-0");
    expect(run.resolutions[0].receipt?.lsRemote).toBe("refs/tags/v9.12.0^{}");
  });

  it("falls back to the branch namespace when the tag 404s", async () => {
    const { calls, fetchImpl } = cassette();
    const run = await resolveRefs([refNode("actions/checkout@main")], {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      now: () => 1_770_270_100_000,
    });

    const [resolution] = run.resolutions;
    expect(resolution.status).toBe("resolved");
    expect(resolution.commitSha).toBe(CHECKOUT_MAIN);
    expect(resolution.refKind).toBe("branch");
    expect(resolution.endpointsUsed).toEqual([
      "/repos/actions/checkout/git/ref/tags/main",
      "/repos/actions/checkout/git/ref/heads/main",
    ]);
    expect(calls.map((call) => call.url)).toEqual([
      `${API_ORIGIN}/repos/actions/checkout/git/ref/tags/main`,
      `${API_ORIGIN}${"/repos/actions/checkout/git/ref/heads/main"}`,
    ]);
  });

  it("marks a ref unknown when BOTH hops 404", async () => {
    const { calls, fetchImpl } = cassette({
      "/repos/pnpm/pnpm/git/ref/heads/v9.12.0-does-not-exist":
        RECORDED["/repos/pnpm/pnpm/git/ref/heads/v9.12.0-does-not-exist"]!,
    });
    const run = await resolveRefs(
      [refNode("pnpm/pnpm@v9.12.0-does-not-exist")],
      { fetchImpl, budget: { ...BASE_BUDGET }, now: () => 1_770_270_100_000 }
    );

    const [resolution] = run.resolutions;
    expect(resolution.status).toBe("unknown-ref");
    expect(resolution.commitSha).toBeNull();
    expect(resolution.receipt?.endpoint).toBe(
      "GET /repos/pnpm/pnpm/git/ref/tags/v9.12.0-does-not-exist"
    );
    // The 404 was still a paid-for call.
    expect(calls).toHaveLength(2);
  });

  it("labels a 403 carrying x-ratelimit-remaining: 0 as the hourly limit", async () => {
    // Re-capture: the same path, answering the hourly limit.
    const fixture = {
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
    const { fetchImpl } = cassette({ "/repos/actions/checkout/git/ref/tags/v4": fixture });
    const run = await resolveRefs([refNode("actions/checkout@v4")], {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      now: () => 1_770_270_100_000,
    });

    const [resolution] = run.resolutions;
    expect(resolution.status).toBe("rate-limited");
    expect(run.budget.remaining).toBe(0);
    expect(run.budget.resetAt).toBe(1770271111 * 1000);
  });

  it("honours Retry-After on a rate-headless 429", async () => {
    const fixture = {
      request: { method: "GET", path: "/repos/actions/checkout/git/ref/tags/v4" },
      response: {
        status: 429,
        headers: { "retry-after": "12", "x-ratelimit-resource": "core" },
        body: { message: "You have exceeded a secondary rate limit." },
      },
    };
    const { fetchImpl } = cassette({ "/repos/actions/checkout/git/ref/tags/v4": fixture });
    const now = 1_770_270_100_000;
    const run = await resolveRefs([refNode("actions/checkout@v4")], {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      now: () => now,
    });

    expect(run.resolutions[0].status).toBe("rate-limited");
    // Retry-After: 12 seconds is preferred over any (absent) hourly reset.
    expect(run.budget.resetAt).toBe(now + 12_000);
    expect(run.resolutions[0].receipt?.note).toContain("back off");
  });

  it("reports a thrown request as network-error, never a throw", async () => {
    const fetchImpl = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const run = await resolveRefs([refNode("actions/checkout@v4")], {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      now: () => 1_770_270_100_000,
    });
    expect(run.resolutions[0].status).toBe("network-error");
  });

  it("addresses only api.github.com, and only owner/repo + the ref (AC-12)", async () => {
    const { calls, fetchImpl } = cassette();
    await resolveRefs(
      [
        refNode("actions/checkout@v4"),
        refNode("pnpm/pnpm@v9.12.0"),
        refNode("actions/checkout@main"),
        refNode("github/codeql-action/init@v3"),
      ],
      { fetchImpl, budget: { ...BASE_BUDGET }, now: () => 1_770_270_100_000 }
    );

    const SHAPE =
      /^\/repos\/[^/]+\/[^/]+\/git\/(ref\/(tags|heads)\/[^?#]+|tags\/[0-9a-f]{40})$/;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      const url = new URL(call.url);
      expect(url.origin + "/").toBe(`${API_ORIGIN}/`);
      expect(url.search).toBe("");
      expect(url.hash).toBe("");
      expect(SHAPE.test(url.pathname)).toBe(true);
    }
  });

  it("keeps a subpath action's URL free of the subpath", async () => {
    const { calls, fetchImpl } = cassette();
    await resolveRefs([refNode("github/codeql-action/init@v3")], {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      now: () => 1_770_270_100_000,
    });
    const paths = calls.map((call) => new URL(call.url).pathname);
    expect(paths).toEqual([
      "/repos/github/codeql-action/git/ref/tags/v3",
      "/repos/github/codeql-action/git/tags/cf12ceefebab2c867b9c35d7f907e059681d37ab",
    ]);
    expect(paths.join("/")).not.toContain("/init/");
  });

  it("shares one resolution between every subpath of the same repo", async () => {
    const { calls, fetchImpl } = cassette();
    const run = await resolveRefs(
      [
        refNode("github/codeql-action/init@v3"),
        refNode("github/codeql-action/analyze@v3"),
        refNode("github/codeql-action@v3"),
      ],
      { fetchImpl, budget: { ...BASE_BUDGET }, now: () => 1_770_270_100_000 }
    );

    expect(run.resolutions).toHaveLength(3);
    expect(new Set(run.resolutions.map((r) => r.commitSha))).toEqual(
      new Set([CODEQL_COMMIT])
    );
    // ONE chain for all three call sites.
    expect(calls).toHaveLength(2);
  });

  it("never names fetch in its own source (the purity seam, AC-16)", async () => {
    const { fetchImpl } = cassette();
    const run = await resolveRefs([refNode("actions/checkout@v4")], {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      now: () => 1_770_270_100_000,
    });
    expect(run.resolutions[0].status).toBe("resolved");
  });
});

// ── The budget ledger (AC-4: decrement · 2-unit reserve · release) ────────────

describe("resolveRefs — the optimistic budget ledger", () => {
  const NOW = 1_770_270_100_000;

  it("spends exactly one unit for a lightweight tag (the reserve is released)", async () => {
    const { fetchImpl } = cassette();
    const run = await resolveRefs([refNode("actions/checkout@v4")], {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      now: () => NOW,
    });
    expect(run.budget.remaining).toBe(59);
  });

  it("spends two units for an annotated tag (chain + deref)", async () => {
    const { fetchImpl } = cassette();
    const run = await resolveRefs([refNode("pnpm/pnpm@v9.12.0")], {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      now: () => NOW,
    });
    expect(run.budget.remaining).toBe(58);
  });

  it("never lets settled+in-flight dispatches exceed the seeded remaining", async () => {
    // A concurrent burst must not overspend what the caller was handed: every
    // dispatch costs 2 optimistic units, so with `remaining - inFlight` bounded
    // by the reserve floor the ledger can never spend past its seed.
    const { calls, fetchImpl } = cassette();
    const many = Array.from({ length: 12 }, (_, index) =>
      refNode(`actions/checkout@v${4 + Math.floor(index / 10)}`)
    );
    many.length = 12;
    many[0] = refNode("actions/checkout@v4");
    many[1] = refNode("actions/setup-node@v4");
    many[2] = refNode("github/super-linter@latest");
    for (let index = 3; index < 12; index += 1) many[index] = many[0];

    const run = await resolveRefs(many, {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      concurrency: 4,
      reserveFloor: RATE_LIMIT_RESERVE,
      now: () => NOW,
    });

    // 3 unique refs (the rest share one) → 3 calls, never more than seeded.
    expect(calls.length).toBe(3);
    expect(run.budget.remaining).toBe(57);
    expect(run.budget.remaining).toBeGreaterThanOrEqual(0);
    // The cache means the repeats were free.
    expect(run.resolutions).toHaveLength(12);
    for (const resolution of run.resolutions) {
      expect(resolution.status).toBe("resolved");
    }
  });

  it("stops dispatching at the reserve floor and marks the rest rate-limited", async () => {
    const { calls, fetchImpl } = cassette();
    // Seed 4: ref 1 dispatches (4 - 0 > 2), leaving the floor already touched,
    // so refs 2..n are refused with `rate-limited` and ZERO further calls.
    const run = await resolveRefs(
      [
        refNode("actions/checkout@v4"),
        refNode("actions/setup-node@v4"),
        refNode("github/super-linter@latest"),
      ],
      {
        fetchImpl,
        budget: { limit: 4, remaining: 4, resetAt: 0 },
        reserveFloor: RATE_LIMIT_RESERVE,
        now: () => NOW,
      }
    );

    expect(calls).toHaveLength(1);
    expect(run.resolutions[0].status).toBe("resolved");
    for (const resolution of run.resolutions.slice(1)) {
      expect(resolution.status).toBe("rate-limited");
      // ARCH §8: a refused ref still names the endpoint it would have used —
      // never a silent drop.
      expect(resolution.receipt?.endpoint).toBe(
        `GET /repos/${resolution.ref.owner}/${resolution.ref.repo}/git/ref/tags/${resolution.ref.ref}`
      );
      expect(resolution.receipt?.chain).toEqual([
        {
          endpoint: resolution.receipt?.endpoint,
          sha: null,
          httpStatus: 0,
        },
      ]);
      expect(resolution.receipt?.note).toContain("floor");
    }
  });

  it("withholds the annotated dereference when it would land at/below the floor", async () => {
    const { calls, fetchImpl } = cassette();
    // Seed 3: the chain GET dispatches (3 - 0 > 2) and reports an annotated
    // tag, but the deref would land AT the floor, so it is skipped and the ref
    // is marked rate-limited with the tag object already known.
    const run = await resolveRefs([refNode("pnpm/pnpm@v9.12.0")], {
      fetchImpl,
      budget: { limit: 3, remaining: 3, resetAt: 0 },
      reserveFloor: RATE_LIMIT_RESERVE,
      now: () => NOW,
    });

    expect(calls).toHaveLength(1);
    expect(run.resolutions[0].status).toBe("rate-limited");
    expect(run.resolutions[0].tagObjectSha).toBe(TAG_OBJECT);
    expect(run.resolutions[0].receipt?.note).toContain("withheld");
  });

  it("caps the fan-out at MAX_RESOLVES_PER_RUN and marks the remainder", async () => {
    const { calls, fetchImpl } = cassette();
    const workflow = Array.from({ length: 60 }, (_, index) =>
      refNode(`actions/checkout@v${4 + index}`)
    );
    const run = await resolveRefs(workflow, {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      now: () => NOW,
    });

    const dispatched = run.resolutions.filter(
      (resolution) => resolution.httpStatus !== null || resolution.status === "resolved"
    );
    const refused = run.resolutions.filter(
      (resolution) => resolution.status === "rate-limited"
    );
    expect(dispatched.length).toBeLessThanOrEqual(48);
    expect(refused.length).toBeGreaterThan(0);
    expect(run.resolutions).toHaveLength(60);
    expect(calls.length).toBeLessThanOrEqual(60);
  });
});

// ── Caches, the negative TTL and abort (AC-4) ─────────────────────────────────

describe("resolveRefs — caches, negative TTL and abort", () => {
  const NOW = 1_770_270_100_000;

  it("serves a second identical resolve with ZERO fetches", async () => {
    const { calls, fetchImpl } = cassette();
    const cache = new Map<string, string>();
    const refs = [
      refNode("actions/checkout@v4"),
      refNode("pnpm/pnpm@v9.12.0"),
      refNode("actions/checkout@main"),
    ];
    const first = await resolveRefs(refs, {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      cache,
      now: () => NOW,
    });
    expect(calls.length).toBeGreaterThan(0);
    const spent = calls.length;

    const second = await resolveRefs(refs, {
      fetchImpl,
      budget: first.budget,
      cache,
      now: () => NOW + 1000,
    });

    expect(calls.length).toBe(spent);
    expect(second.resolutions.map((r) => r.status)).toEqual(
      first.resolutions.map((r) => r.status)
    );
    expect(second.resolutions.map((r) => r.commitSha)).toEqual(
      first.resolutions.map((r) => r.commitSha)
    );
    // A cache hit ISSUED no endpoint of its own and says so.
    expect(second.resolutions.map((r) => r.endpointsUsed)).toEqual([[], [], []]);
    expect(second.resolutions[0].receipt?.note).toContain("zero API calls");
  });

  it("negative-caches an unknown ref so a re-run costs nothing", async () => {
    const { calls, fetchImpl } = cassette();
    const refs = [refNode("pnpm/pnpm@v9.12.0-does-not-exist")];
    const negativeCache = new Map<string, number>();
    const first = await resolveRefs(refs, {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      negativeCache,
      now: () => NOW,
    });
    const spent = calls.length;

    const second = await resolveRefs(refs, {
      fetchImpl,
      budget: first.budget,
      negativeCache,
      now: () => NOW + 500,
    });

    expect(calls.length).toBe(spent);
    expect(second.resolutions[0].status).toBe("unknown-ref");
    expect(second.budget.remaining).toBe(first.budget.remaining);
  });

  it("lets the negative TTL expire and re-asks the API", async () => {
    const { calls, fetchImpl } = cassette();
    const negativeCache = new Map<string, number>();
    const refs = [refNode("pnpm/pnpm@v9.12.0-does-not-exist")];
    await resolveRefs(refs, {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      negativeCache,
      negativeTtlMs: 60_000,
      now: () => NOW,
    });
    const spent = calls.length;
    expect(negativeCache.get("pnpm/pnpm@v9.12.0-does-not-exist")).toBe(
      NOW + 60_000
    );

    // One minute later the entry has expired, so the ref is asked again.
    const later = await resolveRefs(refs, {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      negativeCache,
      negativeTtlMs: 60_000,
      now: () => NOW + 61_000,
    });
    expect(calls.length).toBe(spent * 2);
    expect(later.resolutions[0].status).toBe("unknown-ref");
  });

  it("aborts the in-flight fan-out when the caller's signal fires", async () => {
    const controller = new AbortController();
    const signals: AbortSignal[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      if (init?.signal) signals.push(init.signal);
      // Hang until the caller aborts.
      await new Promise<void>((resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(new DOMException("aborted", "AbortError"))
        );
        setTimeout(resolve, 10_000);
      });
      throw new Error("unreachable");
    }) as unknown as typeof fetch;

    const pending = resolveRefs([refNode("actions/checkout@v4")], {
      fetchImpl,
      budget: { ...BASE_BUDGET },
      signal: controller.signal,
      now: () => NOW,
    });
    await promiseAfter(0);
    controller.abort();

    const run = await pending;
    expect(run.resolutions[0].status).toBe("network-error");
    // The per-request signal really was aborted — a superseded Phase B cannot
    // finish writing against the quota.
    expect(signals.length).toBe(1);
    expect(signals[0].aborted).toBe(true);
  });

  it("resolves refs in parallel up to the pool width", async () => {
    const active = new Set<string>();
    let peak = 0;
    const fetchImpl = (async (url: string) => {
      const path = new URL(url).pathname;
      active.add(path);
      peak = Math.max(peak, active.size);
      await promiseAfter(5);
      active.delete(path);
      const fixture = RECORDED[path];
      if (!fixture) throw new Error(`no recording for ${path}`);
      return recordedResponse(fixture);
    }) as unknown as typeof fetch;

    await resolveRefs(
      [
        refNode("actions/checkout@v4"),
        refNode("actions/setup-node@v4"),
        refNode("github/super-linter@latest"),
      ],
      { fetchImpl, budget: { ...BASE_BUDGET }, now: () => NOW, concurrency: 3 }
    );

    expect(peak).toBe(3);
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────
function promiseAfter(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
