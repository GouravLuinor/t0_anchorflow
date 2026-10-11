import { describe, expect, it } from "vitest";
import {
  SAFE_CONTEXT_PREFIXES,
  UNTRUSTED_CONTEXTS,
  findExpressions,
  injectionDetect,
  injectionFindings,
  isSafeContext,
  matchUntrustedContext,
  tokenizeExpression,
} from "../injectionDetect";
import { parseWorkflow } from "../yamlParse";
import type { Finding, InjectionSink, WorkflowModel } from "../types";

function modelOf(source: string): WorkflowModel {
  const parsed = parseWorkflow(source);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.model;
}

function sinks(source: string): InjectionSink[] {
  return injectionDetect(modelOf(source));
}

function findings(source: string): Finding[] {
  return injectionFindings(modelOf(source));
}

/** Wraps a workflow body into a one-job run step, escaping `${{` for TS. */
function runWorkflow(run: string): string {
  return `on: push
jobs:
  a:
    steps:
      - run: ${run}
`;
}

describe("tokenizeExpression — the whole-expression walk", () => {
  it("reads the leading context path", () => {
    expect(tokenizeExpression(" github.event.issue.title ")).toEqual([
      "github.event.issue.title",
    ]);
  });

  it("descends into a nested function argument", () => {
    expect(tokenizeExpression(" format('{0}', github.event.issue.title) ")).toEqual([
      "format",
      "github.event.issue.title",
    ]);
  });

  it("keeps a splat argument", () => {
    expect(tokenizeExpression("join(github.event.commits.*.message)")).toEqual([
      "join",
      "github.event.commits.*.message",
    ]);
  });

  it("survives a concatenation and an index hop", () => {
    expect(tokenizeExpression("'t-' + github.head_ref + github.event.commits[0].message")).toEqual([
      "github.head_ref",
      "github.event.commits.*.message",
    ]);
  });

  it("reads a string-keyed index as a real segment", () => {
    expect(tokenizeExpression("github['event']['issue']['title']")).toEqual([
      "github.event.issue.title",
    ]);
  });

  it("drops literals, operators and bare numbers", () => {
    expect(tokenizeExpression("1 == 2 && fromJSON('{\"a\":1}')")).toEqual([
      "fromJSON",
    ]);
  });

  it("walks an open-paren expression without stopping at the paren", () => {
    expect(tokenizeExpression("(github.event.pull_request.body)")).toEqual([
      "github.event.pull_request.body",
    ]);
  });
});

describe("findExpressions — every ${{ … }} region", () => {
  it("returns each body with its offset", () => {
    const regions = findExpressions("echo ${{ github.sha }} and ${{ github.actor }}");
    expect(regions.map((r) => r.body)).toEqual([" github.sha ", " github.actor "]);
    expect(regions[1].start).toBe(27);
  });

  it("ignores an unterminated opener", () => {
    expect(findExpressions("echo ${{ github.sha ")).toEqual([]);
  });
});

describe("context matching — the enumerated error set", () => {
  it("matches every enumerated untrusted context from its own path", () => {
    for (const context of UNTRUSTED_CONTEXTS) {
      // A splat pattern is probed through a concrete hop; an exact path is
      // probed at itself.
      const probe = context.path.includes("*")
        ? context.path
        : context.path;
      expect(matchUntrustedContext(probe), context.path).not.toBeNull();
      expect(matchUntrustedContext(probe)?.path, context.path).toBe(context.path);
    }
  });

  it("matches a splat pattern through a real index", () => {
    expect(
      matchUntrustedContext("github.event.commits.0.message")?.path
    ).toBe("github.event.commits.*.message");
    expect(
      matchUntrustedContext("github.event.pages.build.page_name")?.path
    ).toBe("github.event.pages.*.page_name");
  });

  it("keeps the safe contexts out of the error set", () => {
    for (const prefix of SAFE_CONTEXT_PREFIXES) {
      const token = `${prefix.replace(/\.$/, "")}.x`;
      expect(matchUntrustedContext(token), token).toBeNull();
    }
    expect(isSafeContext("github.event_name")).toBe(true);
    expect(isSafeContext("env.ANYTHING")).toBe(true);
    expect(isSafeContext("github.head_ref")).toBe(false);
  });
});

