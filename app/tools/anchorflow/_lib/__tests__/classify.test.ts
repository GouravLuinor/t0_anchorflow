import { describe, expect, it } from "vitest";
import {
  FLOATING_MAJOR_RE,
  MOVING_REFS,
  classifyOne,
  classifyUses,
  isDockerRef,
  isLocalPath,
  isMovingRef,
  splitRemoteRef,
  summarizeClasses,
} from "../classify";
import type { UsesRaw } from "../types";

/**
 * The 6-class × 2-scope classifier (SPEC §4 F2 · AC-1).
 *
 * The adjudicated moving rule is tested at BOTH poles:
 *   moving → @v4 · @4 · @main · @master · @HEAD · @trunk · @develop · @latest
 *   fixed  → @v4.2.0 · @4.2 · @1.2.3-rc.1
 */

function raw(value: string, overrides: Partial<UsesRaw> = {}): UsesRaw {
  return {
    id: "job:0",
    jobId: "job",
    scope: "step",
    stepIndex: 0,
    raw: value,
    start: 0,
    valueEnd: value.length,
    existingComment: null,
    ...overrides,
  };
}

function cls(value: string) {
  const { raw: _raw, ...meta } = raw(value);
  return classifyOne(value, meta).cls;
}

describe("splitRemoteRef — the LAST @, subpath kept", () => {
  it("keeps a subpath and splits the ref on the last @", () => {
    expect(splitRemoteRef("github/codeql-action/init@v3")).toEqual({
      ownerRepo: "github/codeql-action/init",
      ref: "v3",
    });
    expect(splitRemoteRef("owner/repo@v1")).toEqual({
      ownerRepo: "owner/repo",
      ref: "v1",
    });
  });

  it("returns null for a value with no usable @", () => {
    expect(splitRemoteRef("owner/repo")).toBeNull();
    expect(splitRemoteRef("@v1")).toBeNull();
    expect(splitRemoteRef("owner/repo@")).toBeNull();
  });
});

describe("the 6 classes (AC-1)", () => {
  it("sha40 — a 40-hex commit is already pinned", () => {
    const sha = "11d5960a326750d5838078e36cf38b85af677262";
    const node = classifyOne(`actions/checkout@${sha}`, raw(`actions/checkout@${sha}`));
    expect(node.cls).toBe("sha40");
    expect(node.ref).toBe(sha);
    expect(node.moving).toBe(false);
    expect(node.owner).toBe("actions");
    expect(node.repo).toBe("checkout");
    expect(node.subpath).toBeNull();
  });

  it("sha256 — a 64-hex digest is pinned but unusual", () => {
    const digest = "a".repeat(64);
    const node = classifyOne(`owner/repo@${digest}`, raw(`owner/repo@${digest}`));
    expect(node.cls).toBe("sha256");
    expect(node.ref).toBe(digest);
    expect(node.moving).toBe(false);
  });

  it("remoteRef — a tag, branch or HEAD, split with its subpath", () => {
    const node = classifyOne(
      "github/codeql-action/init@v3",
      raw("github/codeql-action/init@v3")
    );
    expect(node.cls).toBe("remoteRef");
    expect(node.owner).toBe("github");
    expect(node.repo).toBe("codeql-action");
    expect(node.subpath).toBe("init");
    expect(node.ref).toBe("v3");
    expect(node.moving).toBe(true);
  });

  it("local — ./ and ../ paths are skipped, never resolved", () => {
    expect(cls("./.github/actions/setup")).toBe("local");
    expect(cls("../shared/action")).toBe("local");
    const node = classifyOne("./.github/actions/setup", raw("./.github/actions/setup"));
    expect(node.owner).toBeNull();
    expect(node.ref).toBeNull();
    expect(node.moving).toBe(false);
  });

  it("docker — a registry image is out of v1 scope", () => {
    expect(cls("docker://alpine:3.20")).toBe("docker");
    expect(cls("docker://ghcr.io/owner/image@sha256:" + "a".repeat(64))).toBe("docker");
    const node = classifyOne("docker://alpine:3.20", raw("docker://alpine:3.20"));
    expect(node.owner).toBeNull();
    expect(node.ref).toBeNull();
  });

  it("invalid — empty, unparseable and repo-less values", () => {
    expect(cls("")).toBe("invalid");
    expect(cls("   ")).toBe("invalid");
    expect(cls("nope")).toBe("invalid");
    expect(cls("justowner@v1")).toBe("invalid");
    expect(cls("owner/repo@")).toBe("invalid");
  });

  it("isLocalPath / isDockerRef are the documented predicates", () => {
    expect(isLocalPath("./x")).toBe(true);
    expect(isLocalPath("../x")).toBe(true);
    expect(isLocalPath(".hidden/x")).toBe(false);
    expect(isDockerRef("docker://alpine")).toBe(true);
    expect(isDockerRef("./docker://x")).toBe(false);
  });
});

