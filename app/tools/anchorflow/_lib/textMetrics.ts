// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — plain-text measurement + the input cap. Pure, no IO.
//
// This module is the shared home of the byte / word / line counters and the
// MAX_INPUT_BYTES truncation so BOTH `analyze.ts` (the metrics it reports on)
// and `yamlParse.ts` (the text it actually parses) truncate on exactly the
// same code-point boundary with no import cycle between them.
//
// Truncation rule (SPEC §4 F1 · ARCH §3.2): cut at MAX_INPUT_BYTES WITHOUT ever
// splitting a UTF-16 surrogate pair (a non-BMP code point is 4 UTF-8 bytes and
// 2 UTF-16 units), and report the ORIGINAL byte count so the cap never hides
// how large the input really was.
// ─────────────────────────────────────────────────────────────────────────────

import { MAX_INPUT_BYTES } from "./constants";

/** Counts whitespace-delimited words; an all-whitespace text has none. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/** UTF-8 byte length — what actually crosses the structured-clone boundary. */
export function countBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** Lines are newline-terminated runs; a trailing newline does not add one. */
export function countLines(text: string): number {
  if (!text) return 0;
  const newlines = text.split("\n").length - 1;
  return text.endsWith("\n") ? newlines : newlines + 1;
}

export interface Truncation {
  /** The analyzed text (=== `text` when nothing was cut). */
  text: string;
  truncated: boolean;
  /** Byte length of the ORIGINAL text, before slicing. */
  originalBytes: number;
}

/**
 * Cuts the input to the byte cap on a code-point boundary (a UTF-16 surrogate
 * pair is never split into a lone surrogate) while reporting the original byte
 * count — the cap never hides how big the input really was.
 */
export function truncateToCap(
  text: string,
  maxBytes: number = MAX_INPUT_BYTES
): Truncation {
  const originalBytes = countBytes(text);
  if (originalBytes <= maxBytes) {
    return { text, truncated: false, originalBytes };
  }

  let low = 0;
  let high = text.length;
  // Largest prefix whose UTF-8 length is <= maxBytes.
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (countBytes(text.slice(0, mid)) <= maxBytes) low = mid;
    else high = mid - 1;
  }

  let end = low;
  // Never leave an orphaned HIGH surrogate at the cut: when the last included
  // code unit is a high surrogate and the next one is its low partner, the
  // slice would end mid-pair, so step back one code unit.
  const lastIncluded = text.charCodeAt(end - 1);
  const following = text.charCodeAt(end);
  if (
    lastIncluded >= 0xd800 &&
    lastIncluded <= 0xdbff &&
    following >= 0xdc00 &&
    following <= 0xdfff
  ) {
    end -= 1;
  }

  return { text: text.slice(0, end), truncated: true, originalBytes };
}

/** Line (1-based) of a source offset — the `# line N` annotation in the UI. */
export function lineOfOffset(source: string, offset: number): number {
  if (offset <= 0) return 1;
  let line = 1;
  for (let i = 0; i < offset && i < source.length; i += 1) {
    if (source.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

/** The four plain measurements of one text body — pure, deterministic, no IO. */
export function measureText(source: string) {
  return {
    characterCount: source.length,
    wordCount: countWords(source),
    byteCount: countBytes(source),
    lineCount: countLines(source),
  };
}
