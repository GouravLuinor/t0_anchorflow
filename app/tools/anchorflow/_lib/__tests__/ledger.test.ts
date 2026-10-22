import { describe, expect, it } from "vitest";
import { analyzeLocal } from "../analyze";
import { buildLedger, buildVerdict, isResolvableRow, ledgerRow } from "../ledger";
import { DEFAULT_WORKFLOW } from "../presets";
import type { ClassifiedUses, Resolution } from "../types";

const report = analyzeLocal(DEFAULT_WORKFLOW);

function use(partial: Partial<ClassifiedUses>): ClassifiedUses {
  return {
    id: "u1",
    jobId: "build",
    scope: "step",
    stepIndex: 0,
    raw: "actions/checkout@v4",
    start: 0,
    valueEnd: 19,
    existingComment: null,
    cls: "remoteRef",
    owner: "actions",
    repo: "checkout",
    subpath: null,
    ref: "v4",
    moving: true,
    ...partial,
  };
}

function resolution(ref: ClassifiedUses, partial: Partial<Resolution>): Resolution {
  return { ref, resolvedSha: null, status: "not-requested", receipt: null, ...partial };
}

describe("ledgerRow", () => {
  it("names every class in plain words", () => {
    expect(ledgerRow(use({}), null).state).toBe("moving");
    expect(ledgerRow(use({ moving: false, ref: "v4.2.0" }), null).state).toBe("tag");
    expect(ledgerRow(use({ cls: "sha40", ref: "a".repeat(40) }), null)).toMatchObject({
      state: "pinned",
      sha: "a".repeat(40),
    });
    expect(ledgerRow(use({ cls: "local" }), null).state).toBe("local");
    expect(ledgerRow(use({ cls: "docker" }), null).state).toBe("docker");
    expect(ledgerRow(use({ cls: "invalid" }), null).state).toBe("invalid");
  });

  it("carries a resolved commit as the row's seal", () => {
    const u = use({});
    const sha = "b".repeat(40);
    expect(ledgerRow(u, resolution(u, { status: "resolved", commitSha: sha }))).toMatchObject({
      state: "pinned-now",
      sha,
    });
  });

  it("keeps failed lookups visible and says why", () => {
    const u = use({});
    expect(ledgerRow(u, resolution(u, { status: "rate-limited" })).label).toMatch(/rate limit/);
    expect(ledgerRow(u, resolution(u, { status: "unsafe-ref" })).state).toBe("refused");
    const notFound = ledgerRow(u, resolution(u, { status: "unknown-ref" }));
    expect(notFound.state).toBe("unresolved");
    expect(isResolvableRow(notFound)).toBe(false);
    expect(isResolvableRow(ledgerRow(u, resolution(u, { status: "network-error" })))).toBe(true);
  });
});

describe("buildVerdict on the built-in example", () => {
  const rows = buildLedger(report.uses, report.resolutions);
  const verdict = buildVerdict(rows, report.findings);

  it("asks to resolve the unpinned remote refs", () => {
    expect(verdict.next).toBe("resolve");
    expect(verdict.resolvable).toBe(rows.filter(isResolvableRow).length);
    expect(verdict.resolvable).toBeGreaterThan(0);
    expect(verdict.headline).toMatch(/aren't pinned to a commit/);
  });

  it("summarises the non-pinning findings by grade", () => {
    expect(verdict.riskCounts.error).toBe(1);
    expect(verdict.risk).toMatch(/1 critical and 3 major findings to fix/);
  });
});

describe("buildVerdict edge cases", () => {
  it("says so when nothing needs doing", () => {
    const pinned = analyzeLocal(
      "on: push\npermissions: {}\njobs:\n  a:\n    runs-on: ubuntu-latest\n    permissions:\n      contents: read\n    steps:\n      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4\n        with:\n          persist-credentials: false\n"
    );
    const v = buildVerdict(buildLedger(pinned.uses, pinned.resolutions), pinned.findings);
    expect(v.next).toBe("none");
    expect(v.headline).toBe("Every action is already pinned to a commit.");
  });

  it("moves to copy once every ref is pinned", () => {
    const u = use({});
    const rows = [ledgerRow(u, resolution(u, { status: "resolved", commitSha: "c".repeat(40) }))];
    const v = buildVerdict(rows, []);
    expect(v.next).toBe("copy");
    expect(v.headline).toBe("Pinned 1 action to commit SHAs.");
  });

  it("handles an empty workflow", () => {
    expect(buildVerdict([], []).headline).toBe("No actions to pin in this workflow.");
  });
});
