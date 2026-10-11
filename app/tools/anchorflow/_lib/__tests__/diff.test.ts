import { describe, expect, it } from "vitest";
import { DIFF_CONTEXT_LINES, unifiedUsesDiff } from "../diff";

/**
 * The red/green unified diff (ARCH §3.10 · SPEC §4 F4 · AC-9).
 *
 * Locked properties: deterministic hunks (context + `-`/`+` pairs with line
 * numbers), a correct change counter, and an EMPTY diff for identical inputs —
 * which is what makes re-running Anchorflow on its own output a zero-diff.
 */

const BEFORE = `name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4.2.0
      - run: npm ci && npm test
`;

const AFTER = `name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262  # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020  # v4.2.0
      - run: npm ci && npm test
`;

describe("unifiedUsesDiff — the known before/after", () => {
  it("reports exactly the changed uses lines as -/+ pairs (AC-9)", () => {
    const diff = unifiedUsesDiff(BEFORE, AFTER);
    expect(diff.changed).toBe(2);

    const dels = diff.lines.filter((line) => line.kind === "del");
    const adds = diff.lines.filter((line) => line.kind === "add");
    expect(dels).toHaveLength(2);
    expect(adds).toHaveLength(2);

    // Each pair sits on the same source line: the pin preserves the line count.
    expect(dels[0].beforeLine).toBe(7);
    expect(adds[0].afterLine).toBe(7);
    expect(dels[1].beforeLine).toBe(8);
    expect(adds[1].afterLine).toBe(8);

    expect(dels[0].text).toBe("      - uses: actions/checkout@v4");
    expect(adds[0].text).toBe(
      "      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262  # v4"
    );
    expect(dels[1].text).toBe("      - uses: actions/setup-node@v4.2.0");
    expect(adds[1].text).toBe(
      "      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020  # v4.2.0"
    );

    // The pairs are interleaved: - then + for each changed line, not two blocks.
    // (`""` is the empty line the trailing newline produces.)
    expect(diff.lines.map((line) => line.kind)).toEqual([
      "context",
      "context",
      "context",
      "del",
      "add",
      "del",
      "add",
      "context",
      "context",
    ]);
  });

  it("keeps three lines of context around a change", () => {
    const diff = unifiedUsesDiff(BEFORE, AFTER);
    expect(DIFF_CONTEXT_LINES).toBe(3);
    const contexts = diff.lines.filter((line) => line.kind === "context");
    expect(contexts).toHaveLength(5);
    expect(contexts[0].text).toBe("  build:");
    expect(contexts[3].text).toBe("      - run: npm ci && npm test");
    expect(contexts[4].text).toBe("");
  });

  it("carries a line number on the side the line belongs to", () => {
    const diff = unifiedUsesDiff(BEFORE, AFTER);
    for (const line of diff.lines) {
      if (line.kind === "del") {
        expect(line.beforeLine).not.toBeNull();
        expect(line.afterLine).toBeNull();
      } else if (line.kind === "add") {
        expect(line.afterLine).not.toBeNull();
        expect(line.beforeLine).toBeNull();
      } else {
        expect(line.beforeLine).not.toBeNull();
        expect(line.afterLine).not.toBeNull();
      }
    }
  });
});

describe("unifiedUsesDiff — the empty diff", () => {
  it("is EMPTY for identical inputs (the idempotency guarantee, AC-9)", () => {
    const diff = unifiedUsesDiff(BEFORE, BEFORE);
    expect(diff).toEqual({ changed: 0, lines: [] });
    expect(unifiedUsesDiff("", "")).toEqual({ changed: 0, lines: [] });
    expect(unifiedUsesDiff(AFTER, AFTER).lines).toEqual([]);
  });

  it("is empty for a trailing-newline-only difference", () => {
    expect(unifiedUsesDiff("a\nb\n", "a\nb\n").changed).toBe(0);
  });
});

describe("unifiedUsesDiff — insertion, deletion and counting", () => {
  it("counts a pure insertion once per added line", () => {
    const diff = unifiedUsesDiff("a\nc\n", "a\nb\nc\n");
    expect(diff.changed).toBe(1);
    expect(diff.lines.map((line) => line.kind)).toEqual([
      "context",
      "add",
      "context",
      "context",
    ]);
    expect(diff.lines[1].afterLine).toBe(2);
    expect(diff.lines[1].beforeLine).toBeNull();
    expect(diff.lines[2]).toEqual({ kind: "context", text: "c", beforeLine: 2, afterLine: 3 });
  });

  it("counts a pure deletion once per removed line", () => {
    const diff = unifiedUsesDiff("a\nb\nc\n", "a\nc\n");
    expect(diff.changed).toBe(1);
    expect(diff.lines.map((line) => line.kind)).toEqual([
      "context",
      "del",
      "context",
      "context",
    ]);
    expect(diff.lines[1].beforeLine).toBe(2);
    expect(diff.lines[1].afterLine).toBeNull();
  });

  it("counts a 1-to-3 replacement as 3 changed lines", () => {
    const diff = unifiedUsesDiff("a\nb\nc\n", "a\nX\nY\nZ\nc\n");
    expect(diff.changed).toBe(3);
    expect(diff.lines.map((line) => line.kind)).toEqual([
      "context",
      "del",
      "add",
      "add",
      "add",
      "context",
      "context",
    ]);
  });

  it("is deterministic — the same input, the same hunks every time", () => {
    const first = unifiedUsesDiff(BEFORE, AFTER);
    for (let i = 0; i < 5; i += 1) {
      expect(unifiedUsesDiff(BEFORE, AFTER)).toEqual(first);
    }
  });

  it("stays ordered by source position across many changes", () => {
    const before = Array.from({ length: 12 }, (_, i) => `line ${i}`).join("\n");
    const afterLines = Array.from({ length: 12 }, (_, i) =>
      i % 2 === 0 ? `line ${i}` : `CHANGED ${i}`
    );
    const diff = unifiedUsesDiff(before, afterLines.join("\n"));
    expect(diff.changed).toBe(6);
    const dels = diff.lines.filter((line) => line.kind === "del").map((l) => l.beforeLine);
    expect(dels).toEqual([...dels].sort((a, b) => (a ?? 0) - (b ?? 0)));
  });
});
