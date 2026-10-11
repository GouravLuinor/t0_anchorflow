import { describe, expect, it } from "vitest";
import {
  SEVERITY_BANDS,
  countBySeverity,
  evidenceText,
  formatFinding,
  formatFindings,
  severityRank,
  sortFindings,
  worstSeverity,
} from "../findings";
import type { Finding, Severity } from "../types";

function finding(
  id: string,
  category: Finding["category"],
  severity: Severity,
  start: number | null
): Finding {
  return {
    id,
    category,
    severity,
    title: `finding ${id}`,
    detail: "detail",
    remediation: "fix",
    where: `jobs.x.${id}`,
    start,
  };
}

describe("sortFindings — the canonical order (SPEC §9 AC-10)", () => {
  const a = finding("excessive-permissions:x:job:1", "excessive-permissions", "error", 100);
  const b = finding("template-injection:x:0:1", "template-injection", "error", 40);
  const c = finding("persist-credentials:x:0:1", "persist-credentials", "warn", 100);
  const d = finding("resolution:x:0:1", "resolution", "info", null);
  const e = finding("dangerous-trigger:x:job:1", "dangerous-trigger", "warn", null);

  it("orders by ascending source offset, null sorting LAST", () => {
    expect(sortFindings([a, b, c, d, e]).map((f) => f.id)).toEqual([
      "template-injection:x:0:1",
      "excessive-permissions:x:job:1",
      "persist-credentials:x:0:1",
      "dangerous-trigger:x:job:1",
      "resolution:x:0:1",
    ]);
  });

  it("breaks an offset tie by category, then by id", () => {
    const one = finding("b:x:job:1", "template-injection", "error", 10);
    const two = finding("a:x:job:1", "template-injection", "error", 10);
    const three = finding("a:x:job:2", "template-injection", "error", 10);
    const four = finding("a:x:job:1", "dangerous-trigger", "error", 10);
    expect(sortFindings([one, two, three, four]).map((f) => f.id)).toEqual([
      "a:x:job:1", // dangerous-trigger sorts before template-injection
      "a:x:job:1",
      "a:x:job:2",
      "b:x:job:1",
    ]);
  });

  it("never mutates its input", () => {
    const input = [a, b, c];
    const snapshot = [...input];
    sortFindings(input);
    expect(input).toEqual(snapshot);
  });

  it("is a total order: shuffling a large set converges", () => {
    const many = Array.from({ length: 40 }, (_unused, i) =>
      finding(
        `id:${i % 5}:${i % 3}:${i % 7}`,
        (["excessive-permissions", "template-injection", "persist-credentials"] as const)[i % 3],
        (["error", "warn", "info"] as const)[i % 3],
        i % 6 === 0 ? null : i * 3
      )
    );
    const one = sortFindings(many);
    const two = sortFindings([...many].reverse());
    expect(one).toEqual(two);
  });
});

describe("severity bands, counts and copy text", () => {
  it("keeps the band order worst-first with the published labels", () => {
    expect(SEVERITY_BANDS).toEqual([
      { severity: "error", label: "critical" },
      { severity: "warn", label: "major" },
      { severity: "minor", label: "minor" },
      { severity: "info", label: "info" },
    ]);
    expect(severityRank("error")).toBeLessThan(severityRank("warn"));
    expect(severityRank("warn")).toBeLessThan(severityRank("minor"));
    expect(severityRank("minor")).toBeLessThan(severityRank("info"));
  });

  it("counts per grade", () => {
    const counts = countBySeverity([
      finding("a", "template-injection", "error", 1),
      finding("b", "template-injection", "error", 2),
      finding("c", "excessive-permissions", "warn", 3),
      finding("d", "resolution", "info", 4),
    ]);
    expect(counts).toEqual({ error: 2, warn: 1, minor: 0, info: 1 });
    expect(worstSeverity([])).toBeNull();
    expect(worstSeverity([finding("d", "resolution", "info", 4), finding("a", "template-injection", "warn", 1)])).toBe("warn");
  });

  it("formats one finding for the per-finding copy", () => {
    const text = formatFinding(finding("template-injection:x:0:1", "template-injection", "error", 12));
    expect(text).toBe(
      "[error] finding template-injection:x:0:1\nwhere: jobs.x.template-injection:x:0:1\ndetail: detail\nfix: fix"
    );
  });

  it("formats the whole report with a severity summary header", () => {
    const text = formatFindings([
      finding("a", "excessive-permissions", "error", 1),
      finding("b", "template-injection", "warn", 2),
    ]);
    expect(text).toContain("Anchorflow findings — 2 total (critical: 1 · major: 1 · minor: 0 · info: 0)");
    expect(text).toContain("[warn] finding b");
    expect(text.indexOf("[error] finding a")).toBeLessThan(text.indexOf("[warn] finding b"));
  });

  it("formats an empty report without pretending to have findings", () => {
    expect(formatFindings([])).toBe(
      "Anchorflow findings — none. No findings were produced for this workflow."
    );
  });

  it("flattens a multiline expression and caps its length", () => {
    expect(evidenceText("echo   ${{   github.head_ref   }}\n  done")).toBe(
      "echo ${{ github.head_ref }} done"
    );
    const long = "x".repeat(400);
    expect(evidenceText(long)).toHaveLength(160);
    expect(evidenceText(long).endsWith("…")).toBe(true);
  });
});
