import { describe, expect, it } from "vitest";
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
  });

  it("carries a MOVING ref — the network-free finding the first paint reports", () => {
    // actions/checkout@v4 is a floating major: moving by the adjudicated rule.
    expect(DEFAULT_WORKFLOW).toContain("actions/checkout@v4\n");
  });

  it("carries a fixed dotted version, so both poles exist on first paint", () => {
    expect(DEFAULT_WORKFLOW).toContain("actions/setup-node@v4.2.0");
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
