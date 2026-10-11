import { describe, expect, it } from "vitest";
import {
  applyEdits,
  applyPin,
  buildRewriteEdits,
  pinScalar,
  yamlRewrite,
} from "../rewrite";
import { classifyUses } from "../classify";
import { parseWorkflow } from "../yamlParse";
import type { ClassifiedUses, Resolution } from "../types";

/**
 * The offset-surgical rewrite (ARCH §3.9 · SPEC §4 F3/F4 · AC-2 · AC-3).
 *
 * The properties these tests lock down:
 *   · `yamlRewrite(source, [])` is BYTE-IDENTICAL to source (AC-2) — comments,
 *     blank lines, `[main]` flow spacing and inline-comment whitespace all
 *     survive;
 *   · a pin changes ONLY the `uses:` scalar, appends a single-space ` # <ref>`
 *     after the closing quote, and preserves the line count (AC-3);
 *   · a trailing comment that EXACTLY equals the ref is replaced in place; any
 *     other user comment is preserved verbatim with ` # <ref>` appended;
 *   · a `sha40` line is never rewritten, so re-running is a zero-diff (AC-9).
 */

const SHA = "11d5960a326750d5838078e36cf38b85af677262";

function resolution(node: ClassifiedUses, sha = SHA): Resolution {
  return {
    ref: node,
    resolvedSha: sha,
    status: "resolved",
    receipt: null,
  };
}

function classify(source: string): ClassifiedUses[] {
  const parsed = parseWorkflow(source);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return classifyUses(parsed.model.uses);
}

const FIXTURE = `# Anchorflow fixture — every byte below must survive a no-op rewrite.
name: ci

on:
  push:
    branches: [main]     # only main
  pull_request:

permissions:
  contents: read      # least privilege

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: "actions/checkout@v4"     # v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4.2.0   # needed for CI
      - uses: actions/cache@v4    # v4
      - run: npm ci && npm test

  release:
    uses: octo/repo/.github/workflows/release.yml@main
`;

describe("yamlRewrite — the AC-2 no-op round-trip", () => {
  it("returns the source BYTE-IDENTICAL with no resolutions", () => {
    expect(yamlRewrite(FIXTURE, [])).toBe(FIXTURE);
    expect(yamlRewrite(FIXTURE, new Map())).toBe(FIXTURE);
  });

  it("is a no-op for every fixture shape, comments and flow spacing included", () => {
    const fixtures = [
      FIXTURE,
      "",
      "\n\n\n",
      "name: ci\n",
      "jobs: {}\n",
      "on: [push, pull_request]   # two triggers\njobs:\n  b:\n    steps: []\n",
      "# only a comment\n",
    ];
    for (const fixture of fixtures) {
      expect(yamlRewrite(fixture, []), fixture).toBe(fixture);
    }
  });

  it("is a no-op when only non-resolvable resolutions are supplied", () => {
    const nodes = classify(FIXTURE);
    const keepp = nodes.map((node) => ({
      ...resolution(node),
      status: "unknown-ref" as const,
      resolvedSha: null,
    }));
    expect(yamlRewrite(FIXTURE, keepp)).toBe(FIXTURE);

    const rateLimited = nodes.map((node) => ({
      ...resolution(node),
      status: "rate-limited" as const,
      resolvedSha: null,
    }));
    expect(yamlRewrite(FIXTURE, rateLimited)).toBe(FIXTURE);
  });
});

