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
  truncateToCap,
} from "../analyze";
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

  it("echoes the text and carries every count", () => {
    const body = analyzeLocal(source);
    expect(body.echo).toBe(source);
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
    expect(body.findings).toEqual([]);
    expect(body.rewrittenYaml).toBeNull();
    expect(body.diff).toBeNull();
    expect(body.permissions).toBeNull();
    expect(body.rateLimit).toEqual({ limit: 60, remaining: 60, resetAt: 0 });
    // A reviewer can spread it into the worker payload with no missing keys.
    const payload: WorkerOutputPayload = { ...body, id: 1, phase: "A" };
    expect(Object.keys(payload).sort()).toEqual(
      [
        "diff",
        "echo",
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

  it("echoes the truncated text when over the cap", () => {
    const big = "y".repeat(MAX_INPUT_BYTES + 1_000);
    const body = analyzeLocal(big);
    expect(body.metrics.truncated).toBe(true);
    expect(body.echo).not.toBe(big);
    expect(body.metrics.byteCount).toBeLessThanOrEqual(MAX_INPUT_BYTES);
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
    expect(first.echo).toBe(second.echo);
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
