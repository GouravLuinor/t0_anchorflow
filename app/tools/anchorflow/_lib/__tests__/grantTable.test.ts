import { describe, expect, it } from "vitest";
import {
  PERMISSION_SCOPES,
  SCOPE_SEMANTICS,
  blockScopes,
  buildGrantTable,
  describeGrant,
  effectiveJobGrants,
  expandBlock,
  parsePermissions,
  scopeSemantics,
} from "../grantTable";
import { parseWorkflow } from "../yamlParse";
import type { WorkflowModel } from "../types";

function modelOf(source: string): WorkflowModel {
  const parsed = parseWorkflow(source);
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.model;
}

describe("the scope table — what every scope actually grants", () => {
  it("documents every canonical scope GitHub publishes", () => {
    expect(PERMISSION_SCOPES).toEqual([
      "actions",
      "attestations",
      "checks",
      "contents",
      "deployments",
      "discussions",
      "id-token",
      "issues",
      "models",
      "packages",
      "pages",
      "pull-requests",
      "repository-projects",
      "security-events",
      "statuses",
    ]);
    for (const scope of PERMISSION_SCOPES) {
      expect(SCOPE_SEMANTICS[scope], scope).toBeTypeOf("string");
      expect(SCOPE_SEMANTICS[scope].length).toBeGreaterThan(10);
    }
  });

  it("says what contents and packages grant, not just their names", () => {
    expect(SCOPE_SEMANTICS.contents).toBe(
      "read repository files; write pushes commits, tags and releases"
    );
    expect(SCOPE_SEMANTICS.packages).toBe(
      "read packages; write uploads and deletes container/package versions"
    );
    expect(describeGrant("contents", "write")).toBe(
      "contents: write — read repository files; write pushes commits, tags and releases"
    );
  });

  it("marks a misspelled scope instead of silently dropping it", () => {
    expect(scopeSemantics("content")).toContain("unknown scope");
    expect(scopeSemantics("content")).toContain('not a GitHub-recognized');
  });
});

describe("parsePermissions — the normalising seam", () => {
  it("reads the write-all / read-all shorthands", () => {
    expect(parsePermissions("write-all")).toEqual({ all: "write", scopes: {} });
    expect(parsePermissions("read-all")).toEqual({ all: "read", scopes: {} });
    expect(parsePermissions("  write-all ")).toEqual({ all: "write", scopes: {} });
  });

  it("reads a per-scope map, ignoring non-level values", () => {
    expect(parsePermissions({ contents: "read", "id-token": "write" })).toEqual({
      scopes: { contents: "read", "id-token": "write" },
    });
    expect(parsePermissions({ contents: "nonsense", issues: "read" })).toEqual({
      scopes: { issues: "read" },
    });
  });

  it("keeps the shorthand AND the per-scope overrides when both are present", () => {
    expect(
      parsePermissions({ all: "write", scopes: { contents: "read" } })
    ).toEqual({ all: "write", scopes: { contents: "read" } });
  });

  it("returns null for anything that is not a permissions block", () => {
    expect(parsePermissions(null)).toBeNull();
    expect(parsePermissions(undefined)).toBeNull();
    expect(parsePermissions("nonsense")).toBeNull();
    expect(parsePermissions(["contents: read"])).toBeNull();
    expect(parsePermissions({})).toBeNull();
  });
});

describe("expandBlock — GitHub's own resolution order", () => {
  it("expands write-all to every known scope", () => {
    const expanded = expandBlock(parsePermissions("write-all"));
    expect(Object.keys(expanded)).toEqual([...PERMISSION_SCOPES]);
    expect(new Set(Object.values(expanded))).toEqual(new Set(["write"]));
  });

  it("expands read-all to every known scope at read", () => {
    const expanded = expandBlock(parsePermissions("read-all"));
    expect(Object.keys(expanded)).toHaveLength(PERMISSION_SCOPES.length);
    expect(new Set(Object.values(expanded))).toEqual(new Set(["read"]));
  });

  it("lets an explicit scope override the shorthand", () => {
    const expanded = expandBlock(
      parsePermissions({ all: "write", scopes: { contents: "read" } })
    );
    expect(expanded.contents).toBe("read");
    expect(expanded.packages).toBe("write");
  });

  it("keeps an unknown scope next to the known ones", () => {
    const expanded = expandBlock(parsePermissions({ contents: "read", contets: "write" }));
    expect(expanded.contets).toBe("write");
    expect(blockScopes(parsePermissions({ contents: "read", contets: "write" }))).toEqual([
      "contents",
      "contets",
    ]);
  });

  it("expands an absent block to nothing", () => {
    expect(expandBlock(null)).toEqual({});
  });
});

