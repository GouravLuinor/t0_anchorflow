import { describe, expect, it } from "vitest";
import {
  ANALYZE_TIMEOUT_ERROR,
  EMPTY_METRICS,
  analyzeLocal,
  countBytes,
  countLines,
  countWords,
  isOverDeadline,
  measureText,
  truncateForDispatch,
  truncateToCap,
} from "../analyze";
import { sortFindings } from "../findings";
import { MAX_INPUT_BYTES } from "../constants";
import type { WorkerOutputPayload } from "../types";

const MULTIBYTE = "héllo \u{1F680} anchor — clé"; // accents + a non-BMP emoji

describe("countWords — whitespace-delimited", () => {
  it("counts word runs separated by any whitespace", () => {
    expect(countWords("one two  three\nfour\tfive")).toBe(5);
  });

  it("returns 0 for empty or whitespace-only text", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n\t ")).toBe(0);
  });
});

describe("countBytes — UTF-8 length", () => {
  it("is not the string length for non-ASCII input", () => {
    expect(countBytes("abc")).toBe(3);
    expect(countBytes("é")).toBe(2);
    expect(countBytes("\u{1F680}")).toBe(4);
    expect(countBytes(MULTIBYTE)).toBeGreaterThan(MULTIBYTE.length);
  });
});

describe("countLines — newline semantics", () => {
  it("does not count a trailing newline as an extra line", () => {
    expect(countLines("a\nb\nc")).toBe(3);
    expect(countLines("a\nb\nc\n")).toBe(3);
  });

  it("returns 0 for empty input", () => {
    expect(countLines("")).toBe(0);
  });
});

describe("truncateToCap — cap never splits a surrogate", () => {
  it("passes input through below the cap", () => {
    const result = truncateToCap("small workflow");
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("small workflow");
    expect(result.originalBytes).toBe(14);
  });

  it("reports the ORIGINAL byte count and truncates at the cap", () => {
    const source = "x".repeat(MAX_INPUT_BYTES + 5_000);
    const result = truncateToCap(source);
    expect(result.truncated).toBe(true);
    expect(result.originalBytes).toBe(MAX_INPUT_BYTES + 5_000);
    expect(countBytes(result.text)).toBeLessThanOrEqual(MAX_INPUT_BYTES);
    expect(result.text.length).toBeGreaterThan(0);
  });

  it("never leaves a lone surrogate at the cut", () => {
    // A byte budget that admits the high surrogate of a pair but not its low
    // partner: this is the exact case that produces an orphan.
    const source = "x".repeat(MAX_INPUT_BYTES - 3) + "\u{1F680}".repeat(64);
    const result = truncateToCap(source);
    expect(result.truncated).toBe(true);

    // A lone surrogate survives as U+FFFD through encode → decode, so a clean
    // round-trip proves the cut landed on a code-point boundary.
    const roundTripped = new TextDecoder().decode(
      new TextEncoder().encode(result.text)
    );
    expect(roundTripped).toBe(result.text);
    expect(countBytes(result.text)).toBeLessThanOrEqual(MAX_INPUT_BYTES);
  });

  it("keeps every well-formed pair it admits", () => {
    const source = "\u{1F680}".repeat(MAX_INPUT_BYTES / 4 + 10);
    const result = truncateToCap(source);
    const highs = (result.text.match(/[\ud800-\udbff]/g) ?? []).length;
    const lows = (result.text.match(/[\udc00-\udfff]/g) ?? []).length;
    expect(highs).toBe(lows);
    expect(highs).toBeGreaterThan(0);
  });
});

describe("measureText — the placeholder measurement", () => {
  it("returns all four counts", () => {
    expect(measureText("alpha beta\n gamma")).toEqual({
      characterCount: 17,
      wordCount: 3,
      byteCount: 17,
      lineCount: 2,
    });
  });
});

