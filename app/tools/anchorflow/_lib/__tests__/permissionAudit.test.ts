import { describe, expect, it } from "vitest";
import { permissionAudit } from "../permissionAudit";
import { parseWorkflow } from "../yamlParse";
import type { Finding, WorkflowModel } from "../types";

function modelOf(source: string): WorkflowModel {
  const parsed = parseWorkflow(source);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.model;
}

function audit(source: string): Finding[] {
  return permissionAudit(modelOf(source));
}

/** One fixture, exactly the findings it must produce. */
function only(source: string, id: string): Finding {
  const findings = audit(source);
  expect(findings, `expected exactly one finding, got ${findings.map((f) => f.id)}`).toHaveLength(1);
  expect(findings[0].id).toBe(id);
  return findings[0];
}

describe("permissionAudit — the five canonical misconfigurations (SPEC §4 F5 · AC-6)", () => {
  it("(1) flags a top-level write-all as an error", () => {
    const finding = only(
      `on: push
permissions: write-all
jobs:
  build:
    steps:
      - run: npm test
`,
      "excessive-permissions:top:job:1"
    );
    expect(finding.severity).toBe("error");
    expect(finding.category).toBe("excessive-permissions");
    expect(finding.title).toContain("write-all");
    expect(finding.where).toBe("permissions");
  });

  it("(2) flags a job-level write-all as an error", () => {
    const finding = only(
      `on: push
jobs:
  deploy:
    permissions: write-all
    steps:
      - run: npm test
`,
      "excessive-permissions:deploy:job:1"
    );
    expect(finding.severity).toBe("error");
    expect(finding.where).toBe("jobs.deploy.permissions");
    expect(finding.evidence).toBe("write-all");
  });

  it("(3) flags UNSET permissions on a token-consuming job as info", () => {
    const finding = only(
      `on: push
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
`,
      "excessive-permissions:build:job:1"
    );
    expect(finding.severity).toBe("info");
    expect(finding.detail).toContain("no `permissions:` block at any level");
    expect(finding.detail).toContain("GITHUB_TOKEN");
    expect(finding.remediation).toContain("permissions: { contents: read }");
  });

  it("(4) flags an over-broad write on a read-only job as a warning", () => {
    const finding = only(
      `on: push
permissions:
  contents: read
jobs:
  test:
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`,
      "excessive-permissions:test:job:1"
    );
    expect(finding.severity).toBe("warn");
    expect(finding.title).toBe("Over-broad token grant");
    expect(finding.detail).toContain("while its steps only read");
    // The grant semantics travel with the finding.
    expect(finding.detail).toContain(
      "write pushes commits, tags and releases"
    );
  });

  it("(5) flags id-token: write with no OIDC consumer", () => {
    const finding = only(
      `on: push
jobs:
  build:
    permissions:
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`,
      "excessive-permissions:build:job:1"
    );
    expect(finding.severity).toBe("minor");
    expect(finding.title).toContain("id-token: write");
    expect(finding.detail).toContain("mint an OIDC token");
  });

  it("(6) flags packages/pages/deployments write with no matching purpose", () => {
    expect(
      only(
        `on: push
jobs:
  test:
    permissions:
      pages: write
    steps:
      - run: npm test
`,
        "excessive-permissions:test:job:1"
      ).title
    ).toBe("`pages: write` with no matching purpose");

    expect(
      only(
        `on: push
jobs:
  test:
    permissions:
      deployments: write
    steps:
      - run: npm test
`,
        "excessive-permissions:test:job:1"
      ).title
    ).toBe("`deployments: write` with no matching purpose");
  });

  it("(7) flags a read-only job scoped broader than contents: read", () => {
    const finding = only(
      `on: push
jobs:
  test:
    permissions:
      contents: read
      pull-requests: read
    steps:
      - run: npm test
`,
      "excessive-permissions:test:job:1"
    );
    expect(finding.severity).toBe("minor");
    expect(finding.detail).toContain("A read-only job needs `contents: read`");
  });

  it("flags exactly the five classes on the canonical corpus, and nothing else", () => {
    const corpus: Array<[string, string, string]> = [
      [
        "top write-all",
        `on: push\npermissions: write-all\njobs:\n  a:\n    steps:\n      - run: x\n`,
        "excessive-permissions:top:job:1",
      ],
      [
        "job write-all",
        `on: push\njobs:\n  a:\n    permissions: write-all\n    steps:\n      - run: x\n`,
        "excessive-permissions:a:job:1",
      ],
      [
        "unset + token",
        `on: push\njobs:\n  a:\n    steps:\n      - uses: actions/checkout@v4\n`,
        "excessive-permissions:a:job:1",
      ],
      [
        "over-broad write",
        `on: push\njobs:\n  a:\n    permissions:\n      contents: write\n    steps:\n      - run: x\n`,
        "excessive-permissions:a:job:1",
      ],
      [
        "id-token over-grant",
        `on: push\njobs:\n  a:\n    permissions:\n      id-token: write\n    steps:\n      - run: x\n`,
        "excessive-permissions:a:job:1",
      ],
    ];

    for (const [label, source, id] of corpus) {
      const findings = audit(source);
      expect(findings, label).toHaveLength(1);
      expect(findings[0].id, label).toBe(id);
      expect(findings[0].category, label).toBe("excessive-permissions");
    }
  });
});

