// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — source → WorkflowModel (structure + offsets). Pure, no IO.
//
// eemeli `yaml`'s `Document` API with `keepSourceTokens: true` is the ONLY
// parser that preserves comments while still exposing every scalar's byte
// range into the ORIGINAL source — which is what makes the offset-surgical
// rewrite in `yamlRewrite.ts` possible (PLAN §2.1 proved a whole-document
// `toString()` normalizes `[main]` → `[ main ]` and collapses comment
// whitespace, so re-emitting is FORBIDDEN on the output path).
//
// COLLECTION IS STRUCTURAL, NEVER LEXICAL-BY-KEY (SPEC §4 F1 · AC-1):
// `uses:` nodes are gathered by walking the fixed paths
// `jobs.<id>.steps[].uses` and `jobs.<id>.uses`. A mapping key literally named
// `uses` anywhere else — a `with:` input, an `env:` value, a step `name:` — is
// never collected, classified, resolved or rewritten.
//
// ERRORS ARE VALUES, NEVER THROWS: a malformed document comes back as
// `{ ok: false, error }` (with the parser's line/column), never an exception.
// ─────────────────────────────────────────────────────────────────────────────

import { isMap, isPair, isScalar, isSeq, parseDocument } from "yaml";
import { MAX_INPUT_BYTES, MAX_USES_SCAN } from "./constants";
import { truncateToCap } from "./textMetrics";
import type {
  JobNode,
  ParseErrorValue,
  RawPermissionBlock,
  StepNode,
  TriggerInfo,
  UsesRaw,
  UsesScope,
  WorkflowModel,
} from "./types";

// ── Public shape ────────────────────────────────────────────────────────────
export type { ParseErrorValue } from "./types";

export interface ParseCaps {
  /** Input ceiling in UTF-8 bytes (default MAX_INPUT_BYTES). */
  maxInputBytes?: number;
  /** Structural `uses:` nodes scanned (default MAX_USES_SCAN). */
  maxUsesScan?: number;
}

export interface ParseOptions {
  caps?: ParseCaps;
}

export type ParseResult =
  | { ok: true; model: WorkflowModel }
  | { ok: false; error: ParseErrorValue };

const EMPTY_JOB = (id: string): JobNode => ({
  id,
  permissions: null,
  permissionsStart: null,
  steps: [],
  uses: null,
  withInputs: {},
  withInputStarts: {},
});

function emptyModel(): WorkflowModel {
  return {
    ok: true,
    error: null,
    topPermissions: null,
    topPermissionsStart: null,
    triggers: { pullRequestTarget: false, workflowRun: false },
    jobs: [],
    uses: [],
    usesCap: { seen: 0, scanned: 0, capped: false },
  };
}

// ── Structural helpers ──────────────────────────────────────────────────────

/** The pair whose key scalar equals `key`, or null — never by lexical search. */
function pairAt(node: unknown, key: string) {
  if (!isMap(node)) return null;
  for (const item of node.items) {
    if (!isPair(item)) continue;
    if (isScalar(item.key) && String(item.key.value) === key) return item;
  }
  return null;
}

/** A scalar's text; `null` values (an empty `uses:`) become "". */
function scalarText(node: unknown): string | null {
  if (!isScalar(node)) return null;
  return node.value === null || node.value === undefined
    ? ""
    : String(node.value);
}

/** A node's start offset into the ORIGINAL source, or null when unavailable. */
function nodeStart(node: unknown): number | null {
  if (!node || typeof node !== "object") return null;
  const range = (node as { range?: unknown }).range;
  return Array.isArray(range) && typeof range[0] === "number" ? range[0] : null;
}

/**
 * Flattens a mapping's scalar entries with their value offsets (nested blocks
 * are skipped, not faked). The offsets let the audits cite the exact line of
 * the input they flagged instead of only the job/step path.
 */
