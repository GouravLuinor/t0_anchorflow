/// <reference lib="webworker" />

import {
  ARTIFACT_CACHE_CAPACITY,
  RESOLVE_BUDGET_MS,
  WORKER_DEADLINE_MS,
} from "../_lib/constants";
import {
  ANALYZE_TIMEOUT_ERROR,
  EMPTY_METRICS,
  analyzeLocal,
  isOverDeadline,
  measureText,
  type ReportBody,
} from "../_lib/analyze";
import { DEFAULT_RATE_LIMIT } from "../_lib/constants";
import { analyzeResolve } from "../_lib/compute";
import {
  acceptDispatch,
  INITIAL_DISPATCH_STATE,
  isStaleDispatch,
  type DispatchState,
} from "../_lib/protocol";
import type {
  FetchLike,
  WorkerInputPayload,
  WorkerOutputPayload,
} from "../_lib/types";

/**
 * Phase-A report bodies are memoized across keystrokes keyed by source text.
 * The capacity caps memory; re-insertion on access keeps hot inputs alive.
 * Oversized inputs are not cached — a 256 KiB report is not a cheap LRU entry.
 */
const CACHEABLE_INPUT_BYTES = 32_768;
const reportCache = new Map<string, ReportBody>();

function getCachedReport(source: string): ReportBody | undefined {
  const hit = reportCache.get(source);
  if (hit !== undefined) {
    // Refresh recency (Map iterates in insertion order).
    reportCache.delete(source);
    reportCache.set(source, hit);
  }
  return hit;
}

function setCachedReport(source: string, body: ReportBody): void {
  if (new TextEncoder().encode(source).length > CACHEABLE_INPUT_BYTES) return;
  reportCache.set(source, body);
  if (reportCache.size > ARTIFACT_CACHE_CAPACITY) {
    const oldest = reportCache.keys().next().value;
    if (oldest !== undefined) reportCache.delete(oldest);
  }
}

// Monotonic dispatch state shared with the phase-rank stale guard.
let dispatch: DispatchState = INITIAL_DISPATCH_STATE;

// ── Phase B: worker-scope single in-flight + the in-session caches ───────────
/**
 * The ONE network boundary in this module. `_lib/refResolver.ts` takes it as a
 * REQUIRED option, so the worker owns the only `fetch` reference in the
 * compute path (AC-12 · AC-16). Every call is an unauthenticated GET of a
 * `api.github.com` URL that carries nothing but `owner/repo` + the ref.
 */
const fetchImpl: FetchLike = (url, init) => fetch(url, init);

/** Never two resolves in flight: one controller owns the whole fan-out. */
let phaseBController: AbortController | null = null;

/**
 * In-session resolve caches, so a keystroke burst never re-spends quota:
 * `resolveCache` is the success LRU (read by the resolver at capacity), and
 * `resolveNegativeCache` holds 404 expiries for the negative TTL.
 */
const resolveCache = new Map<string, string>();
const resolveNegativeCache = new Map<string, number>();

function post(id: number, phase: WorkerInputPayload["phase"], body: ReportBody) {
  self.postMessage({
    ...body,
    id,
    phase,
  } satisfies WorkerOutputPayload);
}

async function handleMessage(
  event: MessageEvent<WorkerInputPayload>
): Promise<void> {
  const message = event.data;

  // Stale-response guard FIRST — a late or replayed message must never touch
  // state, the watchdog or the budget. The phase rank makes a `B` after its
  // `A` acceptable while dropping a duplicate `B` or a late `A`.
  if (isStaleDispatch(message, dispatch)) return;
  dispatch = acceptDispatch(message, dispatch);

  // A newer dispatch (any phase) supersedes the in-flight fan-out, so the
  // hourly budget is never double-spent on a superseded request (ARCH §4.2).
  phaseBController?.abort();

  try {
    if (message.phase === "B") {
      // Phase B is the network phase. It NEVER arms the terminate-watchdog —
      // the network is abortable through the caller's AbortController, and
      // every per-ref outcome settles as a value instead of being killed.
      phaseBController = new AbortController();
      const controller = phaseBController;

      const cached = getCachedReport(message.source);
      const phaseA = cached ?? analyzeLocal(message.source);
      if (!cached) setCachedReport(message.source, phaseA);

      const merged = await analyzeResolve(phaseA, {
        fetchImpl,
        resolve: message.resolve,
        budget: message.budget,
        signal: controller.signal,
        deadlineMs: RESOLVE_BUDGET_MS,
        cache: resolveCache,
        negativeCache: resolveNegativeCache,
      });

      // A superseded fan-out must not post: its envelope would overwrite a
      // newer Phase A already on screen.
      if (controller.signal.aborted) return;
      post(message.id, "B", merged);
      return;
    }

    // Phase A — offline report, zero network, watchdog-protected upstream.
    const cached = getCachedReport(message.source);
    const body = cached ?? analyzeLocal(message.source);
    if (!cached) setCachedReport(message.source, body);

    if (isOverDeadline(body.metrics, WORKER_DEADLINE_MS)) {
      post(message.id, message.phase, {
        ...body,
        ok: false,
        fatalError: ANALYZE_TIMEOUT_ERROR,
      });
      return;
    }

    post(message.id, message.phase, body);
  } catch (err) {
    // Last-resort envelope for unexpected throws; the measurement stays
    // consistent with normal envelopes instead of degrading to zeros. For a
    // Phase B failure the OFFLINE report is what survives (AC-13).
    const offline = analyzeLocal(message.source);
    if (message.phase === "B" && offline.ok) {
      post(message.id, "B", offline);
      return;
    }
    const counts = measureText(message.source);
    self.postMessage({
      id: message.id,
      phase: message.phase,
      ok: false,
      fatalError:
        err instanceof Error ? err.message : "Unexpected error inside worker",
      uses: [],
      resolutions: [],
      rewrittenYaml: null,
      diff: null,
      permissions: null,
      findings: [],
      metrics: {
        ...EMPTY_METRICS,
        ...counts,
      },
      rateLimit: { ...DEFAULT_RATE_LIMIT },
    } satisfies WorkerOutputPayload);
  }
}

self.onmessage = (event) => {
  void handleMessage(event);
};