describe("injectionDetect — enumerated ERROR contexts (AC-7)", () => {
  it("catches github.event.issue.title in a run step", () => {
    const [sink] = sinks(runWorkflow("echo ${{ github.event.issue.title }}"));
    expect(sink.contextPath).toBe("github.event.issue.title");
    expect(sink.severity).toBe("error");
    expect(sink.source).toBe("run");
    expect(sink.stepIndex).toBe(0);
  });

  it("catches a nested argument and a splat argument as whole expressions", () => {
    const found = sinks(
      `on: push
jobs:
  a:
    steps:
      - run: echo \${{ format('{0}', github.event.pull_request.title) }}
      - run: echo \${{ join(github.event.commits.*.message) }}
`
    );
    expect(found).toHaveLength(2);
    expect(found[0].contextPath).toBe("github.event.pull_request.title");
    expect(found[0].expression).toBe("${{ format('{0}', github.event.pull_request.title) }}");
    expect(found[1].contextPath).toBe("github.event.commits.*.message");
  });

  it("catches a concatenated expression", () => {
    const [sink] = sinks(runWorkflow('echo "t-${{ github.head_ref }}"'));
    expect(sink.contextPath).toBe("github.head_ref");
    expect(sink.severity).toBe("error");
  });

  it("catches a quoted pull_request.body in a with: input", () => {
    const [sink] = sinks(
      `on: push
jobs:
  a:
    steps:
      - uses: github/github-script@v7
        with:
          script: '\${{ github.event.pull_request.body }}'
`
    );
    expect(sink.contextPath).toBe("github.event.pull_request.body");
    expect(sink.source).toBe("with");
    expect(sink.where).toBe("jobs.a.steps[0].with.script");
  });

  it("catches a review.body in a with: input", () => {
    const [sink] = sinks(
      `on: push
jobs:
  a:
    steps:
      - uses: octo/comment@v1
        with:
          body: \${{ github.event.review.body }}
`
    );
    expect(sink.contextPath).toBe("github.event.review.body");
  });

  it("catches github.head_ref inside a multiline run: | block", () => {
    const [sink] = sinks(
      `on: push
jobs:
  a:
    steps:
      - run: |
          echo "start"
          echo "branch=\${{ github.head_ref }}"
          echo "done"
`
    );
    expect(sink.contextPath).toBe("github.head_ref");
    expect(sink.where).toBe("jobs.a.steps[0].run");
  });

  it("catches a job-level reusable-workflow with: input", () => {
    const [sink] = sinks(
      `on: push
jobs:
  release:
    uses: octo-org/reusable/.github/workflows/release.yml@main
    with:
      environment: \${{ github.event.issue.body }}
`
    );
    expect(sink.contextPath).toBe("github.event.issue.body");
    expect(sink.stepIndex).toBeNull();
    expect(sink.where).toBe("jobs.release.with.environment");
  });

  it("catches a workflow_run head branch", () => {
    const [sink] = sinks(runWorkflow("echo ${{ github.event.workflow_run.head_branch }}"));
    expect(sink.contextPath).toBe("github.event.workflow_run.head_branch");
  });
});

describe("injectionDetect — the bare if: expression", () => {
  it("catches an untrusted context in a bare if:", () => {
    const [sink] = sinks(
      `on: push
jobs:
  a:
    steps:
      - run: echo hi
        if: github.event.issue.title == 'ok'
`
    );
    expect(sink.severity).toBe("error");
    expect(sink.source).toBe("if");
    expect(sink.where).toBe("jobs.a.steps[0].if");
    // The remediation is the `if:` one, not the shell one.
    expect(sink.remediation).toContain("if: env.FOO == '…'");
  });

  it("also catches a wrapped if: expression", () => {
    const [sink] = sinks(
      `on: push
jobs:
  a:
    steps:
      - run: echo hi
        if: \${{ github.head_ref == 'x' }}
`
    );
    expect(sink.contextPath).toBe("github.head_ref");
  });

  it("leaves a safe if: alone", () => {
    expect(
      sinks(
        `on: push
jobs:
  a:
    steps:
      - run: echo hi
        if: github.event_name == 'push' && github.ref == 'refs/heads/main'
`
      )
    ).toEqual([]);
  });
});

