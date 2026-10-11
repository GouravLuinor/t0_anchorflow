"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ANALYZE_TIMEOUT_ERROR,
  DEBOUNCE_INSTANT_MS,
  DEBOUNCE_LARGE_MS,
  DEBOUNCE_MEDIUM_MS,
  RATE_LIMIT_RESERVE,
  RESOLVE_BUDGET_MS,
  RESOLVE_DEBOUNCE_MS,
  SUCCESS_ANNOUNCE_DEBOUNCE_MS,
  WATCHDOG_MS,
} from "../_lib/constants";
import {
  acceptDispatch,
  INITIAL_DISPATCH_STATE,
  isStaleDispatch,
  type DispatchState,
} from "../_lib/protocol";
import { truncateForDispatch } from "../_lib/textMetrics";
import { useToolStore } from "../_store/useToolStore";
import type {
  FetchLike,
  RateLimitState,
  Resolution,
  WorkerInputPayload,
  WorkerOutputPayload,
} from "../_lib/types";

/**
 * Owns the Web Worker lifecycle and the debounced, phase-aware dispatch of
 * workflow analysis. The contract (BAR §4.3 · ARCH §4):
 *
 *   · monotonic request ids with a stale-response guard (phase-ranked, so a
 *     `B` after its `A` is accepted while a duplicate `B` or late `A` drops);
 *   · adaptive debounce tiers by input length: ≤5k → 0ms · >5k → 40ms ·
 *     >20k → 120ms;
 *   · a 1.5s watchdog that terminates + respawns the worker and settles a
 *     friendly error (native compute cannot be interrupted);
 *   · a single `degradeToMainThread` that runs the SAME pure core on the main
 *     thread at the stricter sync deadline — no fake variant. `_lib/analyze` is
 *     imported lazily on that path alone, so the eemeli `yaml` parser the core
 *     needs never lands in First Load JS (only the worker chunk and the
 *     on-demand fallback chunk carry it);
 *   · Phase B (network resolve) is watchdog-free and abortable, and is only
 *     ever dispatched when the caller asks for it (`autoResolve`, off by
 *     default), so the default path makes zero external requests.
 */

/** Neutral in-flight crash copy — never let the watchdog verdict fabricate one. */
const WORKER_CRASH_ERROR = "Worker crashed — switched to main-thread mode";

function debounceFor(length: number): number {
  if (length > 20_000) return DEBOUNCE_LARGE_MS;
  if (length > 5_000) return DEBOUNCE_MEDIUM_MS;
  return DEBOUNCE_INSTANT_MS;
}

