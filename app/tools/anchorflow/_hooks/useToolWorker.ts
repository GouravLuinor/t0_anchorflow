"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  ANALYZE_TIMEOUT_ERROR,
  analyzeLocal,
} from "../_lib/analyze";
import {
  DEBOUNCE_INSTANT_MS,
  DEBOUNCE_LARGE_MS,
  DEBOUNCE_MEDIUM_MS,
  MAX_INPUT_BYTES,
  RESOLVE_DEBOUNCE_MS,
  SUCCESS_ANNOUNCE_DEBOUNCE_MS,
  WATCHDOG_MS,
} from "../_lib/constants";
import { analyzeResolve } from "../_lib/compute";
import {
  acceptDispatch,
  INITIAL_DISPATCH_STATE,
  isStaleDispatch,
  type DispatchState,
} from "../_lib/protocol";
import type {
  WorkerInputPayload,
  WorkerOutputPayload,
} from "../_lib/types";
import { useToolStore } from "../_store/useToolStore";

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
 *     thread at the stricter sync deadline — no fake variant;
 *   · Phase B (network resolve) is watchdog-free and abortable, and is only
 *     ever dispatched when the caller asks for it (`autoResolve`, off by
 *     default), so the default path makes zero external requests.
 */

/** Neutral in-flight crash copy — never let the watchdog verdict fabricate one. */
const WORKER_CRASH_ERROR = "Worker crashed — switched to main-thread mode";

/** Cap the input before it leaves the main thread (structured-clone cost). */
function truncateForDispatch(source: string): string {
  return source.length > MAX_INPUT_BYTES
    ? source.slice(0, MAX_INPUT_BYTES)
    : source;
}

function debounceFor(length: number): number {
  if (length > 20_000) return DEBOUNCE_LARGE_MS;
  if (length > 5_000) return DEBOUNCE_MEDIUM_MS;
  return DEBOUNCE_INSTANT_MS;
}

export function useToolWorker() {
  const source = useToolStore((s) => s.source);
  const autoResolve = useToolStore((s) => s.autoResolve);

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
        setResolveStatus("idle");
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
          source: truncateForDispatch(inputRef.current.source),
          resolve: false,
          budget: useToolStore.getState().rateLimit,
        } satisfies WorkerInputPayload);
        return;
      }

      // Synchronous fallback path — identical semantics via the same pure
      // core, under the stricter sync deadline that protects UI frames.
      try {
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
    }, debounceFor(source.length));

    return () => {
      clearDebounce();
      clearWatchdog();
    };
  }, [
    source,
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

  // Phase B — the network resolve phase. Deliberately decoupled from typing:
  // it debounces after the last edit and is only armed on an explicit opt-in
  // (autoResolve is off by default), so a keystroke never spends quota. It
  // NEVER arms the terminate-watchdog; it is aborted through the worker-scope
  // AbortController instead.
  useEffect(() => {
    clearResolveDebounce();
    if (!autoResolve) {
      setResolveStatus("idle");
      return;
    }

    resolveDebounceTimerRef.current = setTimeout(() => {
      const worker = workerRef.current;
      const id = ++requestIdRef.current;
      dispatchRef.current = { requestId: id, lastPhaseRank: 1 };

      // Never two resolves in flight: abort the previous fan-out first.
      resolveControllerRef.current?.abort();
      const controller = new AbortController();
      resolveControllerRef.current = controller;
      setResolveStatus("running");

      if (!degradedRef.current && worker) {
        worker.postMessage({
          id,
          phase: "B",
          source: truncateForDispatch(inputRef.current.source),
          resolve: true,
          budget: useToolStore.getState().rateLimit,
        } satisfies WorkerInputPayload);
        return;
      }

      // Degraded fallback: the same Phase-B merge contract on the main thread.
      const merged = analyzeResolve(analyzeLocal(inputRef.current.source), {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setResolveStatus("idle");
      setRateLimit(merged.rateLimit);
      handleResult({ ...merged, id, phase: "B" });
    }, RESOLVE_DEBOUNCE_MS);

    return () => {
      clearResolveDebounce();
    };
  }, [
    source,
    autoResolve,
    clearResolveDebounce,
    handleResult,
    setResolveStatus,
    setRateLimit,
  ]);
}