describe("injectionDetect — SAFE contexts are skipped", () => {
  it("skips github.sha, github.ref, github.repository, github.actor", () => {
    expect(
      sinks(
        runWorkflow(
          "echo ${{ github.sha }} ${{ github.ref }} ${{ github.repository }} ${{ github.actor }}"
        )
      )
    ).toEqual([]);
  });

  it("skips env, matrix, needs, steps, inputs, vars and secrets", () => {
    expect(
      sinks(
        runWorkflow(
          "echo ${{ env.FOO }} ${{ matrix.node }} ${{ needs.build.outputs.x }} ${{ steps.a.outputs.y }} ${{ inputs.z }} ${{ secrets.GITHUB_TOKEN }}"
        )
      )
    ).toEqual([]);
  });

  it("skips github.event_name, which is not github.event.*", () => {
    expect(sinks(runWorkflow("echo ${{ github.event_name }}"))).toEqual([]);
  });
});

describe("injectionDetect — dedupe (adjudicated: most specific wins)", () => {
  it("yields EXACTLY ONE error per site, never an error and a warn", () => {
    const found = sinks(
      runWorkflow("echo ${{ github.event.issue.title }} ${{ github.event.foo.bar }}")
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("error");
    // The enumerated (most specific) context wins; the residual is named too.
    expect(found[0].contextPath).toBe("github.event.issue.title");
    expect(found[0].contextPaths).toContain("github.event.foo.bar");
  });

  it("yields ONE error when a step carries two untrusted contexts", () => {
    const found = sinks(
      runWorkflow(
        "echo ${{ github.event.issue.title }} && echo ${{ github.head_ref }}"
      )
    );
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("error");
    expect(found[0].contextPath).toBe("github.event.issue.title");
  });

  it("keeps a residual unexplored github.event.* as ONE warning", () => {
    const found = sinks(runWorkflow("echo ${{ github.event.deployment_status.state }}"));
    expect(found).toHaveLength(1);
    expect(found[0].severity).toBe("warn");
    expect(found[0].contextPath).toBe("github.event.deployment_status.state");
    expect(found[0].remediation).toContain("${VAR}");
  });

  it("keeps two sites of the same step as two findings", () => {
    const found = sinks(
      `on: push
jobs:
  a:
    steps:
      - run: echo \${{ github.event.issue.title }}
        if: github.head_ref == 'x'
`
    );
    expect(found).toHaveLength(2);
    expect(found.map((sink) => sink.source)).toEqual(["run", "if"]);
    expect(new Set(found.map((sink) => sink.id)).size).toBe(2);
  });
});

describe("injectionFindings — the Finding[] the pane renders", () => {
  it("carries severity, category, expression, location and remediation", () => {
    const [finding] = findings(
      `on: push
jobs:
  a:
    steps:
      - run: echo \${{ github.event.issue.title }}
`
    );
    expect(finding.category).toBe("template-injection");
    expect(finding.severity).toBe("error");
    expect(finding.evidence).toBe("${{ github.event.issue.title }}");
    expect(finding.where).toBe("jobs.a.steps[0].run");
    expect(finding.start).not.toBeNull();
    expect(finding.detail).toContain("before the shell runs");
    expect(finding.remediation).toContain("${VAR}");
  });

  it("never wraps a bare if: expression in ${{ }}", () => {
    const [finding] = findings(
      `on: push
jobs:
  a:
    steps:
      - run: echo hi
        if: github.event.issue.title == 'x'
`
    );
    expect(finding.start).not.toBeNull();
    expect(finding.evidence).toBe("github.event.issue.title == 'x'");
    expect(finding.detail).not.toContain("`${{ github.event.issue.title == 'x' }}`");
  });

  it("is deterministic", () => {
    const source = `on: push
jobs:
  a:
    steps:
      - run: echo \${{ github.event.issue.title }}
      - run: echo \${{ github.event.pull_request.body }}
        if: github.event.comment.body != ''
`;
    expect(findings(source)).toEqual(findings(source));
    expect(findings(source)).toHaveLength(3);
  });
});
