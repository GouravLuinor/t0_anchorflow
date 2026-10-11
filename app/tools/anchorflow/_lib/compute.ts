// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the pipeline orchestrator (ARCH §3.11).
//
// `analyzeLocal` is Phase A (offline, sync). `analyzeResolve` is Phase B
// (async, the only fetch site once resolution lands) and it MERGES into the
// Phase-A report rather than replacing it. Both are shared by the worker and
// the main-thread fallback, so the two paths cannot drift.
//
// SCAFFOLD NOTE: Phase B currently performs the merge contract only — the
// resolver (`_lib/refResolver.ts`, M2) is the missing piece and it will take
// `fetchImpl` as a REQUIRED option so `_lib` never names `fetch`. Until then a
// Phase-B dispatch is a no-op that provably preserves the offline report.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_RATE_LIMIT } from "./constants";
import { analyzeLocal, type ReportBody } from "./analyze";
import type {
  ClassifiedUses,
  Finding,
  FetchLike,
  ToolMetrics,
  WorkerInputPayload,
  WorkerOutputPayload,
} from "./types";

export { analyzeLocal, EMPTY_METRICS } from "./analyze";
export type { ReportBody } from "./analyze";

/** Phase A — offline report. Zero network, zero DOM. */
export function runPhaseA(source: string): ReportBody {
  return analyzeLocal(source);
}

export interface PhaseBOptions {
  /** M2 seam: the injected network boundary. Required once resolution exists. */
  fetchImpl?: FetchLike;
  /** The worker's single in-flight Phase-B controller. */
  signal?: AbortSignal;
  /** Injectable clock (determinism in tests). */
  now?: () => number;
  /** Total wall-clock budget for the fan-out. */
  deadlineMs?: number;
}

/**
 * Phase B → the FULL envelope (the C1 merge invariant a builder must not
 * break): takes the Phase-A report as its first merge input and returns a
 * merged full envelope, never a partial `Pick`.
 *
 * Merge contract (implemented here, extended — never replaced — by M2):
 *   1. `uses` = phaseA.uses         — Phase B never reclassifies.
 *   2. `permissions` = phaseA.permissions — never re-derived, never undefined.
 *   3. `findings` = [...phaseA.findings, ...phaseBFindings], sorted into the
 *      canonical order (SPEC §9 AC-10). Reads are defensive: an undefined
 *      incoming array must never blank the offline report.
 *   4. `ok` = phaseA.ok             — a 404/429/offline never flips ok.
 *   5. `rewrittenYaml` / `diff`     — recomputed from the resolutions.
 *   6. `metrics` = merged (Phase-A parseTimeMs kept, resolveTimeMs added).
 *   7. `rateLimit` = the post-fan-out budget.
 */
export function analyzeResolve(
  phaseA: ReportBody,
  options: PhaseBOptions = {}
): ReportBody {
  const clock = options.now ?? (() => performance.now());
  const t0 = clock();

  const offlineFindings = phaseA.findings ?? [];
  const offlineUses = (phaseA.uses ?? []) as ClassifiedUses[];
  const offlinePermissions = phaseA.permissions ?? null;

  // SCAFFOLD: no resolver yet, so there are no Phase-B findings and nothing to
  // rewrite. The resolvable set is what M2 fills in; it is empty today, which
  // is why `autoResolve` (off by default) can never spend the visitor's quota.
  const phaseBFindings: Finding[] = [];

  const resolveTimeMs = Math.round((clock() - t0) * 100) / 100;
  const metrics: ToolMetrics = {
    ...phaseA.metrics,
    // Phase-A timings are kept; the resolve pass only adds its own slice.
    parseTimeMs: phaseA.metrics?.parseTimeMs ?? 0,
    resolveTimeMs,
    resolvedCount: 0,
  };

  return {
    ...phaseA,
    ok: phaseA.ok,
    fatalError: phaseA.fatalError ?? null,
    uses: offlineUses,
    permissions: offlinePermissions,
    findings: [...offlineFindings, ...phaseBFindings],
    resolutions: [],
    rewrittenYaml: null,
    diff: null,
    metrics,
    rateLimit: phaseA.rateLimit ?? { ...DEFAULT_RATE_LIMIT },
    echo: phaseA.echo ?? null,
  };
}

/** Builds the envelope body the worker/hook post back for a dispatch. */
export function toOutputPayload(
  body: ReportBody,
  input: Pick<WorkerInputPayload, "id" | "phase">
): WorkerOutputPayload {
  return { ...body, id: input.id, phase: input.phase };
}
