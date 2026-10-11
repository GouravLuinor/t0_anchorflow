import { describe, expect, it } from "vitest";
import { lineOfOffset } from "../textMetrics";
import { parseWorkflow, yamlParse } from "../yamlParse";
import { MAX_INPUT_BYTES, MAX_USES_SCAN } from "../constants";
import { countBytes } from "../textMetrics";

/**
 * Source → WorkflowModel (SPEC §4 F1 · ARCH §3.2).
 *
 * The contract these tests lock down:
 *   · COLLECTION IS STRUCTURAL — only `jobs.<id>.steps[].uses` and
 *     `jobs.<id>.uses` are collected, so a `with:` input named `uses` is
 *     invisible (AC-1);
 *   · a QUOTED scalar records the unquoted text and a `valueEnd` AFTER the
 *     closing quote (AC-3);
 *   · malformed YAML is an ERROR VALUE with the parser's line/column, never a
 *     throw;
 *   · oversize input truncates on a code-point boundary and the ORIGINAL byte
 *     count is reported (AC-13).
 */

const STEP_AND_JOB = `name: ci
on:
  push:
    branches: [main]     # only main
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4   # needed for CI
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4.2.0
        with:
          node-version: 20
      - run: npm ci && npm test
  release:
    uses: octo-org/reusable/.github/workflows/release.yml@main
`;

function parseOk(source: string, caps?: { maxUsesScan?: number }) {
  const result = parseWorkflow(source, caps ? { caps } : undefined);
  if (!result.ok) throw new Error(`expected a parse, got ${result.error.message}`);
  return result.model;
}