describe("permissionAudit — the least-privilege NEGATIVE (AC-6: no false positive)", () => {
  it("produces ZERO findings for a read-only job pinned to contents: read", () => {
    expect(
      audit(`on: push
permissions: {}
jobs:
  test:
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - run: npm test
`)
    ).toEqual([]);
  });

  it("produces ZERO findings when a read-only job needs exactly its write scope", () => {
    expect(
      audit(`on: push
jobs:
  publish:
    permissions:
      packages: write
    steps:
      - uses: docker/login-action@v3
      - uses: docker/build-push-action@v6
`)
    ).toEqual([]);
  });

  it("produces ZERO findings for an OIDC job with an actual cloud login", () => {
    expect(
      audit(`on: push
jobs:
  deploy:
    permissions:
      id-token: write
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
`)
    ).toEqual([]);
  });

  it("makes no scope claim about a job that writes through github-script", () => {
    // An opaque writer proves nothing, so no per-scope finding is emitted —
    // only the unconditional `write-all` rule, which the job does not use.
    expect(
      audit(`on: push
jobs:
  triage:
    permissions:
      contents: write
      issues: write
    steps:
      - uses: actions/github-script@v7
        with:
          script: console.log("hi")
`)
    ).toEqual([]);
  });

  it("makes no claim about a reusable-workflow call", () => {
    expect(
      audit(`on: push
permissions:
  contents: write
jobs:
  release:
    uses: octo-org/reusable/.github/workflows/release.yml@main
`)
    ).toEqual([]);
  });
});

describe("permissionAudit — copy and stability", () => {
  it("is deterministic across runs", () => {
    const source = `on: push
permissions:
  contents: write
jobs:
  build:
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - run: npm test
  verify:
    permissions:
      contents: read
      id-token: write
    steps:
      - run: npm test
`;
    const first = audit(source);
    const second = audit(source);
    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.map((f) => f.id)).toEqual([
      "excessive-permissions:build:job:1",
      "excessive-permissions:verify:job:1",
    ]);
  });

  it("cites the source offset of the offending block", () => {
    const source = `on: push
jobs:
  a:
    permissions:
      contents: write
    steps:
      - run: x
`;
    const [finding] = audit(source);
    const permissionsOffset = source.indexOf("permissions:");
    expect(finding.start).toBe(source.indexOf("contents:", permissionsOffset));
    expect(source.slice(finding.start!, finding.start! + 8)).toBe("contents");
  });

  it("keeps one finding id per (job, site) even with several findings", () => {
    const findings = audit(`on: push
jobs:
  a:
    permissions:
      contents: write
      packages: write
      id-token: write
      pages: write
    steps:
      - run: npm test
`);
    const ids = findings.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([
      "excessive-permissions:a:job:1",
      "excessive-permissions:a:job:2",
      "excessive-permissions:a:job:3",
      "excessive-permissions:a:job:4",
    ]);
    // id-token gets the OIDC finding, packages/pages the purpose finding,
    // contents the over-broad finding.
    expect(findings.map((f) => f.severity)).toEqual([
      "warn",
      "minor",
      "minor",
      "minor",
    ]);
  });
});
