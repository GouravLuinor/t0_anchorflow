import { describe, expect, it } from "vitest";
import { analyzeLocal } from "../analyze";
import { DEFAULT_WORKFLOW, TRUST_PILLS } from "../presets";

/**
 * The seeded first run is a contract, not a convenience: a blank instrument is
 * a defect (BAR §2.3). The seed must be a real workflow, non-blank, and carry
 * the material every future audit needs — a moving ref, a floating tag and an
 * over-broad grant — with zero network required to report on it.
 */
describe("DEFAULT_WORKFLOW — seeded first run (SPEC §9 AC-14)", () => {
  it("is non-blank and shaped like a workflow", () => {
    expect(DEFAULT_WORKFLOW.length).toBeGreaterThan(200);
    expect(DEFAULT_WORKFLOW).toMatch(/^name:/m);
    expect(DEFAULT_WORKFLOW).toMatch(/^on:/m);
    expect(DEFAULT_WORKFLOW).toMatch(/^jobs:/m);
  });

  it("carries at least one step-level and one job-level action reference", () => {
    const uses = DEFAULT_WORKFLOW.match(/uses:\s*\S+/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(3);
    // A job-level reusable-workflow call, so the "job" scope is exercised too.
    expect(DEFAULT_WORKFLOW).toMatch(
      /^\s{4}uses: octo-org\/reusable\/\.github\/workflows\/release\.yml@main$/m
    );
  });

  it("carries a MOVING ref — the network-free finding the first paint reports", () => {
    // actions/checkout@v4 is a floating major: moving by the adjudicated rule.
    expect(DEFAULT_WORKFLOW).toContain("actions/checkout@v4");
    // …and a job-level moving ref plus a second step-level one, so the first
    // paint shows more than one moving target.
    expect(DEFAULT_WORKFLOW).toContain("actions/github-script@v7");
    expect(DEFAULT_WORKFLOW).toContain("release.yml@main");
  });

  it("carries a fixed dotted version, so both poles exist on first paint", () => {
    expect(DEFAULT_WORKFLOW).toContain("actions/setup-node@v4.2.0");
  });

  it("carries an already-pinned SHA, a local action and a docker step", () => {
    expect(DEFAULT_WORKFLOW).toContain("@11bd71901bbe5b1630ceea73d27597364c9af683");
    expect(DEFAULT_WORKFLOW).toContain("./.github/actions/setup");
    expect(DEFAULT_WORKFLOW).toContain("docker://alpine:3.20");
  });

  it("carries the comments that prove comment preservation", () => {
    // A user comment that must survive a pin verbatim …
    expect(DEFAULT_WORKFLOW).toContain("actions/checkout@v4   # needed for CI");
    // … and flow spacing + pre-comment whitespace that must survive untouched.
    expect(DEFAULT_WORKFLOW).toContain("branches: [main]     # only main");
    expect(DEFAULT_WORKFLOW).toContain("contents: write      # deliberately");
  });

  it("classifies on first paint into every class the UI badges", () => {
    // Offline, deterministic, network-free: the seed must exercise the classes.
    const body = analyzeLocal(DEFAULT_WORKFLOW, { now: () => 0 });
    expect(body.ok).toBe(true);
    expect(body.metrics.usesCount).toBeGreaterThanOrEqual(8);
    expect(body.uses.filter((u) => u.moving).length).toBeGreaterThanOrEqual(2);
    expect(body.uses.filter((u) => u.cls === "remoteRef").length).toBeGreaterThanOrEqual(1);
    expect(body.uses.filter((u) => u.cls === "sha40").length).toBeGreaterThanOrEqual(1);
    expect(body.uses.filter((u) => u.cls === "local").length).toBe(1);
    expect(body.uses.filter((u) => u.cls === "docker").length).toBe(1);
    // … and it is a no-op rewrite, so the first paint is byte-identical.
    expect(body.rewrittenYaml).toBe(DEFAULT_WORKFLOW);
    expect(body.diff?.changed).toBe(0);
  });

  it("carries an over-broad token grant and an untrusted interpolation", () => {
    expect(DEFAULT_WORKFLOW).toMatch(/permissions:\s*\n\s*contents: write/);
    expect(DEFAULT_WORKFLOW).toContain("${{ github.event.pull_request.title }}");
  });

  it("stays inside the input cap on its own", () => {
    expect(new TextEncoder().encode(DEFAULT_WORKFLOW).length).toBeLessThan(
      262_144
    );
  });
});

describe("TRUST_PILLS — first-viewport privacy posture", () => {
  it("ships three pills, one of them the privacy promise", () => {
    expect(TRUST_PILLS).toHaveLength(3);
    expect(TRUST_PILLS.map((pill) => pill.id)).toEqual([
      "egress",
      "worker",
      "account",
    ]);
  });
});
