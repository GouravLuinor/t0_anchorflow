import { describe, expect, it } from "vitest";
import { MAX_INPUT_BYTES } from "../constants";
import {
  countBytes,
  countLines,
  countWords,
  lineOfOffset,
  measureText,
  truncateForDispatch,
  truncateToCap,
} from "../textMetrics";

/**
 * The measurement + cap module. The interesting cases are the ones a
 * `String.length` gate gets WRONG: CJK text (3 UTF-8 bytes per UTF-16 unit) and
 * non-BMP emoji (2 UTF-16 units, 4 UTF-8 bytes). Both are why
 * `truncateForDispatch` gates on `countBytes` and cuts on a code-point
 * boundary rather than slicing by index.
 */

describe("the plain counters", () => {
  it("counts bytes, not UTF-16 units", () => {
    expect(countBytes("abc")).toBe(3);
    expect(countBytes("漢字")).toBe(6); // 2 chars × 3 bytes
    expect(countBytes("🙂")).toBe(4); // 1 code point × 4 bytes
    expect(countBytes("")).toBe(0);
  });

  it("counts words and lines the way the status strip shows them", () => {
    expect(countWords("  a b\tc\n")).toBe(3);
    expect(countWords("   ")).toBe(0);
    expect(countLines("a\nb")).toBe(2);
    expect(countLines("a\nb\n")).toBe(2);
    expect(countLines("")).toBe(0);
  });

  it("keeps all four measurements together", () => {
    expect(measureText("a b\n漢")).toEqual({
      characterCount: 5, // a, space, b, newline, 漢
      wordCount: 3,
      byteCount: 4 + 3, // "a b\n" (4 bytes) + the 3-byte CJK char
      lineCount: 2,
    });
  });

  it("maps an offset to its 1-based line", () => {
    expect(lineOfOffset("a\nb\nc", 0)).toBe(1);
    expect(lineOfOffset("a\nb\nc", 2)).toBe(2);
    expect(lineOfOffset("a\nb\nc", 4)).toBe(3);
    expect(lineOfOffset("a\nb", 99)).toBe(2);
  });
});

describe("truncateToCap — the code-point boundary", () => {
  it("passes a text under the cap through untouched", () => {
    const result = truncateToCap("name: ci\n");
    expect(result.text).toBe("name: ci\n");
    expect(result.truncated).toBe(false);
    expect(result.originalBytes).toBe(9);
  });

  it("cuts CJK text on a character boundary and reports the real size", () => {
    // 3 CJK chars = 9 bytes; a 5-byte cap must keep ONE char (3 bytes), not
    // slice into the middle of the second.
    const result = truncateToCap("漢字語", 5);
    expect(result.text).toBe("漢");
    expect(result.truncated).toBe(true);
    expect(result.originalBytes).toBe(9);
  });

  it("never leaves a lone surrogate at the cut", () => {
    // 🙂 is 2 UTF-16 units / 4 UTF-8 bytes. A 5-byte cap fits the first emoji
    // and must not carry half of the second.
    const source = "🙂🙂";
    const result = truncateToCap(source, 5);
    expect(result.text).toBe("🙂");
    expect(result.truncated).toBe(true);
    for (const unit of result.text) {
      const code = unit.codePointAt(0) ?? 0;
      expect(code).toBeGreaterThanOrEqual(0x10000);
    }
  });

  it("is idempotent on its own output", () => {
    const result = truncateToCap("漢字語", 5);
    const again = truncateToCap(result.text, 5);
    expect(again.text).toBe(result.text);
    expect(again.truncated).toBe(false);
  });
});

describe("truncateForDispatch — the worker dispatch cap (A3)", () => {
  it("gates on BYTES, so a CJK-heavy paste is actually capped", () => {
    // 100,000 CJK chars = 300,000 bytes but only 100,000 UTF-16 units. A
    // `source.length > MAX_INPUT_BYTES` gate would NOT trigger (100k < 262k),
    // and a byte cap MUST.
    const source = "漢".repeat(100_000);
    expect(source.length).toBeLessThan(MAX_INPUT_BYTES);
    expect(countBytes(source)).toBeGreaterThan(MAX_INPUT_BYTES);

    const dispatched = truncateForDispatch(source);
    expect(countBytes(dispatched)).toBeLessThanOrEqual(MAX_INPUT_BYTES);
    expect(dispatched.length).toBeLessThan(source.length);
    // The cut lands on a whole-character boundary: the dispatched text is an
    // exact run of the same character, never a mangled tail.
    expect(dispatched).toBe("漢".repeat(dispatched.length));
    expect(countBytes(dispatched) % 3).toBe(0);
  });

  it("leaves an ASCII workflow under the cap byte-identical", () => {
    const source = `name: ci\non:\n  push:\njobs:\n  build:\n    steps:\n      - uses: actions/checkout@v4\n`;
    expect(truncateForDispatch(source)).toBe(source);
  });

  it("never splits a surrogate pair when it does cut", () => {
    const source = "🙂".repeat(MAX_INPUT_BYTES); // 524,288 bytes ≫ cap
    const dispatched = truncateForDispatch(source);
    expect(countBytes(dispatched)).toBeLessThanOrEqual(MAX_INPUT_BYTES);
    // No lone high surrogates: every unit is part of a pair.
    for (let i = 0; i < dispatched.length; i += 1) {
      const code = dispatched.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        expect(dispatched.charCodeAt(i + 1)).toBeGreaterThanOrEqual(0xdc00);
      }
    }
    expect(dispatched).toBe("🙂".repeat(dispatched.length / 2));
  });
});
