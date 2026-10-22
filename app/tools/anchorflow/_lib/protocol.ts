// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the worker protocol guard (pure, unit-tested).
//
// Two same-id messages are distinguishable by `phase`, so the guard ranks them:
//   · a `B` for the current id is accepted AFTER its `A`;
//   · an `A` after a `B`, or a second `B`, for the same id is dropped;
//   · anything with an older id is dropped outright (the newest request wins).
//
// ONE guard, both directions: `isStaleDispatch` is applied to every INBOUND
// dispatch AND to every OUTBOUND reply in `useToolWorker.onWorkerMessage`, so
// a superseded envelope is dropped on the reply path by the same function — no
// second, half-used freshness predicate to drift from the first.
// ─────────────────────────────────────────────────────────────────────────────

import type { WorkerInputPayload } from "./types";

export const PHASE_RANK = { A: 1, B: 2 } as const;

export interface DispatchState {
  /** Newest dispatched id. */
  requestId: number;
  /** Highest phase rank already accepted for `requestId` (0 = none). */
  lastPhaseRank: number;
}

export const INITIAL_DISPATCH_STATE: DispatchState = {
  requestId: 0,
  lastPhaseRank: 0,
};

/** True when an inbound message is stale or a replay and must be dropped. */
export function isStaleDispatch(
  message: Pick<WorkerInputPayload, "id" | "phase">,
  state: DispatchState
): boolean {
  if (message.id < state.requestId) return true;
  if (message.id > state.requestId) return false;
  return PHASE_RANK[message.phase] <= state.lastPhaseRank;
}

/** Advances the dispatch state after a message is accepted. */
export function acceptDispatch(
  message: Pick<WorkerInputPayload, "id" | "phase">,
  _state: DispatchState
): DispatchState {
  return {
    requestId: message.id,
    lastPhaseRank: PHASE_RANK[message.phase],
  };
}

/**
 * The worker's readiness handshake. The worker posts this once its module has
 * loaded; the hook holds every dispatch (and its watchdog) until it lands, so
 * chunk download and parse time on a slow device never count against the
 * compute budget and the built-in example can never be called "too complex".
 */
export interface WorkerReadyMessage {
  type: "ready";
}

/** True for the readiness handshake, false for any analysis envelope. */
export function isReadyMessage(message: unknown): message is WorkerReadyMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "ready"
  );
}
