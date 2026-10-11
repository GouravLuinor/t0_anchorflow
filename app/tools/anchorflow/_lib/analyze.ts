// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the placeholder compute core (SCAFFOLD).
//
// This module is the single source of semantics for the offline phase: the
// worker AND the main-thread fallback both call `analyzeLocal`, so the two
// paths cannot drift (BAR §4.2). It is pure — no React, no DOM, no IO, no
// `fetch` — which is what makes it unit-testable and reusable at both
// boundaries.
//
// WHAT IT DOES TODAY: a trivial placeholder measurement. It returns the raw
// text plus character / word / byte / line counts, with every domain array
// empty (`uses`, `resolutions`, `findings`) and every derived surface `null`.
//
// WHAT THE DOMAIN AGENT ADDS (the seams, all already typed in `types.ts`):
//   · `uses: ClassifiedUses[]`        — structural `uses:` collection + 6-class
//                                       classification (+ 2 scopes)
//   · `resolutions: Resolution[]`     — ref → commit SHA (behind the required
//                                       `fetchImpl` seam; see compute.ts)
//   · `findings: Finding[]`           — pinning / permissions / injection /
//                                       danger-trigger / moving-ref audits
//   · `rewrittenYaml: string | null`  — offset-surgical pinned output
//   · `diff: UnifiedDiff | null`      — red/green unified diff of that rewrite
//   · `permissions: GrantTable | null`— effective scope grant table
// The envelope SHAPE is final; only the empty arrays/null surfaces fill in.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_RATE_LIMIT, MAX_INPUT_BYTES } from "./constants";
import type { ToolMetrics, WorkerOutputPayload } from "./types";

/** Everything the worker posts except the correlation fields. */
export type ReportBody = Omit<WorkerOutputPayload, "id" | "phase">;

export interface AnalyzeOptions {
  /** Injectable clock for deterministic tests (defaults to performance.now). */
  now?: () => number;
}

export const EMPTY_METRICS: ToolMetrics = {
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
};

/** Friendly copy shared by the worker deadline self-report and the watchdog. */
export const ANALYZE_TIMEOUT_ERROR =
  "Analysis exceeded the time budget — this workflow is too complex to process in time.";

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
  text: string;
  truncated: boolean;
  /** Byte length of the ORIGINAL text, before slicing. */
  originalBytes: number;
}

/**
 * Cuts the input to MAX_INPUT_BYTES on a code-point boundary (a UTF-16
 * surrogate pair is never split into a lone surrogate) while reporting the
 * original byte count — the cap never hides how big the input really was.
 */
export function truncateToCap(text: string): Truncation {
  const originalBytes = countBytes(text);
  if (originalBytes <= MAX_INPUT_BYTES) {
    return { text, truncated: false, originalBytes };
  }

  let low = 0;
  let high = text.length;
  // Largest prefix whose UTF-8 length is <= MAX_INPUT_BYTES.
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (countBytes(text.slice(0, mid)) <= MAX_INPUT_BYTES) low = mid;
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

/** Placeholder measurement of one text body — pure, deterministic, no IO. */
export function measureText(source: string) {
  return {
    characterCount: source.length,
    wordCount: countWords(source),
    byteCount: countBytes(source),
    lineCount: countLines(source),
  };
}

/**
 * Phase A: the offline report. Zero network. Returns the FULL envelope body —
 * every field present, domain arrays empty and derived surfaces null, so the
 * M2 merge contract (`compute.ts → analyzeResolve`) already has a complete
 * Phase-A report to merge into.
 */
export function analyzeLocal(source: string, options: AnalyzeOptions = {}): ReportBody {
  const clock = options.now ?? (() => performance.now());
  const t0 = clock();

  const trimmed = truncateToCap(source);
  const counts = measureText(trimmed.text);
  const parseTimeMs = Math.round((clock() - t0) * 100) / 100;

  const metrics: ToolMetrics = {
    ...EMPTY_METRICS,
    ...counts,
    parseTimeMs,
    truncated: trimmed.truncated,
  };

  return {
    ok: true,
    fatalError: null,
    // Domain arrays ship EMPTY — never `undefined` — so the M2 merge contract
    // below can always take them at face value.
    uses: [],
    resolutions: [],
    rewrittenYaml: null,
    diff: null,
    permissions: null,
    findings: [],
    metrics,
    rateLimit: { ...DEFAULT_RATE_LIMIT },
    // The placeholder diagnostic surface: the analyzed text, echoed back.
    echo: trimmed.text,
  };
}

/** True when a report's own Phase-A time exceeded the given budget. */
export function isOverDeadline(
  metrics: Pick<ToolMetrics, "parseTimeMs">,
  deadlineMs: number
): boolean {
  return metrics.parseTimeMs > deadlineMs;
}