describe("yamlRewrite — the AC-3 pin shape", () => {
  it("changes ONLY the uses scalars and appends a single-space # ref", () => {
    const nodes = classify(FIXTURE);
    const out = yamlRewrite(FIXTURE, nodes.map((n) => resolution(n)));

    // Every non-uses line is untouched …
    const before = FIXTURE.split("\n");
    const after = out.split("\n");
    expect(after).toHaveLength(before.length);
    before.forEach((line, index) => {
      if (!line.includes("uses:")) expect(after[index]).toBe(line);
    });

    // … and each uses line carries the commit + the honest ref label.
    expect(out).toContain(
      `- uses: actions/checkout@${SHA}     # v4`
    );
    expect(out).toContain(`- uses: actions/setup-node@${SHA}   # needed for CI # v4.2.0`);
    expect(out).toContain(`- uses: actions/cache@${SHA}    # v4`);
    // Subpath + job-level scope are rewritten exactly like a step uses.
    expect(out).toContain(
      `uses: octo/repo/.github/workflows/release.yml@${SHA} # main`
    );
    // `[main]` and every pre-comment whitespace survive.
    expect(out).toContain("branches: [main]     # only main");
    expect(out).toContain("contents: read      # least privilege");
  });

  it("lands the annotation AFTER the closing quote of a quoted scalar", () => {
    const source = 'jobs:\n  b:\n    steps:\n      - uses: "actions/checkout@v4"\n';
    const [node] = classify(source);
    const out = yamlRewrite(source, [resolution(node)]);
    // The quotes are gone: hex + @ + ` # ` are all plain-safe in YAML.
    expect(out).toBe(
      `jobs:\n  b:\n    steps:\n      - uses: actions/checkout@${SHA} # v4\n`
    );
    // Line count is preserved: 4 source lines + the trailing empty split element.
    expect(out.split("\n")).toHaveLength(5);
    expect(out.split("\n").slice(0, 3)).toEqual(source.split("\n").slice(0, 3));
  });

  it("rewrites a job-level reusable-workflow uses", () => {
    const source = "jobs:\n  call:\n    uses: owner/repo/.github/workflows/x.yml@main\n";
    const [node] = classify(source);
    expect(node.scope).toBe("job");
    const out = yamlRewrite(source, [resolution(node)]);
    expect(out).toBe(
      `jobs:\n  call:\n    uses: owner/repo/.github/workflows/x.yml@${SHA} # main\n`
    );
  });

  it("rewrites a subpath action, keeping the path", () => {
    const source = "jobs:\n  b:\n    steps:\n      - uses: github/codeql-action/init@v3\n";
    const [node] = classify(source);
    const out = yamlRewrite(source, [resolution(node)]);
    expect(out).toContain(
      `uses: github/codeql-action/init@${SHA} # v3`
    );
  });

  it("never rewrites a sha40 or sha256 node — idempotent zero-diff (AC-9)", () => {
    const source = `jobs:
  b:
    steps:
      - uses: actions/checkout@${SHA}
      - uses: owner/repo@${"a".repeat(64)}
`;
    const nodes = classify(source);
    expect(nodes.map((n) => n.cls)).toEqual(["sha40", "sha256"]);
    // Even a (bogus) resolution for them changes nothing.
    expect(yamlRewrite(source, nodes.map((n) => resolution(n, SHA)))).toBe(source);
    expect(yamlRewrite(source, nodes.map((n) => resolution(n, "f".repeat(40))))).toBe(source);
  });

  it("is idempotent on its own output", () => {
    const nodes = classify(FIXTURE);
    const pinned = yamlRewrite(FIXTURE, nodes.map((n) => resolution(n)));
    const repinned = yamlRewrite(pinned, classify(pinned).map((n) => resolution(n)));
    // The second pass classifies every line as sha40, so nothing is editable.
    expect(classify(pinned).every((n) => n.cls === "sha40")).toBe(true);
    expect(repinned).toBe(pinned);
  });

  it("keeps a flow-context step valid", () => {
    const source = "jobs:\n  b:\n    steps: [{uses: actions/checkout@v4}]\n";
    const [node] = classify(source);
    const out = yamlRewrite(source, [resolution(node)]);
    // The pin stays inside the flow mapping and the annotation lands after the
    // closing brace, so the flow sequence is still valid YAML.
    expect(out).toContain(`{uses: actions/checkout@${SHA}}`);
    expect(out).toContain(`}] # v4`);
  });
});

