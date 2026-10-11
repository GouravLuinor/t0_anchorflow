// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the offline compute core (Phase A). Pure: no React, no DOM, no
// IO, no `fetch`. The worker AND the main-thread fallback both call
// `analyzeLocal`, so the two paths cannot drift (BAR §4.2).
//
// THE PIPELINE (PLAN §1):
//
//   truncate (cap, code-point boundary)
//     → yamlParse          structural `uses:` collection + offsets
//     → classifyUses       6 classes × 2 scopes, moving-ref rule
//     → yamlRewrite        offset-surgical re-emit (NO-OP with no resolutions)
//     → unifiedUsesDiff    red/green line diff of that rewrite
//     → the AUDITS         permission · template-injection · dangerous-trigger
//                          · persist-credentials → ONE canonical findings array
//
// The four audits are pure functions of the SAME `WorkflowModel` the classifier
// reads, so an offline paste is fully audited with zero network. Their output is
// concatenated and sorted into the canonical deterministic order (AC-10):
// source offset, then category, then id — with a null offset sorting LAST.
//
// Malformed YAML comes back as an ERROR ENVELOPE (`ok:false` + `fatalError`
// copy with the parser's line:column) — never a throw.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_RATE_LIMIT, EMPTY_METRICS, MAX_INPUT_BYTES } from "./constants";
import { classifyUses } from "./classify";
import { unifiedUsesDiff } from "./diff";
import { buildGrantTable } from "./grantTable";
import { injectionFindings } from "./injectionDetect";
import { permissionAudit } from "./permissionAudit";
import { sortFindings } from "./findings";
import { dangerousTriggerAudit, persistCredentialsAudit } from "./triggerAudit";
import { parseWorkflow } from "./yamlParse";
import { yamlRewrite } from "./rewrite";
import { measureText, truncateToCap } from "./textMetrics";
import type { ToolMetrics, WorkerOutputPayload } from "./types";

/** Everything the worker posts except the correlation fields. */
export type ReportBody = Omit<WorkerOutputPayload, "id" | "phase">;

export interface AnalyzeOptions {
  /** Injectable clock for deterministic tests (defaults to performance.now). */
  now?: () => number;
  /**
   * Byte length of the text BEFORE the caller's dispatch cap sliced it.
   *
   * Supplied by the WORKER path, whose payload crosses a structured-clone
   * boundary and is therefore capped at `MAX_INPUT_BYTES` (the hook posts the
   * capped text plus this count). Absent on the MAIN-THREAD FALLBACK, which
   * hands over the full source — nothing crosses a boundary there, and
   * `truncateToCap` derives the same numbers itself.
   *
   * Either way the report is identical: `metrics.byteCount` is the TRUE
   * original size and `metrics.truncated` is its verdict (SPEC §9 AC-13), so
   * the two engines can never disagree on an oversize paste.
   */
  originalByteCount?: number;
}

// `EMPTY_METRICS` and `ANALYZE_TIMEOUT_ERROR` live in `constants.ts` (types +
// plain values only) so the store and the main-thread watchdog hook can read
// them WITHOUT pulling the parser — and the eemeli `yaml` dependency — into
// the first-load chunk. They stay re-exported here so the pure core keeps one
// measurement surface for its consumers.
export { EMPTY_METRICS, ANALYZE_TIMEOUT_ERROR } from "./constants";

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
  truncateForDispatch,
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

  // 1. Cap the input on a code-point boundary. The analyzer can arrive with an
  //    ALREADY-capped text: the worker dispatch is sliced at MAX_INPUT_BYTES to
  //    bound the structured-clone payload, and it reports the true original
  //    size in `originalByteCount`. The main-thread fallback sends the full
  //    source, so `truncateToCap` answers "uncut" and supplies the size itself.
  //    Both routes therefore land on the SAME byteCount + truncated flag —
  //    which is the whole point: a cap must never hide how big the input was.
  const capped = truncateToCap(source, MAX_INPUT_BYTES);
  const originalByteCount = options.originalByteCount ?? capped.originalBytes;
  // The flag describes the ORIGINAL text, not the slice: the sliced text is at
  // most the cap by construction, so it can never answer this one.
  const truncated = capped.truncated || originalByteCount > MAX_INPUT_BYTES;
  const counts = measureText(capped.text);

  // 2. Parse structurally. Malformed YAML degenerates to an error envelope.
  const parsed = parseWorkflow(capped.text);
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
        byteCount: originalByteCount,
        truncated,
        parseTimeMs: elapsed(clock, t0),
      },
      rateLimit: { ...DEFAULT_RATE_LIMIT },
    };
  }

  // 3. Classify every collected node (6 classes × 2 scopes).
  const uses = classifyUses(parsed.model.uses);

  // 4. The no-resolution rewrite is a byte-identical NO-OP (AC-2); the diff of
  //    it is therefore empty until Phase B supplies resolutions (AC-9).
  const rewrittenYaml = yamlRewrite(capped.text, []);
  const diff = unifiedUsesDiff(capped.text, rewrittenYaml);

  const parseTimeMs = elapsed(clock, t0);

  // 5. The four offline audits, over the same structural model. D3 (the
  //    resolver) concats its `resolution` findings at the merge point in
  //    `compute.ts`; nothing here needs the network.
  const permissions = buildGrantTable(parsed.model);
  const findings = sortFindings([
    ...permissionAudit(parsed.model),
    ...injectionFindings(parsed.model),
    ...dangerousTriggerAudit(parsed.model),
    ...persistCredentialsAudit(parsed.model),
  ]);

  return {
    ok: true,
    fatalError: null,
    uses,
    resolutions: [],
    rewrittenYaml,
    diff,
    permissions,
    findings,
    metrics: {
      ...EMPTY_METRICS,
      ...counts,
      byteCount: originalByteCount,
      truncated,
      usesCount: uses.length,
      usesSeen: parsed.model.usesCap.seen,
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