function scalarRecordOffsets(node: unknown): {
  values: Record<string, string>;
  starts: Record<string, number>;
} {
  const values: Record<string, string> = {};
  const starts: Record<string, number> = {};
  if (!isMap(node)) return { values, starts };
  for (const item of node.items) {
    if (!isPair(item) || !isScalar(item.key)) continue;
    const text = scalarText(item.value);
    if (text === null) continue;
    const key = String(item.key.value);
    values[key] = text;
    const start = nodeStart(item.value);
    if (start !== null) starts[key] = start;
  }
  return { values, starts };
}

/** The trailing comment the parser attached to a value (" v4" → "v4"). */
function trailingComment(node: unknown): string | null {
  if (!isScalar(node)) return null;
  const comment = (node as { comment?: string | null }).comment;
  if (typeof comment !== "string") return null;
  const trimmed = comment.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Reads a `permissions:` node in either shape: `write-all` / `read-all` (a
 * scalar) or a per-scope map. Typed-node variant of the M3 `parsePermissions`
 * seam in `permissionAudit.ts` — that module owns the unknown-shaped entry
 * point, this one is what the parser already has in hand.
 */
export function parsePermissionBlock(node: unknown): RawPermissionBlock | null {
  const text = scalarText(node);
  if (text !== null) {
    if (text === "write-all") return { all: "write", scopes: {} };
    if (text === "read-all") return { all: "read", scopes: {} };
    return null;
  }
  if (!isMap(node)) return null;
  const scopes: Record<string, "read" | "write" | "none"> = {};
  for (const item of node.items) {
    if (!isPair(item) || !isScalar(item.key)) continue;
    const level = scalarText(item.value);
    if (level === "read" || level === "write" || level === "none") {
      scopes[String(item.key.value)] = level;
    }
  }
  return { scopes };
}

function readTriggers(node: unknown): TriggerInfo {
  const triggers: TriggerInfo = { pullRequestTarget: false, workflowRun: false };
  if (isScalar(node)) {
    const text = String(node.value ?? "");
    triggers.pullRequestTarget = /\bpull_request_target\b/.test(text);
    triggers.workflowRun = /\bworkflow_run\b/.test(text);
    return triggers;
  }
  if (isSeq(node)) {
    for (const item of node.items) {
      if (!isScalar(item)) continue;
      if (item.value === "pull_request_target") triggers.pullRequestTarget = true;
      if (item.value === "workflow_run") triggers.workflowRun = true;
    }
    return triggers;
  }
  if (isMap(node)) {
    for (const item of node.items) {
      if (!isPair(item) || !isScalar(item.key)) continue;
      if (item.key.value === "pull_request_target") triggers.pullRequestTarget = true;
      if (item.key.value === "workflow_run") triggers.workflowRun = true;
    }
  }
  return triggers;
}

/**
 * One `uses:` node, read at its known structural position only.
 * `start` is the scalar's first byte (the opening quote for a quoted scalar) and
 * `valueEnd` is the offset AFTER the value — past the closing quote when the
 * scalar is quoted — which is exactly where the ` # <ref>` annotation lands.
 */
function readUsesRaw(
  pair: { value: unknown },
  context: { jobId: string; scope: UsesScope; stepIndex: number | null }
): UsesRaw | null {
  const node = pair.value;
  if (!isScalar(node)) return null;
  const range = node.range;
  const start = Array.isArray(range) ? range[0] : null;
  const valueEnd = Array.isArray(range) ? range[1] : null;
  if (start === null || valueEnd === null) return null;
  return {
    id: `${context.jobId}:${context.scope === "job" ? "job" : context.stepIndex}`,
    jobId: context.jobId,
    scope: context.scope,
    stepIndex: context.stepIndex,
    raw: scalarText(node) ?? "",
    start,
    valueEnd,
    existingComment: trailingComment(node),
  };
}

function isCheckoutAction(raw: string): boolean {
  // owner/repo[/subpath]@ref — checkout can legitimately live at a subpath.
  const withoutRef = raw.split("@")[0] ?? "";
  const [owner, repo] = withoutRef.split("/");
  return owner === "actions" && repo === "checkout";
}

function readBoolean(text: string | undefined): boolean | null {
  if (text === "true") return true;
  if (text === "false") return false;
  return null;
}

// ── The one structural traversal ────────────────────────────────────────────

interface Collector {
  uses: UsesRaw[];
  seen: number;
  scanned: number;
  capped: boolean;
}

/**
 * Stops collecting DETAIL at the scan cap but keeps counting `seen`, so the
 * report can say "scan capped at N — M further nodes not analyzed" and never
 * silently drops the remainder (SPEC §4 F2 · AC-13).
 */
function collectUses(
  collector: Collector,
  next: UsesRaw | null,
  maxUsesScan: number
): void {
  if (next === null) return;
  collector.seen += 1;
  if (collector.scanned >= maxUsesScan) {
    collector.capped = true;
    return;
  }
  collector.scanned += 1;
  collector.uses.push(next);
}

function readJob(jobId: string, jobNode: unknown, collector: Collector, maxUsesScan: number): JobNode {
  const job: JobNode = EMPTY_JOB(jobId);

  for (const item of isMap(jobNode) ? jobNode.items : []) {
    if (!isPair(item) || !isScalar(item.key)) continue;
    const key = String(item.key.value);

    if (key === "permissions") {
      job.permissions = parsePermissionBlock(item.value);
      job.permissionsStart = nodeStart(item.value);
      continue;
    }

    if (key === "with") {
      // Reusable-workflow inputs. Read as a flat scalar map — a nested block
      // here is not an injection surface, so it is skipped rather than faked.
      const inputs = scalarRecordOffsets(item.value);
      job.withInputs = inputs.values;
      job.withInputStarts = inputs.starts;
      continue;
    }

    if (key === "uses") {
      // Job-level reusable-workflow call: scope "job", stepIndex null. Also
      // pinnable and never silently dropped (PLAN decision 9).
      const uses = readUsesRaw(item, { jobId, scope: "job", stepIndex: null });
      collectUses(collector, uses, maxUsesScan);
      if (uses) job.uses = uses;
      continue;
    }

    if (key !== "steps") continue;

    const stepsNode = item.value;
    if (!isSeq(stepsNode)) continue;
    let index = 0;
    for (const stepNode of stepsNode.items) {
      const stepIndex = index;
      index += 1;
      if (!isMap(stepNode)) continue;

      const step: StepNode = {
        index: stepIndex,
        usesRaw: null,
        usesStart: null,
        usesValueEnd: null,
        usesComment: null,
        run: null,
        runStart: null,
        withValues: {},
        withStarts: {},
        ifExpr: null,
        ifStart: null,
        persistCredentials: null,
        checkoutRef: null,
      };

      let usesRaw: string | null = null;
      for (const entry of stepNode.items) {
        if (!isPair(entry) || !isScalar(entry.key)) continue;
        const stepKey = String(entry.key.value);

        if (stepKey === "uses") {
          const uses = readUsesRaw(entry, {
            jobId,
            scope: "step",
            stepIndex,
          });
          collectUses(collector, uses, maxUsesScan);
          if (uses) {
            step.usesRaw = uses.raw;
            step.usesStart = uses.start;
            step.usesValueEnd = uses.valueEnd;
            step.usesComment = uses.existingComment;
            usesRaw = uses.raw;
          }
          continue;
        }
        if (stepKey === "run") {
          step.run = scalarText(entry.value);
          step.runStart = nodeStart(entry.value);
          continue;
        }
        if (stepKey === "if") {
          step.ifExpr = scalarText(entry.value);
          step.ifStart = nodeStart(entry.value);
          continue;
        }
        if (stepKey === "with") {
          const inputs = scalarRecordOffsets(entry.value);
          step.withValues = inputs.values;
          step.withStarts = inputs.starts;
        }
      }

      if (usesRaw !== null && isCheckoutAction(usesRaw)) {
        // checkout details are read at THIS step's own `with:`, never by name.
        step.persistCredentials = readBoolean(step.withValues["persist-credentials"]);
        step.checkoutRef = step.withValues["ref"] ?? null;
      }

      job.steps.push(step);
    }
  }

  return job;
}

/** Strips the parser's native name/code prefix but keeps its line + column. */
function toParseError(error: {
  message?: string;
  linePos?: Array<{ line: number; col: number }> | null;
  pos?: [number, number] | null;
}): ParseErrorValue {
  const raw = typeof error.message === "string" ? error.message : "invalid YAML";
  const firstLine = raw.split("\n")[0] ?? raw;
  // eemeli already suffixes "at line L, column C"; keep the human reason only.
  const reason =
    firstLine.replace(/\s+at line \d+, column \d+:?\s*$/, "").trim() || firstLine;
  const position = error.linePos?.[0] ?? null;
  return {
    message: reason,
    line: position ? position.line : null,
    column: position ? position.col : null,
    reason,
  };
}

/**
 * Parse one workflow source into the structural model.
 *
 * The source is truncated at `MAX_INPUT_BYTES` on a code-point boundary first
 * (a lone surrogate is never produced); the caller reports the ORIGINAL byte
 * count from `metrics.byteCount`, so the cap never hides the real input size.
 */
export function parseWorkflow(
  source: string,
  options: ParseOptions = {}
): ParseResult {
  const maxInputBytes = options.caps?.maxInputBytes ?? MAX_INPUT_BYTES;
  const maxUsesScan = options.caps?.maxUsesScan ?? MAX_USES_SCAN;

  const truncated = truncateToCap(source, maxInputBytes);
  const text = truncated.text;

  try {
    const doc = parseDocument(text, { keepSourceTokens: true });

    if (doc.errors.length > 0) {
      return { ok: false, error: toParseError(doc.errors[0]) };
    }

    const model = emptyModel();
    const topPermissionsPair = pairAt(doc.contents, "permissions");
    model.topPermissions = topPermissionsPair
      ? parsePermissionBlock(topPermissionsPair.value)
      : null;
    model.topPermissionsStart = topPermissionsPair
      ? nodeStart(topPermissionsPair.value)
      : null;
    model.triggers = readTriggers(pairAt(doc.contents, "on")?.value);

    const jobsNode = pairAt(doc.contents, "jobs")?.value;
    const collector: Collector = {
      uses: model.uses,
      seen: 0,
      scanned: 0,
      capped: false,
    };

    if (isMap(jobsNode)) {
      for (const jobPair of jobsNode.items) {
        if (!isPair(jobPair) || !isScalar(jobPair.key)) continue;
        const jobId = String(jobPair.key.value);
        model.jobs.push(readJob(jobId, jobPair.value, collector, maxUsesScan));
      }
    }

    model.uses = collector.uses;
    model.usesCap = {
      seen: collector.seen,
      scanned: collector.scanned,
      capped: collector.capped,
    };
    return { ok: true, model };
  } catch {
    // A native throw is a value too — the pipeline degrades to `!ok`.
    return {
      ok: false,
      error: {
        message: "the workflow could not be parsed",
        line: null,
        column: null,
        reason: "the workflow could not be parsed",
      },
    };
  }
}

/**
 * ARCH §3.2's flat shape: the model itself, carrying `ok:false` + the parser
 * message for malformed YAML (an empty model, never `undefined`).
 */
export function yamlParse(
  source: string,
  options?: ParseOptions
): WorkflowModel {
  const result = parseWorkflow(source, options);
  if (result.ok) return result.model;
  const model = emptyModel();
  model.ok = false;
  model.error = result.error.message;
  return model;
}