describe("yamlRewrite — comment preservation (PLAN decision 7 · AC-3)", () => {
  it("REPLACES a trailing comment that exactly equals the ref token", () => {
    const source = "jobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4     # v4\n";
    const [node] = classify(source);
    const out = yamlRewrite(source, [resolution(node)]);
    expect(out).toBe(
      `jobs:\n  b:\n    steps:\n      - uses: actions/checkout@${SHA}     # v4\n`
    );
    // No doubling.
    expect(out.split("#")).toHaveLength(2);
  });

  it("PRESERVES an unrelated user comment and appends the ref after it", () => {
    const source =
      "jobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4   # needed for CI\n";
    const [node] = classify(source);
    const out = yamlRewrite(source, [resolution(node)]);
    expect(out).toBe(
      `jobs:\n  b:\n    steps:\n      - uses: actions/checkout@${SHA}   # needed for CI # v4\n`
    );
  });

  it("treats a near-miss comment as a user comment, not a ref label", () => {
    const source = "jobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4  # v4 pinned\n";
    const [node] = classify(source);
    const out = yamlRewrite(source, [resolution(node)]);
    expect(out).toContain("# v4 pinned # v4");
  });
});

describe("applyPin — one edit, by hand", () => {
  it("builds the exact slice replacement", () => {
    const source = "jobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4\n";
    const [node] = classify(source);
    expect(applyPin(source, node, { sha: SHA, originalRef: "v4" })).toEqual({
      start: node.start,
      valueEnd: node.valueEnd,
      text: `actions/checkout@${SHA} # v4`,
    });
  });

  it("exposes the plain-scalar pin text", () => {
    const [node] = classify(
      "jobs:\n  b:\n    steps:\n      - uses: github/codeql-action/init@v3\n"
    );
    expect(pinScalar(node, SHA)).toBe(`github/codeql-action/init@${SHA}`);
  });
});

describe("buildRewriteEdits / applyEdits — the splice engine", () => {
  it("splices several edits right-to-left without touching the rest", () => {
    // `applyEdits` is the engine: three disjoint ranges, each replaced, and
    // every byte between them preserved.
    const source = "AA BB CC";
    const out = yamlRewrite(source, []) ?? source;
    expect(out).toBe(source);
    // A direct splice proves the right-to-left ordering keeps offsets valid.
    const spliced = applyEdits(source, [
      { start: 0, valueEnd: 2, text: "aa" },
      { start: 3, valueEnd: 5, text: "bb" },
      { start: 6, valueEnd: 8, text: "cc" },
    ]);
    expect(spliced).toBe("aa bb cc");
  });

  it("drops a no-op edit and reports the pinnable set", () => {
    const source = "jobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4\n";
    const [node] = classify(source);
    const edits = buildRewriteEdits(source, [resolution(node)]);
    expect(edits).toEqual([
      {
        start: node.start,
        valueEnd: node.valueEnd,
        text: `actions/checkout@${SHA} # v4`,
      },
    ]);
    expect(buildRewriteEdits(source, [])).toEqual([]);
  });

  it("ignores resolutions that are not pinnable", () => {
    const source = "jobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4\n";
    const [node] = classify(source);
    expect(
      buildRewriteEdits(source, [{ ...resolution(node), resolvedSha: "not-a-sha" }])
    ).toEqual([]);
    expect(
      buildRewriteEdits(source, [
        { ...resolution(node), status: "unknown-ref", resolvedSha: null },
      ])
    ).toEqual([]);
  });
});

describe("yamlRewrite — the resolution input shapes", () => {
  it("accepts an array, a Map keyed by node id and a Map keyed by owner/repo@ref", () => {
    const nodes = classify(FIXTURE);
    const byArray = yamlRewrite(FIXTURE, nodes.map((n) => resolution(n)));
    const byId = new Map(nodes.map((n) => [n.id, resolution(n)]));
    expect(yamlRewrite(FIXTURE, byId)).toBe(byArray);
    const byRepo = new Map(
      nodes.map((n) => [`${n.owner}/${n.repo}@${n.ref}`, resolution(n)])
    );
    expect(yamlRewrite(FIXTURE, byRepo)).toBe(byArray);
  });

  it("rejects a stale resolution whose offsets no longer match", () => {
    // Replaying the FIRST pass's resolutions against the already-pinned output
    // must be a no-op — the guard is what makes idempotency safe.
    const nodes = classify(FIXTURE);
    const pinned = yamlRewrite(FIXTURE, nodes.map((n) => resolution(n)));
    expect(yamlRewrite(pinned, nodes.map((n) => resolution(n)))).toBe(pinned);
  });
});
