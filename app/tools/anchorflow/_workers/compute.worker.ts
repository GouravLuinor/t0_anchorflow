/// <reference lib="webworker" />

import {
  ARTIFACT_CACHE_CAPACITY,
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
import type { WorkerInputPayload, WorkerOutputPayload } from "../_lib/types";

/**
 * Phase-A report bodies are memoized across keystrokes keyed by source text.
 * The capacity caps memory; re-insertion on access keeps hot inputs alive.
 * Oversized inputs are not cached — a 256 KiB echo is not a cheap LRU entry.
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

function post(id: number, phase: WorkerInputPayload["phase"], body: ReportBody) {
  self.postMessage({
    ...body,
    id,
    phase,
  } satisfies WorkerOutputPayload);
}

self.onmessage = (event: MessageEvent<WorkerInputPayload>) => {
  const message = event.data;

  // Stale-response guard FIRST — a late or replayed message must never touch
  // state, the watchdog or the budget. The phase rank makes a `B` after its
  // `A` acceptable while dropping a duplicate `B` or a late `A`.
  if (isStaleDispatch(message, dispatch)) return;
  dispatch = acceptDispatch(message, dispatch);

  try {
    if (message.phase === "B") {
      // Phase B is the network phase. SCAFFOLD: the resolver is not built yet,
      // so `analyzeResolve` performs the merge contract only and posts the
      // same FULL envelope. Phase B NEVER arms the terminate-wdog — the
      // network is abortable through the caller's AbortController.
      const phaseA = analyzeLocal(message.source);
      post(message.id, "B", analyzeResolve(phaseA));
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
        echo: null,
      });
      return;
    }

    post(message.id, message.phase, body);
  } catch (err) {
    // Last-resort envelope for unexpected throws; the measurement stays
    // consistent with normal envelopes instead of degrading to zeros.
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
      echo: null,
    } satisfies WorkerOutputPayload);
  }
};
