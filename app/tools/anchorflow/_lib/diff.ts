// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — deterministic LCS line diff. Pure, no dependency, no IO.
//
// Every changed `uses:` line is a `-`/`+` pair (a pin preserves the line
// count), so the diff is exactly the pinned lines plus a change counter, and
// re-running on the tool's OWN output yields a ZERO-line diff (AC-9).
//
// Determinism: the LCS backtrack has ONE fixed tie-break (a deletion is taken
// before an insertion when both are equally long), so identical inputs always
// produce byte-identical hunks regardless of engine or run.
// ─────────────────────────────────────────────────────────────────────────────

import type { UnifiedDiff, UnifiedDiffLine } from "./types";

/** Context lines kept around a change inside a hunk. */
export const DIFF_CONTEXT_LINES = 3;

/** Cell budget for the exact LCS; larger windows fall back to a coarse script. */
const LCS_CELL_BUDGET = 2_000_000;

type Op = "keep" | "del" | "add";

interface EditScriptOp {
  op: Op;
  /** Index into the `before` lines. */
  before: number;
  /** Index into the `after` lines. */
  after: number;
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.split("\n");
}

/** Trims the shared prefix and suffix — the cheap 99% case for a rewrite. */
function trimEdges(
  before: readonly string[],
  after: readonly string[]
): { head: number; tail: number } {
  let head = 0;
  while (
    head < before.length &&
    head < after.length &&
    before[head] === after[head]
  ) {
    head += 1;
  }
  let tail = 0;
  while (
    tail < before.length - head &&
    tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) {
    tail += 1;
  }
  return { head, tail };
}

/**
 * Exact LCS over the differing window; returns `null` when the window is too
 * large for the exact DP, so the caller can fall back to a coarse (but still
 * correct) script rather than exhausting memory.
 */
function lcsScript(
  before: readonly string[],
  after: readonly string[]
): EditScriptOp[] | null {
  const n = before.length;
  const m = after.length;
  if (n === 0 && m === 0) return [];
  if ((n + 1) * (m + 1) > LCS_CELL_BUDGET) return null;

  // Row-major LCS lengths; row 0 and column 0 are the empty prefix.
  const width = m + 1;
  const table = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        before[i] === after[j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }

  const ops: EditScriptOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ op: "keep", before: i, after: j });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      // Fixed tie-break: deletions before insertions.
      ops.push({ op: "del", before: i, after: j });
      i += 1;
    } else {
      ops.push({ op: "add", before: i, after: j });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ op: "del", before: i, after: j });
    i += 1;
  }
  while (j < m) {
    ops.push({ op: "add", before: i, after: j });
    j += 1;
  }
  return ops;
}

/** Coarse fallback for a very large window: drop everything, then add it back. */
function coarseScript(
  before: readonly string[],
  after: readonly string[]
): EditScriptOp[] {
  const ops: EditScriptOp[] = [];
  before.forEach((_line, index) => ops.push({ op: "del", before: index, after: 0 }));
  after.forEach((_line, index) => ops.push({ op: "add", before: 0, after: index }));
  return ops;
}

/**
 * Pairs a deletion run with the insertion run that immediately follows it, so a
 * replaced line reads as a `-` / `+` PAIR rather than a block of `-` lines
 * followed by a block of `+` lines (SPEC §4 F4 · AC-9).
 */
function pairRuns(ops: readonly EditScriptOp[]): EditScriptOp[] {
  const out: EditScriptOp[] = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].op !== "del") {
      out.push(ops[i]);
      i += 1;
      continue;
    }
    let delEnd = i;
    while (delEnd < ops.length && ops[delEnd].op === "del") delEnd += 1;
    let addEnd = delEnd;
    while (addEnd < ops.length && ops[addEnd].op === "add") addEnd += 1;
    const dels = ops.slice(i, delEnd);
    const adds = ops.slice(delEnd, addEnd);
    const pairs = Math.min(dels.length, adds.length);
    for (let p = 0; p < pairs; p += 1) {
      out.push(dels[p]);
      out.push(adds[p]);
    }
    for (let p = pairs; p < dels.length; p += 1) out.push(dels[p]);
    for (let p = pairs; p < adds.length; p += 1) out.push(adds[p]);
    i = addEnd;
  }
  return out;
}

function buildScript(
  before: readonly string[],
  after: readonly string[]
): EditScriptOp[] {
  const { head, tail } = trimEdges(before, after);
  const ops: EditScriptOp[] = [];
  for (let i = 0; i < head; i += 1) {
    ops.push({ op: "keep", before: i, after: i });
  }

  const windowBefore = before.slice(head, before.length - tail);
  const windowAfter = after.slice(head, after.length - tail);
  const windowOps =
    lcsScript(windowBefore, windowAfter) ?? coarseScript(windowBefore, windowAfter);
  for (const op of windowOps) {
    ops.push({
      ...op,
      before: op.before + head,
      after: op.after + head,
    });
  }

  for (let k = 0; k < tail; k += 1) {
    ops.push({
      op: "keep",
      before: before.length - tail + k,
      after: after.length - tail + k,
    });
  }
  return ops;
}

/**
 * A replaced line counts ONCE (one `-`/`+` pair); a pure insertion or deletion
 * counts its own lines. That is the "number of changed lines" a reviewer reads.
 */
function countChanged(ops: readonly EditScriptOp[]): number {
  let changed = 0;
  let dels = 0;
  let adds = 0;
  const flush = () => {
    changed += Math.max(dels, adds);
    dels = 0;
    adds = 0;
  };
  for (const op of ops) {
    if (op.op === "keep") {
      flush();
    } else if (op.op === "del") {
      dels += 1;
    } else {
      adds += 1;
    }
  }
  flush();
  return changed;
}

/**
 * The unified diff of two texts: hunks with `DIFF_CONTEXT_LINES` lines of
 * context, every line tagged keep / add / del with 1-based line numbers on both
 * sides. Identical inputs produce an EMPTY diff.
 */
export function unifiedUsesDiff(
  before: string,
  after: string
): UnifiedDiff {
  const beforeLines = splitLines(before);
  const afterLines = splitLines(after);
  const ops = pairRuns(buildScript(beforeLines, afterLines));
  const changed = countChanged(ops);

  if (changed === 0) {
    return { changed: 0, lines: [] };
  }

  // Index of the ops that are changes, then grow each cluster by the context.
  const keep: boolean[] = ops.map((op) => op.op !== "keep");
  const shown: boolean[] = keep.map(() => false);
  ops.forEach((op, index) => {
    if (!keep[index]) return;
    for (
      let k = Math.max(0, index - DIFF_CONTEXT_LINES);
      k <= Math.min(ops.length - 1, index + DIFF_CONTEXT_LINES);
      k += 1
    ) {
      shown[k] = true;
    }
  });

  const lines: UnifiedDiffLine[] = [];
  ops.forEach((op, index) => {
    if (!shown[index]) return;
    const text = op.op === "add" ? afterLines[op.after] : beforeLines[op.before];
    lines.push({
      kind: op.op === "keep" ? "context" : op.op === "add" ? "add" : "del",
      text: text ?? "",
      beforeLine: op.op === "add" ? null : op.before + 1,
      afterLine: op.op === "del" ? null : op.after + 1,
    });
  });

  return { changed, lines };
}