describe("analyzeLocal — the full Phase-A envelope body", () => {
  const source = "name: ci\non: push\njobs: {}\n";

  it("returns the derived output surfaces and every count", () => {
    const body = analyzeLocal(source);
    // No `uses:` nodes ⇒ the rewrite is a byte-identical NO-OP (AC-2) and the
    // diff of it is empty.
    expect(body.rewrittenYaml).toBe(source);
    expect(body.diff).toEqual({ changed: 0, lines: [] });
    expect(body.metrics.characterCount).toBe(source.length);
    expect(body.metrics.wordCount).toBe(6);
    expect(body.metrics.byteCount).toBe(countBytes(source));
    expect(body.metrics.lineCount).toBe(3);
  });

  it("returns a COMPLETE envelope — domain arrays empty, never undefined", () => {
    const body = analyzeLocal(source);
    expect(body.ok).toBe(true);
    expect(body.fatalError).toBe(null);
    expect(body.uses).toEqual([]);
    expect(body.resolutions).toEqual([]);
    // The offline audits found nothing to report: EMPTY, never undefined.
    expect(body.findings).toEqual([]);
    // M3 landed the grant table — a workflow with no `permissions:` block at
    // any level is reported as an UNSET grant, never as a null placeholder.
    expect(body.permissions).toEqual({
      top: null,
      jobs: [],
      effective: [],
      unset: true,
    });
    expect(body.rateLimit).toEqual({ limit: 60, remaining: 60, resetAt: 0 });
    // A reviewer can spread it into the worker payload with no missing keys.
    const payload: WorkerOutputPayload = { ...body, id: 1, phase: "A" };
    expect(Object.keys(payload).sort()).toEqual(
      [
        "diff",
        "fatalError",
        "findings",
        "id",
        "metrics",
        "ok",
        "permissions",
        "phase",
        "rateLimit",
        "resolutions",
        "rewrittenYaml",
        "uses",
      ].sort()
    );
  });

  it("classifies the workflow it parses (counts land on the metrics)", () => {
    const body = analyzeLocal(
      "jobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4\n"
    );
    expect(body.uses).toHaveLength(1);
    expect(body.uses[0].cls).toBe("remoteRef");
    expect(body.uses[0].moving).toBe(true);
    expect(body.metrics.usesCount).toBe(1);
    expect(body.metrics.usesScanned).toBe(1);
    expect(body.metrics.usesCapHit).toBe(false);
    // Still a no-op rewrite: nothing has been resolved yet.
    expect(body.rewrittenYaml).toBe(
      "jobs:\n  b:\n    steps:\n      - uses: actions/checkout@v4\n"
    );
    expect(body.diff?.changed).toBe(0);
  });

  it("reports the `uses:` scan cap honestly — seen, scanned, capped (A6)", () => {
    // More than MAX_USES_SCAN (2,000) nodes: the collector stops at the cap but
    // keeps counting, so the report can say how many were NOT analysed instead
    // of silently dropping them.
    const steps = Array.from(
      { length: 2_500 },
      () => "      - uses: actions/checkout@v4"
    ).join("\n");
    const body = analyzeLocal(
      `jobs:\n  b:\n    steps:\n${steps}\n`
    );
    expect(body.ok).toBe(true);
    expect(body.metrics.usesCapHit).toBe(true);
    expect(body.metrics.usesScanned).toBe(2_000);
    expect(body.metrics.usesSeen).toBe(2_500);
    // The analysed set is the capped one — `usesCount` never claims more than
    // was actually scanned.
    expect(body.metrics.usesCount).toBe(2_000);
    expect(body.uses).toHaveLength(2_000);
    // The alert strip's arithmetic: what the UI tells the user was skipped.
    expect(body.metrics.usesSeen - body.metrics.usesScanned).toBe(500);
  });

  it("reports the four offline audits in the canonical deterministic order (AC-10)", () => {
    // One job per audit, deliberately interleaved so source offsets alone do not
    // explain the order: the sort must fall back to category, then id.
    const source = `on: pull_request_target
permissions: write-all
jobs:
  zeta:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.ref }}
          persist-credentials: true
      - run: echo \${{ github.event.issue.title }}
`;
    const body = analyzeLocal(source, { now: () => 0 });

    const categories = [...new Set(body.findings.map((f) => f.category))].sort();
    expect(categories).toEqual([
      "dangerous-trigger",
      "excessive-permissions",
      "persist-credentials",
      "template-injection",
    ]);
    // Every audit contributed, at the severities the adjudication demands.
    expect(body.findings.some((f) => f.severity === "error")).toBe(true);
    expect(body.findings.some((f) => f.severity === "warn")).toBe(true);

    // Same source in, same array out — byte-for-byte, twice, and again after a
    // re-parse (the order is a pure function of the model).
    const again = analyzeLocal(source, { now: () => 0 });
    expect(again.findings).toEqual(body.findings);
    expect(JSON.stringify(again.findings)).toBe(JSON.stringify(body.findings));

    // Offset, then category, then id — with a null offset sorting last.
    const keys = body.findings.map((f) => ({
      offset: f.start ?? Number.MAX_SAFE_INTEGER,
      category: f.category,
      id: f.id,
    }));
    const sorted = [...keys].sort(
      (a, b) =>
        a.offset - b.offset ||
        a.category.localeCompare(b.category) ||
        a.id.localeCompare(b.id)
    );
    expect(keys).toEqual(sorted);
    // The sort itself is imported from the same module the pipeline uses.
    expect(sortFindings(body.findings)).toEqual(body.findings);
  });

  it("reports the ORIGINAL byte count when the input is truncated", () => {
    const big = "y".repeat(MAX_INPUT_BYTES + 1_000);
    const body = analyzeLocal(big);
    expect(body.metrics.truncated).toBe(true);
    // ARCH §3.2: the cap never hides how big the input really was.
    expect(body.metrics.byteCount).toBe(MAX_INPUT_BYTES + 1_000);
    expect(countBytes(body.rewrittenYaml ?? "")).toBeLessThanOrEqual(
      MAX_INPUT_BYTES
    );
  });

  it("truncates on a code-point boundary and keeps the original byte count", () => {
    // The cut lands where the high surrogate of a pair would be admitted but its
    // low partner would not — the exact orphan-producing case (AC-13).
    const big = "x".repeat(MAX_INPUT_BYTES - 3) + "\u{1F680}".repeat(64);
    const body = analyzeLocal(big);
    expect(body.metrics.truncated).toBe(true);
    expect(body.metrics.byteCount).toBe(countBytes(big));
    const rewritten = body.rewrittenYaml ?? "";
    const roundTripped = new TextDecoder().decode(
      new TextEncoder().encode(rewritten)
    );
    expect(roundTripped).toBe(rewritten);
  });

  it("keeps the TRUE byte count when the WORKER path sends a capped text (AC-13)", () => {
    // The exact slip the worker dispatch used to have: the payload crossed the
    // structured-clone boundary already sliced at the cap, so `analyzeLocal`
    // measured the slice and reported 262,144 bytes with `truncated: false`.
    // `truncateForDispatch` now hands the original count through the payload
    // and the analyzer reports it instead of measuring what it was given.
    const big = "y".repeat(MAX_INPUT_BYTES + 1_000);
    const dispatch = truncateForDispatch(big);
    expect(countBytes(dispatch.text)).toBeLessThanOrEqual(MAX_INPUT_BYTES);

    const worker = analyzeLocal(dispatch.text, {
      originalByteCount: dispatch.originalBytes,
    });
    expect(worker.metrics.byteCount).toBe(MAX_INPUT_BYTES + 1_000);
    expect(worker.metrics.byteCount).toBeGreaterThan(
      countBytes(dispatch.text)
    );
    expect(worker.metrics.truncated).toBe(true);
    // Everything else still describes the capped analysis, not the original.
    expect(worker.metrics.characterCount).toBe(dispatch.text.length);
  });

  it("the WORKER path and the MAIN-THREAD fallback report identical metrics", () => {
    // The main-thread fallback hands over the FULL source (nothing crosses a
    // boundary on that path) and the worker path sends the capped slice plus
    // the original byte count. Both must land on the same report, byte counts
    // and truncated flag included — otherwise the two engines disagree and the
    // degraded path looks like a different instrument.
    const big = "z".repeat(MAX_INPUT_BYTES + 12_345);
    const dispatch = truncateForDispatch(big);

    const fallback = analyzeLocal(big);
    const worker = analyzeLocal(dispatch.text, {
      originalByteCount: dispatch.originalBytes,
    });

    expect({ ...worker.metrics, parseTimeMs: 0 }).toEqual({
      ...fallback.metrics,
      parseTimeMs: 0,
    });
    expect(worker.metrics.byteCount).toBe(MAX_INPUT_BYTES + 12_345);
    expect(worker.metrics.truncated).toBe(true);
    expect(worker.uses).toEqual(fallback.uses);
    expect(worker.rewrittenYaml).toBe(fallback.rewrittenYaml);
    expect(worker.findings).toEqual(fallback.findings);
    expect(worker.ok).toBe(fallback.ok);
  });

  it("never lets a carried count hide an over-cap text (defensive)", () => {
    // A payload whose `source` is over the cap is truncated whatever count it
    // claims; the flag must never come back false while the text exceeds it.
    const body = analyzeLocal("q".repeat(MAX_INPUT_BYTES + 500), {
      originalByteCount: 10,
    });
    expect(body.metrics.truncated).toBe(true);
    expect(body.metrics.byteCount).toBe(10);
    expect(countBytes(body.rewrittenYaml ?? "")).toBeLessThanOrEqual(
      MAX_INPUT_BYTES
    );
  });

  it("keeps the original byte count on the malformed-YAML worker path too", () => {
    const dispatch = truncateForDispatch("jobs:\n\tb: 1\n".repeat(40_000));
    expect(dispatch.truncated).toBe(true);
    const body = analyzeLocal(dispatch.text, {
      originalByteCount: dispatch.originalBytes,
    });
    expect(body.ok).toBe(false);
    expect(body.metrics.byteCount).toBe(dispatch.originalBytes);
    expect(body.metrics.truncated).toBe(true);
  });

  it("settles a malformed input as an error VALUE, never a throw", () => {
    const body = analyzeLocal("jobs:\n\tb: 1\n");
    expect(body.ok).toBe(false);
    expect(body.fatalError).toMatch(/doesn't parse as a workflow YAML/);
    expect(body.fatalError).toContain("2:1");
    expect(body.uses).toEqual([]);
    expect(body.rewrittenYaml).toBeNull();
    expect(body.diff).toBeNull();
    expect(body.metrics.byteCount).toBe(countBytes("jobs:\n\tb: 1\n"));
  });

  it("is deterministic — identical input, identical output", () => {
    // The clock is injected so the measured timing cannot differ between runs;
    // everything else is a pure function of the source text.
    const a = analyzeLocal(source, { now: () => 10 });
    const b = analyzeLocal(source, { now: () => 10 });
    expect(a).toEqual(b);

    const first = analyzeLocal(source);
    const second = analyzeLocal(source);
    expect({ ...first.metrics, parseTimeMs: 0 }).toEqual({
      ...second.metrics,
      parseTimeMs: 0,
    });
    expect(first.rewrittenYaml).toBe(second.rewrittenYaml);
  });

  it("stays byte-identical on the capped worker dispatch, run after run", () => {
    // Determinism must survive the new payload shape, not just the direct one:
    // the same capped text + the same original byte count, analyzed twice, has
    // to serialize identically (parseTimeMs aside — it is a measurement).
    const big = "w".repeat(MAX_INPUT_BYTES + 7_321);
    const dispatch = truncateForDispatch(big);
    const run = () =>
      analyzeLocal(dispatch.text, {
        now: () => 42,
        originalByteCount: dispatch.originalBytes,
      });
    expect(run()).toEqual(run());

    // And the full-source (main-thread fallback) route on the same paste.
    const fallback = () => analyzeLocal(big, { now: () => 42 });
    expect(fallback()).toEqual(fallback());
  });

  it("measures time against an injected clock", () => {
    let tick = 0;
    const body = analyzeLocal("name: ci", { now: () => (tick += 5) });
    expect(body.metrics.parseTimeMs).toBeGreaterThan(0);
  });
});

describe("isOverDeadline — the measured WARN threshold", () => {
  it("flags only a report that genuinely overran", () => {
    expect(isOverDeadline({ parseTimeMs: 0 }, 1_000)).toBe(false);
    expect(isOverDeadline({ parseTimeMs: 1_001 }, 1_000)).toBe(true);
  });
});

describe("shared constants", () => {
  it("exposes a zeroed metrics baseline", () => {
    expect(EMPTY_METRICS).toEqual({
      lineCount: 0,
      byteCount: 0,
      usesCount: 0,
      resolvedCount: 0,
      parseTimeMs: 0,
      resolveTimeMs: 0,
      truncated: false,
      usesSeen: 0,
      usesScanned: 0,
      usesCapHit: false,
      characterCount: 0,
      wordCount: 0,
    });
  });

  it("carries the friendly timeout copy", () => {
    expect(ANALYZE_TIMEOUT_ERROR).toMatch(/time budget/i);
  });
});
