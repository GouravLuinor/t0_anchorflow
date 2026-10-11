// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — EVERY cap / budget / deadline constant lives here, and only
// here, so a Phase-4 grep of any name below lands on exactly one site
// (ARCH §7.2 · SPEC §9 AC-16).
//
// Published caps-name mapping — domain cap ↔ BAR §10 item-7 expectation:
//
//   BAR item-7 expectation      Anchorflow constant          Value
//   ─────────────────────────── ──────────────────────────── ─────────
//   MAX_TEST_LENGTH             MAX_INPUT_BYTES              262_144
//   MAX_MATCHES                 MAX_USES_SCAN                2_000
//   WORKER_DEADLINE_MS          WORKER_DEADLINE_MS           1_000
//   SYNC_DEADLINE_MS            SYNC_DEADLINE_MS             800
//   WATCHDOG_MS                 WATCHDOG_MS                  1_500
//   ARTIFACT_CACHE_CAPACITY     RESOLVE_CACHE_CAPACITY       64
//
// Network-domain additions: MAX_RESOLVES_PER_RUN ·
// MAX_RESOLVE_CONCURRENCY · RESOLVE_TIMEOUT_MS · RESOLVE_BUDGET_MS ·
// RATE_LIMIT_RESERVE · RESOLVE_NEGATIVE_TTL_MS · RESOLVE_DEBOUNCE_MS.
// ─────────────────────────────────────────────────────────────────────────────

/** Input ceiling (256 KiB ≈ a 5,000-line workflow). Original bytes reported on truncate. */
export const MAX_INPUT_BYTES = 262_144;

/** Structural `uses:` nodes scanned; the remainder is reported, never dropped. */
export const MAX_USES_SCAN = 2_000;

/** Network resolutions per run; also bounded by the rate-limit floor. */
export const MAX_RESOLVES_PER_RUN = 48;

/** Parallel in-flight resolve requests. */
export const MAX_RESOLVE_CONCURRENCY = 4;

/** Per-request AbortController timeout for a resolve GET. */
export const RESOLVE_TIMEOUT_MS = 8_000;

/** Total wall-clock budget for the resolve fan-out. */
export const RESOLVE_BUDGET_MS = 25_000;

/**
 * Advisory floor: stop fanning out when `remaining - inFlight <= this`. The
 * 60/hr limit is server-enforced and belongs to the visitor's own browser IP;
 * this only preserves the visitor's budget.
 */
export const RATE_LIMIT_RESERVE = 2;

/** LRU resolved-sha entries ("owner/repo@ref" → commit sha). */
export const RESOLVE_CACHE_CAPACITY = 64;

/** Negative TTL for uncached 404s so a repeated typo does not re-spend quota. */
export const RESOLVE_NEGATIVE_TTL_MS = 60_000;

/** Phase B debounce after the last edit — resolves spend quota, never per keystroke. */
export const RESOLVE_DEBOUNCE_MS = 500;

/** Phase A cooperative budget: a measured / WARN threshold, not a hard gate. */
export const WORKER_DEADLINE_MS = 1_000;

/** Stricter budget for the main-thread fallback, protecting UI frames. */
export const SYNC_DEADLINE_MS = 800;

/** Phase A hard wall-clock before terminate + respawn. Never armed for Phase B. */
export const WATCHDOG_MS = 1_500;

/** LRU entries in the worker for derived artifacts. */
export const ARTIFACT_CACHE_CAPACITY = 32;

/** Trailing window so typing bursts collapse into one screen-reader update. */
export const SUCCESS_ANNOUNCE_DEBOUNCE_MS = 800;

/** Seed for the advisory rate-limit budget before the first response headers. */
export const DEFAULT_RATE_LIMIT: { limit: number; remaining: number; resetAt: number } = {
  limit: 60,
  remaining: 60,
  resetAt: 0,
};

/** Adaptive debounce tiers for Phase A, by source length. */
export const DEBOUNCE_INSTANT_MS = 0; // ≤ 5,000
export const DEBOUNCE_MEDIUM_MS = 40; // > 5,000
export const DEBOUNCE_LARGE_MS = 120; // > 20,000
