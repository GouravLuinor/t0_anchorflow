import { describe, expect, it } from "vitest";
import {
  acceptDispatch,
  INITIAL_DISPATCH_STATE,
  isStaleDispatch,
} from "../protocol";
import type { WorkerInputPayload, WorkerOutputPayload } from "../types";

function msg(
  id: number,
  phase: WorkerInputPayload["phase"]
): Pick<WorkerInputPayload, "id" | "phase"> {
  return { id, phase };
}

function res(
  id: number,
  phase: WorkerOutputPayload["phase"]
): Pick<WorkerOutputPayload, "id" | "phase"> {
  return { id, phase };
}

describe("phase-rank stale guard (SPEC §9 AC-15)", () => {
  it("accepts the first dispatch", () => {
    expect(isStaleDispatch(msg(1, "A"), INITIAL_DISPATCH_STATE)).toBe(false);
  });

  it("drops any message carrying an OLDER id", () => {
    const state = acceptDispatch(msg(4, "A"), INITIAL_DISPATCH_STATE);
    expect(isStaleDispatch(msg(3, "A"), state)).toBe(true);
    expect(isStaleDispatch(msg(3, "B"), state)).toBe(true);
  });

  it("accepts a B for the CURRENT id after its A", () => {
    let state = acceptDispatch(msg(5, "A"), INITIAL_DISPATCH_STATE);
    expect(isStaleDispatch(msg(5, "B"), state)).toBe(false);
    state = acceptDispatch(msg(5, "B"), state);
    // …and a second B for the same id is a replay.
    expect(isStaleDispatch(msg(5, "B"), state)).toBe(true);
  });

  it("drops a late A that arrives after the same id's B", () => {
    let state = acceptDispatch(msg(5, "A"), INITIAL_DISPATCH_STATE);
    state = acceptDispatch(msg(5, "B"), state);
    expect(isStaleDispatch(msg(5, "A"), state)).toBe(true);
  });

  it("accepts a newer id at any phase", () => {
    let state = acceptDispatch(msg(5, "B"), INITIAL_DISPATCH_STATE);
    expect(isStaleDispatch(msg(6, "A"), state)).toBe(false);
    state = acceptDispatch(msg(6, "A"), state);
    expect(isStaleDispatch(msg(6, "B"), state)).toBe(false);
  });
});

describe("the same guard on the reply path", () => {
  // `useToolWorker.onWorkerMessage` applies `isStaleDispatch` to every OUTBOUND
  // envelope as its first statement, so a superseded reply is dropped by the
  // one predicate rather than by a second freshness function that could drift.
  it("drops a reply from a superseded dispatch", () => {
    const state = acceptDispatch(msg(3, "A"), INITIAL_DISPATCH_STATE);
    expect(isStaleDispatch(res(2, "A"), state)).toBe(true);
    expect(isStaleDispatch(res(1, "B"), state)).toBe(true);
  });

  it("accepts the B that follows its own A", () => {
    let state = acceptDispatch(msg(4, "A"), INITIAL_DISPATCH_STATE);
    expect(isStaleDispatch(res(4, "B"), state)).toBe(false);
    state = acceptDispatch(res(4, "B"), state);
    expect(isStaleDispatch(res(4, "B"), state)).toBe(true);
  });
});
