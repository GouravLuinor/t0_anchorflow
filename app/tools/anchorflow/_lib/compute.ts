// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the pipeline orchestrator (ARCH §3.11).
//
// `analyzeLocal` is Phase A (offline, sync). `analyzeResolve` is Phase B
// (async, the only fetch site once resolution lands) and it MERGES into the
// Phase-A report rather than replacing it. Both are shared by the worker and
// the main-thread fallback, so the two paths cannot drift.
//
// PHASE B: `analyzeResolve` runs the read-only resolver (`_lib/refResolver.ts`)
// over the Phase-A report's `remoteRef` nodes, MERGES the outcome back into
// that report and re-derives the pinned YAML + diff. The resolver takes
// `fetchImpl` as a REQUIRED option (supplied at the worker / fallback
// boundary), so `_lib` never names `fetch` and the hermetic tests replay
// recorded fixtures through an injected fake.
// ─────────────────────────────────────────────────────────────────────────────

import { DEFAULT_RATE_LIMIT, RESOLVE_BUDGET_MS, RESOLVE_NEGATIVE_TTL_MS } from "./constants";
import { unifiedUsesDiff } from "./diff";
import { sortFindings } from "./findings";
import { analyzeLocal, type ReportBody } from "./analyze";
import { resolveRefs } from "./refResolver";
import { yamlRewrite } from "./rewrite";
import type {
  ClassifiedUses,
  Finding,
  FetchLike,
  RateLimitState,
  Resolution,
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
  /**
   * The injected network boundary. Supplied by the worker (or by the
   * main-thread fallback, lazily) — when it is absent, or when `resolve` is
   * false, this is the merge-contract-only no-op that preserves the offline
   * report byte-for-byte.
   */
  fetchImpl?: FetchLike;
  /** Actually spend quota: without this Phase B never leaves the origin. */
  resolve?: boolean;
  /** The session's rate budget, seeded and decremented by the fan-out. */
  budget?: RateLimitState;
  /** Pool width for the resolve fan-out (defaults to MAX_RESOLVE_CONCURRENCY). */
  concurrency?: number;
  /** Success LRU for the session ("owner/repo@ref" → commit sha). */
  cache?: Map<string, string>;
  /** Negative TTL store for the session ("owner/repo@ref" → expiry ms). */
  negativeCache?: Map<string, number>;
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
 *   3. `findings` = sortFindings([...phaseA.findings, ...phaseBFindings]), in
 *      the canonical deterministic order (SPEC §9 AC-10): ascending source
 *      offset (null sorts LAST), then category, then id. This is the D3 seam —
 *      the resolver concats its own `resolution` findings HERE, and the offline
 *      audit findings are never blanked.
 *   4. `ok` = phaseA.ok             — a 404/429/offline never flips ok.
 *   5. `rewrittenYaml` / `diff`     — recomputed from the resolutions (the
 *      D3 seam: `buildRewriteEdits(source, resolutions)` + `unifiedUsesDiff`);
 *      with no resolutions the Phase-A no-op rewrite is carried over, never
 *      blanked.
 *   6. `metrics` = merged (Phase-A parseTimeMs kept, resolveTimeMs added).
 *   7. `rateLimit` = the post-fan-out budget.
 */
export async function analyzeResolve(
  phaseA: ReportBody,
  options: PhaseBOptions = {}
): Promise<ReportBody> {
  // Two clocks, deliberately: the elapsed timings use a monotonic clock (a
  // tab must never report a negative resolveTimeMs), while `resolvedAt` is a
  // WALL-CLOCK ISO string the receipt displays — `performance.now()` is
  // page-relative and would stamp 1970.
  const clock = options.now ?? (() => performance.now());
  const wallClock = options.now ?? (() => Date.now());
  const t0 = clock();

  const offlineFindings = (phaseA.findings ?? []) as Finding[];
  const offlineUses = (phaseA.uses ?? []) as ClassifiedUses[];
  const offlinePermissions = phaseA.permissions ?? null;

  // Phase A's `rewrittenYaml` is a byte-identical NO-OP of the text it
  // analyzsed (AC-2), so it IS the source the classified offsets index into.
  // Using it (rather than a re-truncated copy) keeps every offset exact.
  const source = phaseA.rewrittenYaml;
  const resolvable = offlineUses.filter((uses) =>
    uses.cls === "remoteRef" && Boolean(uses.owner && uses.repo && uses.ref)
  );
  const wantsResolve =
    options.resolve === true &&
    typeof options.fetchImpl === "function" &&
    source !== null &&
    phaseA.ok;

  let resolutions: Resolution[] = [];
  let phaseBFindings: Finding[] = [];
  let budget: RateLimitState =
    options.budget ?? phaseA.rateLimit ?? { ...DEFAULT_RATE_LIMIT };

  if (wantsResolve && options.fetchImpl) {
    const run = await resolveRefs(resolvable, {
      fetchImpl: options.fetchImpl,
      budget,
      concurrency: options.concurrency,
      signal: options.signal,
      deadlineMs: options.deadlineMs ?? RESOLVE_BUDGET_MS,
      cache: options.cache,
      negativeCache: options.negativeCache,
      negativeTtlMs: RESOLVE_NEGATIVE_TTL_MS,
      now: wallClock,
    });
    resolutions = run.resolutions;
    budget = run.budget;
    phaseBFindings = resolutionFindings(resolutions, budget, wallClock());

    // Re-derive the pinned output through the SAME pure modules Phase A used,
    // so an offline-only run and a resolved run can never drift.
    const pinned = yamlRewrite(source ?? "", resolutions);
    const resolvedCount = resolutions.filter(
      (resolution) => resolution.status === "resolved"
    ).length;

    const resolveTimeMs = Math.round((clock() - t0) * 100) / 100;

    return {
      ...phaseA,
      ok: phaseA.ok,
      fatalError: phaseA.fatalError ?? null,
      uses: offlineUses,
      permissions: offlinePermissions,
      findings: sortFindings([...offlineFindings, ...phaseBFindings]),
      resolutions,
      rewrittenYaml: pinned,
      diff: unifiedUsesDiff(source ?? "", pinned),
      metrics: {
        ...phaseA.metrics,
        parseTimeMs: phaseA.metrics?.parseTimeMs ?? 0,
        resolveTimeMs,
        resolvedCount,
      },
      rateLimit: budget,
    };
  }

  // No resolve requested (or nothing resolvable): the Phase-A no-op rewrite is
  // CARRIED OVER, never blanked, and no quota is spent at all.
  const resolveTimeMs = Math.round((clock() - t0) * 100) / 100;

  return {
    ...phaseA,
    ok: phaseA.ok,
    fatalError: phaseA.fatalError ?? null,
    uses: offlineUses,
    permissions: offlinePermissions,
    findings: sortFindings([...offlineFindings, ...phaseBFindings]),
    resolutions: [],
    rewrittenYaml: phaseA.rewrittenYaml ?? null,
    diff: phaseA.diff ?? null,
    metrics: {
      ...phaseA.metrics,
      // Phase-A timings are kept; the resolve pass only adds its own slice.
      parseTimeMs: phaseA.metrics?.parseTimeMs ?? 0,
      resolveTimeMs,
      resolvedCount: 0,
    },
    rateLimit: budget,
  };
}

/** `owner/repo[/subpath]@ref` — the citation the receipt findings quote. */
function citation(uses: ClassifiedUses): string {
  const segments = [uses.owner, uses.repo, uses.subpath].filter(
    (part): part is string => Boolean(part)
  );
  return `${segments.join("/")}@${uses.ref ?? ""}`;
}

/** A short, unambiguous form of a sha. */
function shortSha(sha: string | null | undefined): string {
  return sha ? `${sha.slice(0, 12)}…` : "";
}

/** `1778238` style countdown copy for the rate-limit banner. */
export function resetCountdown(resetAt: number, nowMs: number): string {
  const seconds = Math.max(0, Math.round((resetAt - nowMs) / 1000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes === 0) return `${rest}s`;
  return `${minutes}m ${rest}s`;
}

/**
 * The Phase-B findings — the ONLY category Phase B emits (ARCH §3.11.3):
 * a `resolution` finding per ref with the outcome that actually happened,
 * plus a "not pinned to a SHA" warning for every moving ref the run left
 * unresolved. Every unresolved ref states why and names the endpoint.
 *
 * DETERMINISM: the ONLY clock this module reads is the `nowMs` the caller
 * injects (the same one `refResolver` stamps receipts with). No ambient
 * `Date.now()` / `performance.now()` reaches the copy, so two runs over the
 * same inputs — including a future-dated 429 fixture — produce byte-identical
 * findings (AC-15).
 */
export function resolutionFindings(
  resolutions: readonly Resolution[],
  budget: RateLimitState,
  /**
   * The wall clock the countdown copy renders against — INJECTED, never read
   * from the ambient `Date.now()`, so a report built from the same inputs is
   * byte-identical across runs (the determinism regression test pins this).
   */
  nowMs: number
): Finding[] {
  const out: Finding[] = [];
  const counters = new Map<string, number>();
  const nextId = (uses: ClassifiedUses): string => {
    const site = uses.scope === "job" ? "job" : String(uses.stepIndex ?? 0);
    const base = `resolution:${uses.jobId}:${site}`;
    const seen = (counters.get(base) ?? 0) + 1;
    counters.set(base, seen);
    return `${base}:${seen}`;
  };

  for (const resolution of resolutions) {
    const uses = resolution.ref;
    const label = citation(uses);
    const where = uses.stepIndex !== null ? `steps[${uses.stepIndex}]` : "uses";
    const base = {
      id: nextId(uses),
      where,
      start: uses.start,
      category: "resolution" as const,
    };

    if (resolution.status === "resolved") {
      const chain = resolution.receipt?.chain?.length ?? 0;
      const hops = chain > 1 ? `${chain} hops` : "1 hop";
      out.push({
        ...base,
        severity: "info",
        title: `Pinned to a commit SHA — ${label}`,
        detail:
          `Resolved through ${hops} of the read-only GitHub API, ` +
          `${
            resolution.tagObjectSha
              ? `annotated tag object ${shortSha(resolution.tagObjectSha)} dereferenced to commit ${shortSha(resolution.commitSha)}`
              : `commit ${shortSha(resolution.commitSha)}`
          }. ` +
          "A SHA is a point-in-time snapshot: the tag it replaced can still move, so re-resolve before a release to catch drift.",
        evidence: [
          ...(resolution.receipt?.chain ?? []).map(
            (hop) => `${hop.endpoint} → ${hop.sha ? shortSha(hop.sha) : "(no object)"}`
          ),
          `ls-remote cross-check: git ls-remote https://github.com/${
            uses.owner
          }/${uses.repo} ${resolution.receipt?.lsRemote ?? ""}`,
        ].join("\n"),
        remediation:
          "Keep the pinned SHA and re-resolve before a release to catch tag drift.",
        receipt: resolution.receipt ?? undefined,
      });
      continue;
    }

    if (resolution.status === "unknown-ref") {
      out.push({
        ...base,
        severity: "warn",
        title: `Unknown ref — ${label}`,
        detail:
          (resolution.receipt?.note ? `${resolution.receipt.note}: ` : "") +
          `the tag and the branch lookup both 404'd, so the original value was kept and nothing was rewritten. Verify the tag exists (and that the repository is public).`,
        evidence: (resolution.endpointsUsed ?? []).join("\n") || label,
        remediation:
          "Fix or remove the ref, then press Resolve & pin again. The offline report above is still complete.",
      });
    } else if (resolution.status === "unsafe-ref") {
      // Refused before any request was sent — the resolver's path-safety gate.
      out.push({
        ...base,
        severity: "warn",
        title: `Not resolved — ${label}`,
        detail:
          `This reference was refused before any request was sent: ${
            resolution.receipt?.note ?? "the owner, repository or ref is not a safe GitHub reference"
          }. ` +
          "Nothing was rewritten and the offline report above is still complete.",
        evidence: label,
        remediation:
          "Use a plain owner/repo (letters, digits, dot, dash or underscore) and an ordinary tag or branch name, then press Resolve & pin again.",
      });
    } else if (resolution.status === "rate-limited") {
      out.push({
        ...base,
        severity: "warn",
        title: `Not resolved — ${label}`,
        detail:
          `The GitHub API limit stopped this ref (${resolution.receipt?.note ?? "the reserve floor"}). ` +
          `${budget.remaining} of ${budget.limit} requests remain this hour. ` +
          `${
            budget.resetAt > 0
              ? `The window resets in ${resetCountdown(budget.resetAt, nowMs)}. `
              : ""
          }The offline report above is still complete.`,
        evidence: (resolution.endpointsUsed ?? []).join("\n") || label,
        remediation:
          "Wait for the hourly window to reset (or run against a token outside this tool), then press Resolve & pin again.",
      });
    } else if (resolution.status === "network-error") {
      out.push({
        ...base,
        severity: "warn",
        title: `Not resolved — ${label}`,
        detail:
          `api.github.com could not be read for this ref (${resolution.receipt?.note ?? "network error"}). Nothing was rewritten and the offline report above is still complete.`,
        evidence: (resolution.endpointsUsed ?? []).join("\n") || label,
        remediation:
          "Check the connection and press Resolve & pin again — the offline report is unaffected.",
      });
    } else {
      out.push({
        ...base,
        severity: "warn",
        title: `Not resolved — ${label}`,
        detail:
          "This ref was not resolved in this run, so it is still not pinned to a SHA.",
        evidence: (resolution.endpointsUsed ?? []).join("\n") || label,
        remediation: "Press Resolve & pin again to attempt the ref.",
      });
    }

    // The drift finding the moving rule demands (SPEC §4 F2): a floating ref
    // that the run could NOT pin is still a moving target in the output.
    if (uses.moving) {
      const movingId = nextId(uses);
      out.push({
        id: movingId,
        category: "resolution",
        severity: "warn",
        title: `Moving ref — not pinned to a SHA — ${label}`,
        detail: `\`@${uses.ref ?? ""}\` is a floating target (a branch alias or a floating major), so the commit it points at can change at any time. It is still un-pinned in the rewritten YAML.`,
        remediation:
          "Pin to a commit SHA — resolve the ref, or pin it by hand to a 40-hex commit.",
        where,
        start: uses.start,
      });
    }
  }

  return out;
}

/** Builds the envelope body the worker/hook post back for a dispatch. */
export function toOutputPayload(
  body: ReportBody,
  input: Pick<WorkerInputPayload, "id" | "phase">
): WorkerOutputPayload {
  return { ...body, id: input.id, phase: input.phase };
}