export function useToolWorker() {
  const source = useToolStore((s) => s.source);
  const autoResolve = useToolStore((s) => s.autoResolve);
  const resolveRequestedAt = useToolStore((s) => s.resolveRequestedAt);

  const applyResult = useToolStore((s) => s.applyResult);
  const setIsProcessing = useToolStore((s) => s.setIsProcessing);
  const setErrorMessage = useToolStore((s) => s.setErrorMessage);
  const setWorkerAvailable = useToolStore((s) => s.setWorkerAvailable);
  const setRateLimit = useToolStore((s) => s.setRateLimit);
  const setResolveStatus = useToolStore((s) => s.setResolveStatus);
  const announceStatus = useToolStore((s) => s.announceStatus);

  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(INITIAL_DISPATCH_STATE.requestId);
  const dispatchRef = useRef<DispatchState>(INITIAL_DISPATCH_STATE);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resolveDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Dispatch id protected by the armed watchdog; -1 while disarmed. */
  const watchdogIdRef = useRef(-1);
  const successAnnounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  /** Worker-scope controller: never two resolves in flight (ARCH §4 point 2). */
  const resolveControllerRef = useRef<AbortController | null>(null);
  /**
   * Bumped by `degradeToMainThread`. The Phase-A effect depends on it, so a
   * worker that dies before it ever replies re-dispatches the CURRENT source on
   * the main thread instead of leaving the instrument un-computed — the
   * fallback has to actually run for the "same core, same answer" promise to
   * be true rather than a claim in a comment.
   */
  const [mainThreadRetry, setMainThreadRetry] = useState(0);

  // Mirrors store inputs so timers/watchdog read fresh values without
  // subscribing to volatile state (keeps effect deps stable).
  const inputRef = useRef({ source, autoResolve });
  inputRef.current = { source, autoResolve };

  const degradedRef = useRef(false);

  // Rehydrate persisted user content after mount (skipHydration in store).
  // The resulting state change re-triggers the dispatch effect below.
  useEffect(() => {
    void useToolStore.persist.rehydrate();
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
    watchdogIdRef.current = -1;
  }, []);

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = null;
  }, []);

  const clearResolveDebounce = useCallback(() => {
    if (resolveDebounceTimerRef.current)
      clearTimeout(resolveDebounceTimerRef.current);
    resolveDebounceTimerRef.current = null;
  }, []);

  const clearSuccessAnnouncement = useCallback(() => {
    if (successAnnounceTimerRef.current)
      clearTimeout(successAnnounceTimerRef.current);
    successAnnounceTimerRef.current = null;
  }, []);

  /**
   * Single degradation path: kills timers and the dead worker, flips every
   * pipeline flag and announces once — no orphan workers, no spinning state.
   */
  const degradeToMainThread = useCallback(
    (notice: string, inFlightError?: string) => {
      degradedRef.current = true;
      clearDebounce();
      clearResolveDebounce();
      clearWatchdog();
      clearSuccessAnnouncement();
      resolveControllerRef.current?.abort();
      resolveControllerRef.current = null;
      workerRef.current?.terminate();
      workerRef.current = null;
      setWorkerAvailable(false);
      setIsProcessing(false);
      setResolveStatus("idle");
      if (inFlightError) setErrorMessage(inFlightError);
      announceStatus(notice);
      // Re-arm Phase A on the main thread for whatever is currently in the
      // editor (the seed included), so a stillborn worker never means a blank
      // instrument. The id stays monotonic across the re-dispatch.
      setMainThreadRetry((n) => n + 1);
    },
    [
      clearDebounce,
      clearResolveDebounce,
      clearWatchdog,
      clearSuccessAnnouncement,
      setWorkerAvailable,
      setIsProcessing,
      setResolveStatus,
      setErrorMessage,
      announceStatus,
    ]
  );

  const handleResult = useCallback(
    (result: WorkerOutputPayload) => {
      if (result.fatalError) {
        // Rejections settle immediately and must not be followed by a
        // trailing success ping from an earlier keystroke.
        clearSuccessAnnouncement();
        applyResult({ ...result, error: result.fatalError });
        return;
      }
      applyResult(result, { announce: false });
      // Successes trail so a burst of keystrokes collapses into one
      // screen-reader update.
      clearSuccessAnnouncement();
      successAnnounceTimerRef.current = setTimeout(() => {
        successAnnounceTimerRef.current = null;
        const { metrics } = result;
        announceStatus(
          `Analysis complete — ${metrics.characterCount} characters, ${metrics.wordCount} words, ${metrics.byteCount} bytes`
        );
      }, SUCCESS_ANNOUNCE_DEBOUNCE_MS);
    },
    [applyResult, announceStatus, clearSuccessAnnouncement]
  );

  const onWorkerMessage = useCallback(
    (event: MessageEvent<WorkerOutputPayload>) => {
      const payload = event.data;
      // Stale-response guard FIRST: a late reply must never touch state or
      // the watchdog protecting a newer dispatch.
      if (isStaleDispatch(payload, dispatchRef.current)) return;
      if (payload.id === watchdogIdRef.current) clearWatchdog();
      if (payload.phase === "A") {
        dispatchRef.current = acceptDispatch(
          { id: payload.id, phase: "A" },
          dispatchRef.current
        );
      }

      setIsProcessing(false);
      if (payload.phase === "B") {
        // The budget verdict drives the banner's tone: `limited` when the
        // hourly floor was reached, `offline` on a network failure.
        setResolveStatus(
          resolveStatusFor(payload.rateLimit, payload.resolutions ?? [])
        );
        setRateLimit(payload.rateLimit);
      }
      handleResult(payload);
    },
    [clearWatchdog, handleResult, setIsProcessing, setResolveStatus, setRateLimit]
  );

  const onWorkerError = useCallback(() => {
    // Worker died at runtime — settle everything instead of letting an armed
    // watchdog later fabricate a verdict over the corpse.
    const hadInFlight = watchdogIdRef.current !== -1;
    degradeToMainThread(
      "Worker unavailable — computing on main thread",
      hadInFlight ? WORKER_CRASH_ERROR : undefined
    );
  }, [degradeToMainThread]);

  const onWorkerMessageError = useCallback(() => {
    // Structured-clone failures surface here; mirror onerror settling.
    const hadInFlight = watchdogIdRef.current !== -1;
    degradeToMainThread(
      "Worker unavailable — computing on main thread",
      hadInFlight ? WORKER_CRASH_ERROR : undefined
    );
  }, [degradeToMainThread]);

  /** Sole worker factory — initial mount and watchdog respawn both route here. */
  const spawnWorker = useCallback((): Worker | null => {
    try {
      const worker = new Worker(
        new URL("../_workers/compute.worker.ts", import.meta.url)
      );
      worker.onmessage = onWorkerMessage;
      worker.onerror = onWorkerError;
      worker.onmessageerror = onWorkerMessageError;
      return worker;
    } catch (err) {
      console.warn("Worker initialization failed:", err);
      degradeToMainThread("Worker unavailable — computing on main thread");
      return null;
    }
  }, [onWorkerMessage, onWorkerError, onWorkerMessageError, degradeToMainThread]);

  useEffect(() => {
    const worker = spawnWorker();
    workerRef.current = worker;
    if (worker) setWorkerAvailable(true);

    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      clearDebounce();
      clearResolveDebounce();
      clearWatchdog();
      clearSuccessAnnouncement();
      resolveControllerRef.current?.abort();
      resolveControllerRef.current = null;
    };
  }, [
    spawnWorker,
    setWorkerAvailable,
    clearDebounce,
    clearResolveDebounce,
    clearWatchdog,
    clearSuccessAnnouncement,
  ]);

  // Dispatch Phase A whenever the analyzed text changes.
  useEffect(() => {
    setIsProcessing(true);

    clearDebounce();
    clearWatchdog();

    debounceTimerRef.current = setTimeout(() => {
      const id = ++requestIdRef.current;
      dispatchRef.current = { requestId: id, lastPhaseRank: 0 };
      const worker = workerRef.current;

      if (!degradedRef.current && worker) {
        // The dispatch payload is CAPPED at MAX_INPUT_BYTES so nothing larger
        // ever crosses the structured-clone boundary — but the cap must not
        // erase the input's true size, so `truncateForDispatch` returns the
        // original byte count and the truncated verdict alongside the text and
        // both ride the payload. Without them the worker would analyze a
        // 262,144-byte slice and report THAT as the input size, disagreeing
        // with the main-thread fallback below (AC-13).
        const dispatch = truncateForDispatch(inputRef.current.source);

        // Watchdog: a native parse cannot be interrupted mid-run, so the worst
        // case is terminate + respawn with a friendly verdict.
        watchdogIdRef.current = id;
        watchdogRef.current = setTimeout(() => {
          worker.terminate();
          if (workerRef.current === worker) workerRef.current = null;
          clearWatchdog();

          // Bump the request id so any zombie response is stale by
          // definition, then replace the worker unless already degraded.
          requestIdRef.current++;
          dispatchRef.current = {
            requestId: requestIdRef.current,
            lastPhaseRank: 0,
          };
          if (!degradedRef.current) {
            workerRef.current = spawnWorker();
            if (workerRef.current) setWorkerAvailable(true);
          }

          setIsProcessing(false);
          setErrorMessage(ANALYZE_TIMEOUT_ERROR);
          announceStatus("Execution aborted — input was too complex to analyze");
        }, WATCHDOG_MS);

        worker.postMessage({
          id,
          phase: "A",
          source: dispatch.text,
          originalByteCount: dispatch.originalBytes,
          resolve: false,
          budget: useToolStore.getState().rateLimit,
        } satisfies WorkerInputPayload);
        return;
      }

      // Main-thread fallback path — identical semantics via the same pure
      // core, under the stricter sync deadline that protects UI frames. The
      // core is loaded on demand so the parser stays out of First Load JS.
      //
      // It hands over the FULL source (nothing crosses a structured-clone
      // boundary here, so there is no payload to bound) and `analyzeLocal`
      // caps it itself. `metrics.byteCount` / `metrics.truncated` therefore
      // come out identical to the worker path above — the same core, the same
      // cap, the same true original size.
      void (async () => {
        try {
          const { analyzeLocal } = await import("../_lib/analyze");
          const body = analyzeLocal(inputRef.current.source);
          if (id !== requestIdRef.current) return;
          const result: WorkerOutputPayload = {
            ...body,
            id,
            phase: "A",
            fatalError: body.ok ? null : body.fatalError,
          };
          setIsProcessing(false);
          handleResult(result);
        } catch (err) {
          clearSuccessAnnouncement();
          setIsProcessing(false);
          setErrorMessage(
            err instanceof Error ? err.message : "Unexpected processing error"
          );
          announceStatus("Processing failed");
        }
      })();
    }, debounceFor(source.length));

    return () => {
      clearDebounce();
      clearWatchdog();
    };
  }, [
    source,
    mainThreadRetry,
    handleResult,
    spawnWorker,
    setIsProcessing,
    setErrorMessage,
    setWorkerAvailable,
    announceStatus,
    clearDebounce,
    clearWatchdog,
    clearSuccessAnnouncement,
  ]);

  // ── Phase B — the network resolve phase ───────────────────────────────────
  // Deliberately decoupled from typing: it is armed on an explicit
  // "Resolve & pin" press, or by the autoResolve opt-in (OFF by default), and
  // then debounced after the last edit — never per keystroke. It NEVER arms
  // the terminate-watchdog (ARCH §4 point 2: the watchdog is armed on a Phase-A
  // dispatch, cleared when Phase A posts, and never armed here); the in-flight
  // fan-out is aborted through the worker-scope AbortController instead.
  useEffect(() => {
    clearResolveDebounce();
    if (!autoResolve && resolveRequestedAt === 0) {
      setResolveStatus("idle");
      return;
    }

    resolveDebounceTimerRef.current = setTimeout(() => {
      const worker = workerRef.current;
      const id = ++requestIdRef.current;
      dispatchRef.current = { requestId: id, lastPhaseRank: 1 };
      // Same capped payload and the same carried original byte count as Phase
      // A, so a resolve never re-measures the workflow a different way.
      const dispatch = truncateForDispatch(inputRef.current.source);

      // Never two resolves in flight: abort the previous fan-out first, so
      // the hourly budget is never spent twice on a superseded request.
      resolveControllerRef.current?.abort();
      const controller = new AbortController();
      resolveControllerRef.current = controller;
      setResolveStatus("running");

      if (!degradedRef.current && worker) {
        worker.postMessage({
          id,
          phase: "B",
          source: dispatch.text,
          originalByteCount: dispatch.originalBytes,
          resolve: true,
          budget: useToolStore.getState().rateLimit,
        } satisfies WorkerInputPayload);
        return;
      }

      // Degraded fallback: the SAME Phase-B merge on the main thread, with
      // the network seam supplied HERE instead of inside the worker. As in
      // Phase A it receives the full source — the same true byte count the
      // worker payload carries, derived rather than transmitted.
      void (async () => {
        const [{ analyzeLocal }, { analyzeResolve }] = await Promise.all([
          import("../_lib/analyze"),
          import("../_lib/compute"),
        ]);
        const fetchImpl: FetchLike = (url, init) => fetch(url, init);
        const merged = await analyzeResolve(
          analyzeLocal(inputRef.current.source),
          {
            fetchImpl,
            resolve: true,
            budget: useToolStore.getState().rateLimit,
            signal: controller.signal,
            deadlineMs: RESOLVE_BUDGET_MS,
          }
        );
        if (controller.signal.aborted) return;
        setResolveStatus(resolveStatusFor(merged.rateLimit, merged.resolutions));
        setRateLimit(merged.rateLimit);
        handleResult({ ...merged, id, phase: "B" });
      })();
    }, RESOLVE_DEBOUNCE_MS);

    return () => {
      clearResolveDebounce();
    };
  }, [
    source,
    autoResolve,
    resolveRequestedAt,
    clearResolveDebounce,
    handleResult,
    setResolveStatus,
    setRateLimit,
  ]);
}

/** Phase B settled: `limited` when the hourly floor was hit, else `idle`. */
function resolveStatusFor(
  budget: RateLimitState,
  resolutions: readonly Resolution[]
): "idle" | "limited" | "offline" {
  if (budget.remaining <= RATE_LIMIT_RESERVE) return "limited";
  if (resolutions.some((resolution) => resolution.status === "network-error")) {
    return "offline";
  }
  return "idle";
}
