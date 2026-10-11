/// <reference lib="webworker" />

import {
  ARTIFACT_CACHE_CAPACITY,
  MAX_INPUT_BYTES,
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
 * Phase-A report bodies are memoized across keystrokes keyed by the dispatch's
 * source text AND its `originalByteCount`. The capacity caps memory;
 * re-insertion on access keeps hot inputs alive. Oversized inputs are not
 * cached — a 256 KiB report is not a cheap LRU entry, and the gate reads the
 * ORIGINAL size because the sliced text always looks small.
 *
 * The key carries the original byte count for correctness, not tidiness: two
 * different oversize pastes can be sliced to the SAME 256 KiB prefix, and a
 * text-only key would serve the first paste's `metrics.byteCount` for the
 * second one — exactly the drift this payload's `originalByteCount` exists to
 * prevent, reintroduced through the cache.
 */
const CACHEABLE_INPUT_BYTES = 32_768;
const reportCache = new Map<string, ReportBody>();

function cacheKeyOf(message: Pick<WorkerInputPayload, "source" | "originalByteCount">): string {
  return `${message.originalByteCount}\n${message.source}`;
}

function getCachedReport(key: string): ReportBody | undefined {
  const hit = reportCache.get(key);
  if (hit !== undefined) {
    // Refresh recency (Map iterates in insertion order).
    reportCache.delete(key);
    reportCache.set(key, hit);
  }
  return hit;
}

function setCachedReport(
  key: string,
  body: ReportBody,
  originalByteCount: number
): void {
  if (originalByteCount > CACHEABLE_INPUT_BYTES) return;
  reportCache.set(key, body);
  if (reportCache.size > ARTIFACT_CACHE_CAPACITY) {
    const oldest = reportCache.keys().next().value;
    if (oldest !== undefined) reportCache.delete(oldest);
  }
}

/**
 * Phase A over one dispatch: `analyzeLocal` receives the true original byte
 * count alongside the capped text, so the reported `metrics.byteCount` /
 * `metrics.truncated` describe the input the user pasted rather than the slice.
 * Both engines (worker + main-thread fallback) call through here, so they can
 * never report different numbers for the same paste (AC-13).
 */
function analyzeDispatch(
  message: Pick<WorkerInputPayload, "source" | "originalByteCount">
): ReportBody {
  const cached = getCachedReport(cacheKeyOf(message));
  if (cached) return cached;
  const body = analyzeLocal(message.source, {
    originalByteCount: message.originalByteCount,
  });
  setCachedReport(cacheKeyOf(message), body, message.originalByteCount);
  return body;
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

      const phaseA = analyzeDispatch(message);

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
    const body = analyzeDispatch(message);

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
    const offline = analyzeLocal(message.source, {
      originalByteCount: message.originalByteCount,
    });
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
        // Even a last-resort envelope never under-reports the input size.
        byteCount: message.originalByteCount,
        truncated: message.originalByteCount > MAX_INPUT_BYTES,
      },
      rateLimit: { ...DEFAULT_RATE_LIMIT },
    } satisfies WorkerOutputPayload);
  }
}

self.onmessage = (event) => {
  void handleMessage(event);
};
