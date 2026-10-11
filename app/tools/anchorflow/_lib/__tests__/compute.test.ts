import { describe, expect, it } from "vitest";
import { analyzeResolve, runPhaseA, toOutputPayload } from "../compute";
import { analyzeLocal } from "../analyze";
import { DEFAULT_RATE_LIMIT } from "../constants";
import type { ClassifiedUses, Finding, GrantTable } from "../types";

function phaseAWith(overrides: Partial<ReturnType<typeof analyzeLocal>>) {
  return { ...analyzeLocal("name: ci\n"), ...overrides };
}

describe("runPhaseA — the offline report", () => {
  it("never touches the network and always returns the full envelope", () => {
    const body = runPhaseA("name: ci\n");
    expect(body.ok).toBe(true);
    // The derived surfaces are present, and the no-resolution rewrite is a
    // byte-identical NO-OP (AC-2) — there is no echo mirror any more.
    expect(body.rewrittenYaml).toBe("name: ci\n");
    expect(body.diff).toEqual({ changed: 0, lines: [] });
    expect(body.uses).toEqual([]);
    expect(body.findings).toEqual([]);
    expect(body.permissions).toBeNull();
  });
});

describe("analyzeResolve — the C1 merge invariant", () => {
  const offlineFinding: Finding = {
    id: "moving-ref:build:0:1",
    category: "moving-ref",
    severity: "warn",
    title: "Moving ref",
    detail: "@v4 is a floating major",
    remediation: "Pin to a commit SHA",
    where: "jobs.build.steps[0].uses",
    start: 42,
  };

  const grantTable: GrantTable = {
    top: { all: "read", scopes: {} },
    jobs: [{ jobId: "build", block: null }],
    effective: [{ scope: "contents", level: "read", source: "top" }],
    unset: false,
  };

  const remoteRef: ClassifiedUses = {
    id: "build:0",
    jobId: "build",
    scope: "step",
    stepIndex: 0,
    raw: "actions/checkout@v4",
    start: 10,
    valueEnd: 31,
    existingComment: null,
    cls: "remoteRef",
    owner: "actions",
    repo: "checkout",
    subpath: null,
    ref: "v4",
    moving: true,
  };

  it("takes the Phase-A report and returns the FULL envelope", () => {
    const phaseA = phaseAWith({ findings: [offlineFinding] });
    const merged = analyzeResolve(phaseA);

    expect(merged.uses).toEqual(phaseA.uses);
    expect(merged.permissions).toBe(phaseA.permissions);
    expect(merged.ok).toBe(phaseA.ok);
    // With no resolutions the Phase-A no-op rewrite is CARRIED OVER, never
    // blanked — a partial Phase-B envelope cannot erase the offline report.
    expect(merged.rewrittenYaml).toBe(phaseA.rewrittenYaml);
    expect(merged.diff).toBe(phaseA.diff);
    expect(Object.keys(merged).sort()).toEqual(Object.keys(phaseA).sort());
  });

  it("preserves the offline findings, never blanking them", () => {
    const merged = analyzeResolve(
      phaseAWith({ findings: [offlineFinding], permissions: grantTable })
    );
    expect(merged.findings).toContainEqual(offlineFinding);
    expect(merged.permissions).toEqual(grantTable);
  });

  it("is defensive against a missing incoming array", () => {
    // A hand-edited or older Phase-A body must not wipe the offline report.
    const partial = {
      ...analyzeLocal("name: ci"),
      findings: undefined as unknown as Finding[],
    };
    const merged = analyzeResolve(partial);
    expect(Array.isArray(merged.findings)).toBe(true);
    expect(merged.findings).toEqual([]);
  });

  it("keeps the Phase-A timings and adds its own resolve slice", () => {
    const phaseA = phaseAWith({});
    phaseA.metrics.parseTimeMs = 12.5;
    const merged = analyzeResolve(phaseA);
    expect(merged.metrics.parseTimeMs).toBe(12.5);
    expect(merged.metrics.resolveTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("keeps ok true — a Phase-B failure never flips the offline verdict", () => {
    const merged = analyzeResolve(phaseAWith({ ok: true }));
    expect(merged.ok).toBe(true);
  });

  it("keeps the rate budget it was handed", () => {
    const budget = { limit: 60, remaining: 42, resetAt: 1_700_000_000 };
    const merged = analyzeResolve(phaseAWith({ rateLimit: budget }));
    expect(merged.rateLimit).toEqual(budget);
  });

  it("classifies nothing when the offline report has no refs (scaffold)", () => {
    const merged = analyzeResolve(
      phaseAWith({ uses: [remoteRef], findings: [offlineFinding] })
    );
    // Resolutions land with M2; the seam keeps `uses` from Phase A untouched.
    expect(merged.uses).toEqual([remoteRef]);
    expect(merged.findings).toEqual([offlineFinding]);
    expect(merged.resolutions).toEqual([]);
  });

  it("honours the injected clock for determinism", () => {
    const merged = analyzeResolve(analyzeLocal("name: ci"), { now: () => 3 });
    expect(merged.metrics.resolveTimeMs).toBe(0);
  });
});

describe("toOutputPayload — stamps the correlation fields", () => {
  it("attaches the dispatch id and phase to the body", () => {
    const payload = toOutputPayload(analyzeLocal("name: ci"), {
      id: 7,
      phase: "B",
    });
    expect(payload.id).toBe(7);
    expect(payload.phase).toBe("B");
    expect(payload.rateLimit).toEqual({ ...DEFAULT_RATE_LIMIT });
  });
});