describe("effectiveJobGrants — the job block overrides the top block per scope", () => {
  const top = parsePermissions({ contents: "read", issues: "read" });

  it("falls back to the top block for scopes the job omits", () => {
    const rows = effectiveJobGrants(
      { id: "build", permissions: parsePermissions({ packages: "write" }) },
      top
    );
    const map = Object.fromEntries(rows.map((row) => [row.scope, row]));
    expect(map.packages).toEqual({ scope: "packages", level: "write", source: "job:build" });
    expect(map.contents).toEqual({ scope: "contents", level: "read", source: "top" });
  });

  it("prefers the job block over the top block for the same scope", () => {
    const rows = effectiveJobGrants(
      { id: "build", permissions: parsePermissions({ contents: "write" }) },
      top
    );
    expect(rows.find((row) => row.scope === "contents")).toEqual({
      scope: "contents",
      level: "write",
      source: "job:build",
    });
  });

  it("yields nothing when neither block mentions the scope", () => {
    expect(
      effectiveJobGrants({ id: "build", permissions: null }, parsePermissions("read-all"))
        .find((row) => row.scope === "contents")?.level
    ).toBe("read");
    expect(effectiveJobGrants({ id: "build", permissions: null }, null)).toEqual([]);
  });
});

describe("buildGrantTable — the table the pane renders", () => {
  it("maps every job to its own block plus the effective rows", () => {
    const table = buildGrantTable(
      modelOf(`on: push
permissions:
  contents: read
jobs:
  build:
    permissions:
      packages: write
    steps:
      - run: npm test
  test:
    permissions:
      contents: read
    steps:
      - run: npm test
`)
    );

    expect(table.top).toEqual({ scopes: { contents: "read" } });
    expect(table.jobs).toEqual([
      { jobId: "build", block: { scopes: { packages: "write" } } },
      { jobId: "test", block: { scopes: { contents: "read" } } },
    ]);
    // Canonical scope order within a job; jobs in source order.
    expect(table.effective).toEqual([
      { scope: "contents", level: "read", source: "top" },
      { scope: "packages", level: "write", source: "job:build" },
      { scope: "contents", level: "read", source: "job:test" },
    ]);
    expect(table.unset).toBe(false);
  });

  it("marks the workflow unset when no block exists at any level", () => {
    const table = buildGrantTable(
      modelOf("on: push\njobs:\n  build:\n    steps:\n      - run: npm test\n")
    );
    expect(table.top).toBeNull();
    expect(table.unset).toBe(true);
    expect(table.effective).toEqual([]);
  });

  it("is not unset when only one job pins a block", () => {
    const table = buildGrantTable(
      modelOf("on: push\njobs:\n  a:\n    permissions:\n      contents: read\n    steps:\n      - run: x\n  b:\n    steps:\n      - run: y\n")
    );
    expect(table.unset).toBe(false);
    expect(table.jobs[1].block).toBeNull();
  });

  it("expands a top-level write-all into every scope for every job", () => {
    const table = buildGrantTable(
      modelOf("on: push\npermissions: write-all\njobs:\n  a:\n    steps:\n      - run: x\n  b:\n    steps:\n      - run: y\n")
    );
    expect(table.effective.filter((row) => row.level === "write")).toHaveLength(
      PERMISSION_SCOPES.length * 2
    );
    expect(table.effective.every((row) => row.source === "top")).toBe(true);
  });

  it("is deterministic for the same model", () => {
    const source = "permissions: read-all\njobs:\n  a:\n    permissions:\n      contents: write\n    steps:\n      - run: x\n";
    const a = buildGrantTable(modelOf(source));
    const b = buildGrantTable(modelOf(source));
    expect(a).toEqual(b);
  });
});