describe("parseWorkflow — structural collection (AC-1)", () => {
  it("collects step-level AND job-level uses, scope-tagged", () => {
    const model = parseOk(STEP_AND_JOB);

    expect(model.ok).toBe(true);
    expect(model.error).toBeNull();
    expect(model.uses).toHaveLength(3);

    const [checkout, setupNode, jobLevel] = model.uses;
    expect(checkout.scope).toBe("step");
    expect(checkout.jobId).toBe("build");
    expect(checkout.stepIndex).toBe(0);
    expect(checkout.id).toBe("build:0");
    expect(checkout.raw).toBe("actions/checkout@v4");

    expect(setupNode.stepIndex).toBe(1);
    expect(setupNode.id).toBe("build:1");
    expect(setupNode.raw).toBe("actions/setup-node@v4.2.0");

    // The `run:` step contributes NO uses node.
    expect(model.uses.filter((u) => u.raw === "npm ci && npm test")).toHaveLength(0);

    // Job-level reusable-workflow call: scope "job", stepIndex null.
    expect(jobLevel.scope).toBe("job");
    expect(jobLevel.jobId).toBe("release");
    expect(jobLevel.stepIndex).toBeNull();
    expect(jobLevel.id).toBe("release:job");
    expect(jobLevel.raw).toBe(
      "octo-org/reusable/.github/workflows/release.yml@main"
    );
    expect(model.jobs.find((job) => job.id === "release")?.uses?.raw).toBe(
      "octo-org/reusable/.github/workflows/release.yml@main"
    );
  });

  it("NEVER collects a non-structural key named uses (AC-1 negative)", () => {
    const source = `jobs:
  sneaky:
    steps:
      - name: a step with a decoy
        uses: actions/checkout@v4
        with:
          uses: actions/decoy@v9
          env:
            uses: also-a-decoy
        if: uses == 'x'
      - uses: not-an-action@v1
        with:
          uses: another-decoy
`;
    const model = parseOk(source);
    expect(model.uses.map((u) => u.raw)).toEqual([
      "actions/checkout@v4",
      "not-an-action@v1",
    ]);
    // The decoy `with.uses` value is recorded as an INPUT, not a uses node.
    expect(model.jobs[0].steps[0].withValues.uses).toBe("actions/decoy@v9");
  });

  it("records offsets that index the exact scalar bytes", () => {
    const source = "jobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4\n";
    const model = parseOk(source);
    const uses = model.uses[0];
    expect(source.slice(uses.start, uses.valueEnd)).toBe("actions/checkout@v4");
    expect(uses.valueEnd).toBeGreaterThan(uses.start);
  });

  it("records a quoted scalar's valueEnd AFTER the closing quote (AC-3)", () => {
    const source = 'jobs:\n  b:\n    steps:\n      - uses: "actions/checkout@v4"  # v4\n';
    const model = parseOk(source);
    const uses = model.uses[0];
    // The stored raw text is UNQUOTED …
    expect(uses.raw).toBe("actions/checkout@v4");
    // … and valueEnd sits past the closing double quote, where ` # <ref>` goes.
    expect(source.slice(uses.start, uses.valueEnd)).toBe('"actions/checkout@v4"');
    expect(source[uses.valueEnd]).toBe(" ");
    expect(uses.valueEnd).toBe(uses.start + '"actions/checkout@v4"'.length);
  });

  it("captures a single-quoted scalar the same way", () => {
    const source = "jobs:\n  b:\n    steps:\n      - uses: 'actions/checkout@v4'\n";
    const uses = parseOk(source).uses[0];
    expect(uses.raw).toBe("actions/checkout@v4");
    expect(source.slice(uses.start, uses.valueEnd)).toBe(
      "'actions/checkout@v4'"
    );
  });

  it("captures the trailing comment and ignores standalone comments", () => {
    const source = `jobs:
  b:
    steps:
      - uses: actions/checkout@v4   # needed for CI
        # a standalone comment is not a trailing one
        run: echo hi
      - uses: actions/setup-node@v4.2.0
      - uses: 'actions/c@v2'     #   v2
      - uses: actions/f@v4 # v4 # extra
`;
    const uses = parseOk(source).uses;
    expect(uses[0].existingComment).toBe("needed for CI");
    expect(uses[1].existingComment).toBeNull();
    expect(uses[2].existingComment).toBe("v2");
    expect(uses[3].existingComment).toBe("v4 # extra");
  });

  it("collects the step structure the later audits need", () => {
    const source = `jobs:
  build:
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
          ref: main
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: test
        if: github.event_name == 'push'
        run: npm test
        with:
          node-version: 22
`;
    const model = parseOk(source);
    const [checkout, setupNode, test] = model.jobs[0].steps;

    expect(checkout.persistCredentials).toBe(false);
    expect(checkout.checkoutRef).toBe("main");
    expect(checkout.withValues["persist-credentials"]).toBe("false");

    expect(setupNode.persistCredentials).toBeNull();
    expect(setupNode.run).toBeNull();

    expect(test.index).toBe(2);
    expect(test.run).toBe("npm test");
    expect(test.ifExpr).toBe("github.event_name == 'push'");
    expect(test.withValues).toEqual({ "node-version": "22" });
    expect(test.usesRaw).toBeNull();

    // The permission block is captured as raw data for the M3 grant table.
    expect(model.jobs[0].permissions).toEqual({
      scopes: { contents: "read", "id-token": "write" },
    });
  });

  it("captures top-level permissions, trigger flags and job-level inputs", () => {
    const source = `on:
  pull_request_target:
  workflow_run:
permissions: write-all
jobs:
  call:
    uses: owner/repo/.github/workflows/x.yml@main
    with:
      environment: production
      count: 3
`;
    const model = parseOk(source);
    expect(model.topPermissions).toEqual({ all: "write", scopes: {} });
    expect(model.triggers).toEqual({
      pullRequestTarget: true,
      workflowRun: true,
    });
    expect(model.jobs[0].withInputs).toEqual({
      environment: "production",
      count: "3",
    });
  });

  it("reads the triggers from every `on:` shape", () => {
    expect(parseOk("on: [push, pull_request_target]\n").triggers).toEqual({
      pullRequestTarget: true,
      workflowRun: false,
    });
    expect(parseOk("on: push pull_request_target\n").triggers).toEqual({
      pullRequestTarget: true,
      workflowRun: false,
    });
    expect(parseOk("on: workflow_run\n").triggers).toEqual({
      pullRequestTarget: false,
      workflowRun: true,
    });
    expect(parseOk("on: push\n").triggers).toEqual({
      pullRequestTarget: false,
      workflowRun: false,
    });
  });

  it("treats a non-mapping document as an empty workflow, not an error", () => {
    // A bare scalar is valid YAML; it simply has no jobs.
    const model = parseOk("just a scalar\n");
    expect(model.jobs).toEqual([]);
    expect(model.uses).toEqual([]);
    expect(model.usesCap).toEqual({ seen: 0, scanned: 0, capped: false });
    expect(parseOk("").uses).toEqual([]);
  });
});

