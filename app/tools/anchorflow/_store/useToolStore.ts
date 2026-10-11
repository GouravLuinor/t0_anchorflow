"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_RATE_LIMIT } from "../_lib/constants";
import { EMPTY_METRICS } from "../_lib/analyze";
import { DEFAULT_WORKFLOW } from "../_lib/presets";
import type { RateLimitState, ToolMetrics, WorkerOutputPayload } from "../_lib/types";

/**
 * Result subset shared by `analyzeLocal` and `WorkerOutputPayload` so the hot
 * path can settle every output slice in one atomic set().
 */
export interface DiagnosticReport {
  uses: WorkerOutputPayload["uses"];
  resolutions: WorkerOutputPayload["resolutions"];
  rewrittenYaml: string | null;
  diff: WorkerOutputPayload["diff"];
  permissions: WorkerOutputPayload["permissions"];
  findings: WorkerOutputPayload["findings"];
  echo: string | null;
}

export interface ComputationResult extends DiagnosticReport {
  ok: boolean;
  metrics: ToolMetrics;
  rateLimit: RateLimitState;
  error: string | null;
}

/** Screen-reader announcement payload; `seq` keys re-renders of identical text. */
export interface StatusAnnouncement {
  message: string;
  seq: number;
}

/** Worker health: null = unknown, true = off-main-thread, false = degraded sync. */
export type WorkerAvailability = boolean | null;

interface ToolState {
  // ── User content — persisted across sessions ──────────────────────────────
  source: string;
  setSource: (source: string) => void;

  autoResolve: boolean;
  setAutoResolve: (autoResolve: boolean) => void;

  // ── Processed output (transient) ──────────────────────────────────────────
  report: DiagnosticReport;
  resetReport: () => void;

  // Processing state & telemetry (transient)
  isProcessing: boolean;
  setIsProcessing: (isProcessing: boolean) => void;
  metrics: ToolMetrics;

  errorMessage: string | null;
  setErrorMessage: (msg: string | null) => void;

  isWorkerAvailable: WorkerAvailability;
  setWorkerAvailable: (available: WorkerAvailability) => void;

  /** Phase B status: idle · running · limited · offline (never blocks Phase A). */
  resolveStatus: "idle" | "running" | "limited" | "offline";
  setResolveStatus: (status: ToolState["resolveStatus"]) => void;
  rateLimit: RateLimitState;
  setRateLimit: (budget: RateLimitState) => void;

  // ── Transient UI chrome state (never persisted) ───────────────────────────
  isCommandPaletteOpen: boolean;
  setCommandPaletteOpen: (open: boolean) => void;

  // Screen-reader announcements for async status changes.
  statusAnnouncement: StatusAnnouncement | null;
  announceStatus: (message: string) => void;

  /**
   * Hot-path batch action: settles report, metrics, error and announcement in
   * a single set() so consumers never observe intermediate states.
   *
   * FIELD-MERGE GUARD: each report field is taken from the payload only when
   * it is defined, so a partial or empty Phase-B / fallback envelope can never
   * blank the offline report (SPEC §4 F3 · AC-13).
   */
  applyResult: (
    result: Partial<ComputationResult>,
    options?: { announce?: boolean }
  ) => void;

  reset: () => void;
}

const EMPTY_REPORT: DiagnosticReport = {
  uses: [],
  resolutions: [],
  rewrittenYaml: null,
  diff: null,
  permissions: null,
  findings: [],
  echo: null,
};

// Module-level so both announcement paths share one monotonic counter without
// exposing bookkeeping state (announcements are per-context, never persisted).
let announcementSeq = 0;

function nextAnnouncement(message: string): StatusAnnouncement {
  return { message, seq: ++announcementSeq };
}

function announceFor(result: Partial<ComputationResult>): string {
  if (result.error) return `Analysis failed: ${result.error}`;
  const metrics = result.metrics;
  if (!metrics) return "Analysis complete";
  return `Analysis complete — ${metrics.characterCount} characters, ${metrics.wordCount} words, ${metrics.byteCount} bytes`;
}

