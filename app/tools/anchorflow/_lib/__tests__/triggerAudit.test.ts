import { describe, expect, it } from "vitest";
import { dangerousTriggerAudit, persistCredentialsAudit } from "../triggerAudit";
import { parseWorkflow } from "../yamlParse";
import type { Finding, WorkflowModel } from "../types";

function modelOf(source: string): WorkflowModel {
  const parsed = parseWorkflow(source);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.model;
}

function dangerous(source: string): Finding[] {
  return dangerousTriggerAudit(modelOf(source));
}

function persist(source: string): Finding[] {
  return persistCredentialsAudit(modelOf(source));
}

describe("dangerousTriggerAudit — pull_request_target (SPEC §4 F7 · AC-8)", () => {
  it("flags a checkout of the pull request's head ref as an ERROR", () => {
    const findings = dangerous(`on:
  pull_request_target:
jobs:
  build:
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: npm ci && npm test
`);
    const error = findings.find((f) => f.severity === "error");
    expect(error?.category).toBe("dangerous-trigger");
    expect(error?.where).toBe("jobs.build.steps[0].uses");
    expect(error?.detail).toContain("github.event.pull_request.head.sha");
    // The token-permission coupling is quoted in the same finding.
    expect(error?.detail).toContain("contents: write");
    expect(error?.remediation).toContain("pull_request");
  });

  it("flags a checkout of the fork's branch name", () => {
    const [error] = dangerous(`on:
  pull_request_target:
jobs:
  label:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.ref }}
`);
    expect(error.severity).toBe("error");
    expect(error.detail).toContain("github.event.pull_request.head.ref");
  });

  it("flags github.head_ref as the same untrusted source", () => {
    const findings = dangerous(`on:
  pull_request_target:
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.head_ref }}
`);
    expect(findings.some((f) => f.severity === "error")).toBe(true);
  });

  it("warns about the write-token coupling on an elevated job", () => {
    const finding = dangerous(`on:
  pull_request_target:
jobs:
  build:
    permissions:
      contents: write
      pull-requests: write
    steps:
      - run: npm ci
`).find((f) => f.severity === "warn");
    expect(finding?.category).toBe("dangerous-trigger");
    expect(finding?.title).toBe("Write token coupled to an elevated trigger");
    expect(finding?.evidence).toContain("contents: write");
    expect(finding?.evidence).toContain("pull-requests: write");
  });

  it("does NOT flag a pull_request_target job that checks out the base ref", () => {
    // GitHub's default ref on pull_request_target is the PR's own merge ref,
    // which the base repository produced — so only an explicit PR-head ref
    // (or a workflow_run default) is untrusted.
    expect(
      dangerous(`on:
  pull_request_target:
jobs:
  build:
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
`)
    ).toEqual([]);
  });
});

describe("dangerousTriggerAudit — workflow_run", () => {
  it("flags the DEFAULT checkout ref of a workflow_run as untrusted", () => {
    // checkout's default ref is the triggering run's head commit — the fork's
    // code — when the upstream workflow was itself a pull_request run.
    const [error] = dangerous(`on:
  workflow_run:
    workflows: [ci]
    types: [completed]
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
`);
    expect(error.severity).toBe("error");
    expect(error.detail).toContain("triggering run's head commit");
  });

  it("flags an explicit workflow_run head sha", () => {
    const findings = dangerous(`on:
  workflow_run:
    workflows: [ci]
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.workflow_run.head_sha }}
`);
    expect(findings.some((f) => f.severity === "error")).toBe(true);
  });
});

describe("persistCredentialsAudit — the checkout credential (SPEC §4 F8 · AC-8)", () => {
  it("flags an explicit persist-credentials: true", () => {
    const [finding] = persist(`on: push
jobs:
  build:
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: true
`);
    expect(finding.category).toBe("persist-credentials");
    expect(finding.severity).toBe("warn");
    expect(finding.title).toContain("persist-credentials: true");
    expect(finding.remediation).toContain("persist-credentials: false");
    expect(finding.where).toBe("jobs.build.steps[0].with.persist-credentials");
  });

  it("flags an absent input on an elevated job (GitHub defaults it to true)", () => {
    const findings = persist(`on:
  pull_request_target:
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
`);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("warn");
    expect(findings[0].title).toContain("absent");
    expect(findings[0].detail).toContain("defaults to `true`");
  });

  it("stays quiet on an ordinary push job that leaves the input absent", () => {
    // No elevated trigger and no untrusted ref: the default is still true, but
    // this job is not the pwn-request shape, so the audit does not cry wolf.
    expect(
      persist(`on: push
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
`)
    ).toEqual([]);
  });

  it("stays quiet when the input is explicitly false", () => {
    expect(
      persist(`on: push
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
`)
    ).toEqual([]);
  });

  it("drops to info in a fully pinned, least-privilege, non-PR-target job", () => {
    const [finding] = persist(`on: push
jobs:
  build:
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          persist-credentials: true
      - uses: actions/setup-node@1a4442c9d4d4f5f0e0e2e10bb1d4a70af8a5e1a1
`);
    expect(finding.severity).toBe("info");
    expect(finding.category).toBe("persist-credentials");
  });

  it("notes the write scopes the credential can spend", () => {
    const [finding] = persist(`on: push
jobs:
  build:
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: true
`);
    expect(finding.detail).toContain("contents: write");
  });
});

describe("the two trigger audits together", () => {
  it("report every dangerous job exactly once per finding kind", () => {
    const source = `on:
  pull_request_target:
jobs:
  build:
    permissions: write-all
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.ref }}
          persist-credentials: true
      - run: npm ci
  verify:
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: false
      - run: npm test
`;
    const dangerousFindings = dangerous(source);
    const persistFindings = persist(source);

    expect(dangerousFindings.filter((f) => f.severity === "error")).toHaveLength(1);
    expect(dangerousFindings.filter((f) => f.severity === "warn")).toHaveLength(1);
    expect(persistFindings.map((f) => f.id)).toEqual([
      "persist-credentials:build:0:1",
    ]);

    const ids = [...dangerousFindings, ...persistFindings].map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is deterministic", () => {
    const source = `on:
  workflow_run:
    workflows: [ci]
jobs:
  build:
    permissions:
      packages: write
    steps:
      - uses: actions/checkout@v4
`;
    expect(JSON.stringify(dangerous(source))).toBe(JSON.stringify(dangerous(source)));
    expect(JSON.stringify(persist(source))).toBe(JSON.stringify(persist(source)));
  });
});