describe("the moving-ref rule — BOTH poles (AC-1)", () => {
  it("exports the exact adjudicated constants", () => {
    expect(MOVING_REFS).toEqual([
      "main",
      "master",
      "HEAD",
      "trunk",
      "develop",
      "latest",
    ]);
    expect(FLOATING_MAJOR_RE.source).toBe("^v?\\d+$");
  });

  it("isMovingRef — moving pole", () => {
    for (const ref of ["v4", "4", "v0", "main", "master", "HEAD", "trunk", "develop", "latest"]) {
      expect(isMovingRef(ref), ref).toBe(true);
    }
  });

  it("isMovingRef — fixed pole", () => {
    for (const ref of ["v4.2.0", "4.2", "1.2.3-rc.1", "v10.0.1", "stable", "release-1"]) {
      expect(isMovingRef(ref), ref).toBe(false);
    }
  });

  it("classifies the moving flag at both poles", () => {
    const moving = ["v4", "4", "main", "master", "HEAD", "trunk", "develop", "latest"];
    for (const ref of moving) {
      const node = classifyOne(`owner/repo@${ref}`, raw(`owner/repo@${ref}`));
      expect(node.moving, ref).toBe(true);
    }
    const fixed = ["v4.2.0", "4.2", "1.2.3-rc.1"];
    for (const ref of fixed) {
      const node = classifyOne(`owner/repo@${ref}`, raw(`owner/repo@${ref}`));
      expect(node.moving, ref).toBe(false);
      expect(node.cls).toBe("remoteRef");
    }
  });

  it("a SHA is never a moving target", () => {
    expect(isMovingRef("11d5960a326750d5838078e36cf38b85af677262")).toBe(false);
  });
});

describe("classifyUses — the whole list, order preserved", () => {
  it("keeps every node's identity and scope", () => {
    const step = raw("actions/checkout@v4", { id: "build:0", jobId: "build", stepIndex: 0 });
    const job = raw("owner/repo/.github/workflows/x.yml@main", {
      id: "release:job",
      jobId: "release",
      scope: "job",
      stepIndex: null,
    });
    const classified = classifyUses([step, job]);

    expect(classified).toHaveLength(2);
    expect(classified[0]).toMatchObject({
      id: "build:0",
      scope: "step",
      cls: "remoteRef",
      moving: true,
    });
    expect(classified[1]).toMatchObject({
      id: "release:job",
      scope: "job",
      cls: "remoteRef",
      moving: true,
      subpath: ".github/workflows/x.yml",
      ref: "main",
    });
  });

  it("never mutates the inputs", () => {
    const nodes = [raw("actions/checkout@v4")];
    const snapshot = JSON.stringify(nodes);
    classifyUses(nodes);
    expect(JSON.stringify(nodes)).toBe(snapshot);
  });
});

describe("summarizeClasses — the counts the DiagnosticPane renders", () => {
  const classified = classifyUses([
    raw("actions/checkout@v4"),
    raw("actions/setup-node@v4.2.0"),
    raw("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683"),
    raw(`owner/repo@${"a".repeat(64)}`),
    raw("owner/repo/x.yml@main", { scope: "job", stepIndex: null, id: "r:job" }),
    raw("./local"),
    raw("docker://alpine:3.20"),
    raw("broken"),
  ]);

  it("counts every class, the pending set and the moving set", () => {
    const summary = summarizeClasses(classified);
    expect(summary.total).toBe(8);
    expect(summary.byClass).toEqual({
      sha40: 1,
      sha256: 1,
      remoteRef: 3,
      local: 1,
      docker: 1,
      invalid: 1,
    });
    // pinned aggregates sha40 + sha256 …
    expect(summary.pinned).toBe(2);
    // … pending is the resolvable set …
    expect(summary.pending).toBe(3);
    // … and moving counts every flagged node regardless of scope (@v4 + @main;
    // @v4.2.0 is a fixed point).
    expect(summary.moving).toBe(2);
    expect(summary.skipped).toBe(2);
  });

  it("is empty-safe", () => {
    expect(summarizeClasses([])).toEqual({
      total: 0,
      pinned: 0,
      pending: 0,
      moving: 0,
      local: 0,
      docker: 0,
      invalid: 0,
      skipped: 0,
      byClass: { sha40: 0, sha256: 0, remoteRef: 0, local: 0, docker: 0, invalid: 0 },
    });
  });
});