describe("parseWorkflow — malformed YAML is a VALUE, never a throw (AC-1)", () => {
  it("returns ok:false with the parser's line and column", () => {
    const result = parseWorkflow("jobs:\n\tb: 1\n");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.line).toBe(2);
    expect(result.error.column).toBe(1);
    expect(result.error.message).toMatch(/tabs are not allowed/i);
    // No source snippet leaks into the message.
    expect(result.error.message).not.toContain("\n");
  });

  it("never throws on any other native parser failure", () => {
    for (const bad of [
      "jobs:\n  b:\n   - uses: a@v1\n  bad: [unclosed\n",
      "a: b: c\n",
      "- a\n- b\n  c: d\n",
      "key: 'unterminated\n",
    ]) {
      expect(() => parseWorkflow(bad)).not.toThrow();
    }
  });

  it("exposes the flat ARCH §3.2 shape through yamlParse", () => {
    const model = yamlParse("jobs:\n\tb: 1\n");
    expect(model.ok).toBe(false);
    expect(model.error).toMatch(/tabs are not allowed/i);
    // The failure shape is still a full model — never undefined fields.
    expect(model.jobs).toEqual([]);
    expect(model.uses).toEqual([]);
    expect(yamlParse("name: ci\n").ok).toBe(true);
  });
});

describe("parseWorkflow — the input cap (AC-13)", () => {
  it("truncates on a code-point boundary and still parses", () => {
    // 262141 single-byte chars + a 4-byte emoji run: the cut would land between
    // the pair's surrogates unless it steps back a whole code point, which
    // would otherwise leave a lone surrogate for the parser to choke on.
    const source = "x".repeat(MAX_INPUT_BYTES - 3) + "\u{1F680}".repeat(64);
    expect(countBytes(source)).toBeGreaterThan(MAX_INPUT_BYTES);

    const result = parseWorkflow(source);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.model.ok).toBe(true);
    expect(result.model.jobs).toEqual([]);
  });

  it("keeps the original byte count available to the metrics", () => {
    const source = "y".repeat(MAX_INPUT_BYTES + 5_000);
    const model = parseOk(source);
    expect(model.uses).toEqual([]);
    // The analyzed prefix is what the model describes.
    expect(countBytes("y".repeat(MAX_INPUT_BYTES))).toBe(MAX_INPUT_BYTES);
    expect(model.jobs).toEqual([]);
  });

  it("honours an injected scan cap and never silently drops the remainder", () => {
    let source = "jobs:\n  big:\n    steps:\n";
    for (let i = 0; i < 12; i += 1) {
      source += `      - uses: owner/repo${i}@v1\n`;
    }
    const model = parseOk(source, { maxUsesScan: 5 });
    expect(model.usesCap.seen).toBe(12);
    expect(model.usesCap.scanned).toBe(5);
    expect(model.usesCap.capped).toBe(true);
    expect(model.uses).toHaveLength(5);
  });

  it("does not report a cap when the scan fits", () => {
    let source = "jobs:\n  big:\n    steps:\n";
    for (let i = 0; i < 8; i += 1) {
      source += `      - uses: owner/repo${i}@v1\n`;
    }
    const model = parseOk(source, { maxUsesScan: MAX_USES_SCAN });
    expect(model.usesCap).toEqual({ seen: 8, scanned: 8, capped: false });
  });
});

describe("lineOfOffset — the `# line N` source annotation", () => {
  it("is 1-based and tracks newlines", () => {
    const source = "a\nbb\nccc\n";
    expect(lineOfOffset(source, 0)).toBe(1);
    expect(lineOfOffset(source, 2)).toBe(2);
    expect(lineOfOffset(source, 5)).toBe(3);
    expect(lineOfOffset(source, 8)).toBe(3);
    expect(lineOfOffset("", 12)).toBe(1);
  });

  it("labels the collected uses nodes with their real line", () => {
    const model = parseOk(STEP_AND_JOB);
    const first = model.uses[0];
    expect(STEP_AND_JOB.split("\n")[lineOfOffset(STEP_AND_JOB, first.start) - 1]).toContain(
      "actions/checkout@v4"
    );
  });
});