export const useToolStore = create<ToolState>()(
  persist(
    (set) => ({
      // Seeded first-run content so the instrument is non-blank on first
      // paint; persisted sessions override these on rehydrate (see merge).
      source: DEFAULT_WORKFLOW,
      setSource: (source) => set({ source }),

      // Off by default: the default path makes ZERO external requests
      // (SPEC §9 AC-12). Resolution is opt-in and quota-aware.
      autoResolve: false,
      setAutoResolve: (autoResolve) => set({ autoResolve }),

      report: EMPTY_REPORT,
      resetReport: () => set({ report: EMPTY_REPORT }),

      isProcessing: false,
      setIsProcessing: (isProcessing) => set({ isProcessing }),

      metrics: { ...EMPTY_METRICS },

      errorMessage: null,
      setErrorMessage: (errorMessage) => set({ errorMessage }),

      isWorkerAvailable: null,
      setWorkerAvailable: (isWorkerAvailable) => set({ isWorkerAvailable }),

      resolveStatus: "idle",
      setResolveStatus: (resolveStatus) => set({ resolveStatus }),

      rateLimit: { ...DEFAULT_RATE_LIMIT },
      setRateLimit: (rateLimit) => set({ rateLimit }),

      isCommandPaletteOpen: false,
      setCommandPaletteOpen: (isCommandPaletteOpen) =>
        set({ isCommandPaletteOpen }),

      statusAnnouncement: null,
      announceStatus: (message) =>
        set({ statusAnnouncement: nextAnnouncement(message) }),

      applyResult: (result, options) =>
        set((state) => {
          const failed = Boolean(result.error);
          const base = failed
            ? {
                // Clear settled output too — a rejected analysis must not
                // leave a previous report on screen.
                report: EMPTY_REPORT,
                metrics: { ...EMPTY_METRICS },
                errorMessage: result.error ?? null,
              }
            : {
                report: {
                  uses: result.uses ?? state.report.uses,
                  resolutions: result.resolutions ?? state.report.resolutions,
                  rewrittenYaml: result.rewrittenYaml ?? state.report.rewrittenYaml,
                  diff: result.diff ?? state.report.diff,
                  permissions: result.permissions ?? state.report.permissions,
                  findings: result.findings ?? state.report.findings,
                  echo: result.echo ?? state.report.echo,
                },
                metrics: result.metrics ?? state.metrics,
                errorMessage: null,
              };

          return {
            ...base,
            ...(result.rateLimit ? { rateLimit: result.rateLimit } : {}),
            statusAnnouncement:
              options?.announce === false
                ? state.statusAnnouncement
                : nextAnnouncement(announceFor(result)),
          };
        }),

      // A true Clear: wipes user content + settled output but preserves the
      // content session flags and the transient UI-chrome booleans.
      reset: () =>
        set({
          source: "",
          report: EMPTY_REPORT,
          metrics: { ...EMPTY_METRICS },
          errorMessage: null,
          statusAnnouncement: null,
        }),
    }),
    {
      name: "anchorflow-tool-storage",
      version: 1,
      // Rehydrated explicitly after mount (see useToolWorker) to avoid SSR
      // hydration mismatches between server HTML and persisted client state.
      skipHydration: true,
      partialize: (state) => ({
        // CONTENT ONLY: theme lives under `anchorflow-theme` and is never
        // merged into this store (BAR §4.5).
        source: state.source,
        autoResolve: state.autoResolve,
      }),
      // Future-proofing: v0/v1 payloads pass through; merge() below repairs
      // any shape drift so version bumps stay additive.
      migrate: (persisted) => persisted as ToolState,
      merge: (persisted, current) => {
        const incoming = (persisted ?? {}) as Partial<ToolState>;
        return {
          ...current,
          ...incoming,
          // Defensive: hand-edited or older payloads may miss these keys.
          autoResolve: incoming.autoResolve ?? false,
          source: incoming.source ?? DEFAULT_WORKFLOW,
        };
      },
      storage: createJSONStorage(() => localStorage),
    }
  )
);
