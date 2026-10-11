// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the offline compute core (Phase A). Pure: no React, no DOM, no
// IO, no `fetch`. The worker AND the main-thread fallback both call
// `analyzeLocal`, so the two paths cannot drift (BAR §4.2).
//
// THE PIPELINE (PLAN §1 — M1 ships it end-to-end with resolution stubbed off):
//
//   truncate (cap, code-point boundary)
//     → yamlParse          structural `uses:` collection + offsets
//     → classifyUses       6 classes × 2 scopes, moving-ref rule
//     → yamlRewrite        offset-surgical re-emit (NO-OP with no resolutions)
//     → unifiedUsesDiff    red/green line diff of that rewrite
//
// `findings` and `permissions` ship EMPTY / null on purpose: the pinning,
// permission, injection and trigger AUDITS are later milestones (M2–M4) and land
// as separate modules that read this same `WorkflowModel`.
//
// Malformed YAML comes back as an ERROR ENVELOPE (`ok:false` + `fatalError`
// copy with the parser's line:column) — never a throw.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_RATE_LIMIT, EMPTY_METRICS, MAX_INPUT_BYTES } from "./constants";
import { classifyUses } from "./classify";
import { unifiedUsesDiff } from "./diff";
import { parseWorkflow } from "./yamlParse";
import { yamlRewrite } from "./rewrite";
import { measureText, truncateToCap } from "./textMetrics";
import type { ToolMetrics, WorkerOutputPayload } from "./types";

/** Everything the worker posts except the correlation fields. */
export type ReportBody = Omit<WorkerOutputPayload, "id" | "phase">;

export interface AnalyzeOptions {
  /** Injectable clock for deterministic tests (defaults to performance.now). */
  now?: () => number;
}

// Lives in `constants.ts` so the store can seed it without pulling the parser
// (and the eemeli `yaml` dependency) into the first-load chunk.
export { EMPTY_METRICS } from "./constants";

/** Friendly copy shared by the worker deadline self-report and the watchdog. */
export const ANALYZE_TIMEOUT_ERROR =
  "Analysis exceeded the time budget — this workflow is too complex to process in time.";

/** Malformed-YAML copy, with the parser's own line:column and reason. */
export function parseErrorCopy(error: {
  message: string;
  line: number | null;
  column: number | null;
}): string {
  const where =
    error.line !== null
      ? `${error.line}${error.column !== null ? `:${error.column}` : ""}`
      : "unknown position";
  return `That doesn't parse as a workflow YAML — ${where}: ${error.message}.`;
}

// Re-exported so the existing measurement surface keeps one import site.
export {
  countBytes,
  countLines,
  countWords,
  measureText,
  truncateToCap,
} from "./textMetrics";
export type { Truncation } from "./textMetrics";

/**
 * Phase A: the offline report. Zero network. Returns the FULL envelope body —
 * every field present, so the M2 merge contract (`compute.ts → analyzeResolve`)
 * already has a complete Phase-A report to merge into.
 */
export function analyzeLocal(
  source: string,
  options: AnalyzeOptions = {}
): ReportBody {
  const clock = options.now ?? (() => performance.now());
  const t0 = clock();

  // 1. Cap the input on a code-point boundary; `originalBytes` is what the
  //    metrics report, so the cap never hides the real input size.
  const truncated = truncateToCap(source, MAX_INPUT_BYTES);
  const counts = measureText(truncated.text);

  // 2. Parse structurally. Malformed YAML degenerates to an error envelope.
  const parsed = parseWorkflow(truncated.text);
  if (!parsed.ok) {
    return {
      ok: false,
      fatalError: parseErrorCopy(parsed.error),
      uses: [],
      resolutions: [],
      rewrittenYaml: null,
      diff: null,
      permissions: null,
      findings: [],
      metrics: {
        ...EMPTY_METRICS,
        ...counts,
        byteCount: truncated.originalBytes,
        truncated: truncated.truncated,
        parseTimeMs: elapsed(clock, t0),
      },
      rateLimit: { ...DEFAULT_RATE_LIMIT },
    };
  }

  // 3. Classify every collected node (6 classes × 2 scopes).
  const uses = classifyUses(parsed.model.uses);

  // 4. The no-resolution rewrite is a byte-identical NO-OP (AC-2); the diff of
  //    it is therefore empty until Phase B supplies resolutions (AC-9).
  const rewrittenYaml = yamlRewrite(truncated.text, []);
  const diff = unifiedUsesDiff(truncated.text, rewrittenYaml);

  const parseTimeMs = elapsed(clock, t0);

  return {
    ok: true,
    fatalError: null,
    uses,
    resolutions: [],
    rewrittenYaml,
    diff,
    // M3 owns the grant table; the model already carries the raw blocks.
    permissions: null,
    // M2/M3/M4 own the audits. D1 leaves the array empty but never absent.
    findings: [],
    metrics: {
      ...EMPTY_METRICS,
      ...counts,
      byteCount: truncated.originalBytes,
      truncated: truncated.truncated,
      usesCount: uses.length,
      usesScanned: parsed.model.usesCap.scanned,
      usesCapHit: parsed.model.usesCap.capped,
      parseTimeMs,
    },
    rateLimit: { ...DEFAULT_RATE_LIMIT },
  };
}

function elapsed(clock: () => number, t0: number): number {
  return Math.round((clock() - t0) * 100) / 100;
}

/** True when a report's own Phase-A time exceeded the given budget. */
export function isOverDeadline(
  metrics: Pick<ToolMetrics, "parseTimeMs">,
  deadlineMs: number
): boolean {
  return metrics.parseTimeMs > deadlineMs;
}
