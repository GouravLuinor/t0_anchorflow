// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the worker protocol guard (pure, unit-tested).
//
// Two same-id messages are distinguishable by `phase`, so the guard ranks them:
//   · a `B` for the current id is accepted AFTER its `A`;
//   · an `A` after a `B`, or a second `B`, for the same id is dropped;
//   · anything with an older id is dropped outright (the newest request wins).
// ─────────────────────────────────────────────────────────────────────────────

import type { WorkerInputPayload, WorkerOutputPayload } from "./types";

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
 * True when an outbound envelope belongs to a settled dispatch and may be
 * applied to the store (the newest-result-wins guard on the reply path).
 */
export function isFreshResponse(
  response: Pick<WorkerOutputPayload, "id" | "phase">,
  state: DispatchState
): boolean {
  return response.id === state.requestId && PHASE_RANK[response.phase] >= state.lastPhaseRank;
}
