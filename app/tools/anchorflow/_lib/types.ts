// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — shared types + the worker protocol.
//
// ZERO runtime imports (pure `interface`/`type` only): the worker, the
// main-thread fallback and the UI all read this file, so no compiler logic can
// leak into a component bundle through it.
//
// DOMAIN SEAMS: the classification / resolution / findings / permissions /
// diff shapes below are the contract the domain agent (M1–M4) implements. Until
// then the pipeline reports the placeholder measurements carried on
// `ToolMetrics` + `WorkerOutputPayload.echo`, and the domain arrays ship EMPTY
// (never `undefined`) so the merge contract holds from day one.
// ─────────────────────────────────────────────────────────────────────────────

// ── Classification ───────────────────────────────────────────────────────────
export type UsesClass =
  | "sha40"
  | "sha256"
  | "remoteRef"
  | "local"
  | "docker"
  | "invalid";

export type UsesScope = "step" | "job";

export type ResolveStatus =
  | "not-requested"
  | "resolved"
  | "unknown-ref"
  | "rate-limited"
  | "network-error";

export interface UsesRaw {
  id: string;
  jobId: string;
  scope: UsesScope;
  stepIndex: number | null; // null when scope === "job"
  raw: string; // the UNQUOTED scalar text
  start: number; // scalar start offset in source
  valueEnd: number; // offset AFTER the value (past the closing quote if quoted)
  existingComment: string | null; // trailing comment text on the line, if any
}

export interface ClassifiedUses extends UsesRaw {
  cls: UsesClass;
  owner: string | null;
  repo: string | null;
  subpath: string | null;
  ref: string | null;
  moving: boolean; // MOVING_REFS membership OR /^v?\d+$/
}

// ── Workflow structure (collected STRUCTURALLY, never by key name) ───────────
export interface StepNode {
  index: number;
  usesRaw: string | null;
  usesStart: number | null;
  usesValueEnd: number | null;
  usesComment: string | null;
  run: string | null;
  withValues: Record<string, string>;
  ifExpr: string | null;
  persistCredentials: boolean | null; // checkout steps only
  checkoutRef: string | null; // with.ref on checkout steps
}

export interface JobNode {
  id: string;
  permissions: RawPermissionBlock | null;
  steps: StepNode[];
  uses: UsesRaw | null; // job-level reusable-workflow call (scope "job")
  withInputs: Record<string, string>; // reusable-workflow inputs
}

export interface TriggerInfo {
  pullRequestTarget: boolean;
  workflowRun: boolean;
}

export interface RawPermissionBlock {
  all?: "read" | "write";
  scopes: Record<string, "read" | "write" | "none">;
}

export interface WorkflowModel {
  ok: boolean;
  error: string | null; // malformed-YAML message; errors-as-values
  topPermissions: RawPermissionBlock | null;
  triggers: TriggerInfo;
  jobs: JobNode[];
  uses: UsesRaw[]; // FLATTENED: step uses + job uses (scope-tagged)
  usesCap: { seen: number; scanned: number; capped: boolean };
}

// ── Resolution ───────────────────────────────────────────────────────────────
export interface ResolveReceipt {
  endpoint: string; // e.g. GET /repos/{o}/{r}/git/ref/tags/{ref}
  returnedSha: string; // the FINAL commit sha
  dereferencedFrom?: string; // annotated: the tag-object sha before deref
  lsRemote: string; // git ls-remote cross-check line (peeled)
  resolvedAt: string; // ISO-8601; display-only, exempt from determinism compare
}

export interface Resolution {
  ref: ClassifiedUses;
  resolvedSha: string | null;
  status: ResolveStatus;
  receipt: ResolveReceipt | null;
}

// ── Findings — ONE canonical array ───────────────────────────────────────────
export type Severity = "error" | "warn" | "info";

export type FindingCategory =
  | "unpinned-uses"
  | "template-injection"
  | "excessive-permissions"
  | "dangerous-trigger"
  | "persist-credentials"
  | "moving-ref"
  | "resolution";

export interface Finding {
  id: string; // "<category>:<jobId>:<stepIndex|job>:<n>" — deterministic
  category: FindingCategory;
  severity: Severity;
  title: string;
  detail: string;
  remediation: string;
  where: string;
  evidence?: string;
  receipt?: ResolveReceipt;
  start: number | null; // source offset of primary evidence; null sorts LAST
}

export interface GrantRow {
  scope: string;
  level: "read" | "write" | "none";
  source: "top" | `job:${string}`;
}

export interface GrantTable {
  top: RawPermissionBlock | null;
  jobs: Array<{ jobId: string; block: RawPermissionBlock | null }>;
  effective: GrantRow[];
  unset: boolean;
}

// ── Injection (detector output; mapped into Finding[] by compute.ts) ─────────
export interface InjectionSink {
  id: string;
  where: string;
  expression: string;
  contextPath: string;
  severity: Severity;
  remediation: string;
  source: "run" | "with" | "if";
  start: number | null;
}

// ── Diff ─────────────────────────────────────────────────────────────────────
export interface UnifiedDiffLine {
  kind: "context" | "add" | "del";
  text: string;
}

export interface UnifiedDiff {
  changed: number;
  lines: UnifiedDiffLine[];
}

// ── Metrics / budget / worker protocol ───────────────────────────────────────
export interface ToolMetrics {
  lineCount: number;
  byteCount: number;
  usesCount: number;
  resolvedCount: number;
  parseTimeMs: number;
  resolveTimeMs: number;
  truncated: boolean;
  usesScanned: number;
  usesCapHit: boolean;
  /** Scaffold-only measurement: UTF-16 characters in the analyzed text. */
  characterCount: number;
  /** Scaffold-only measurement: whitespace-delimited words. */
  wordCount: number;
}

export interface RateLimitState {
  limit: number;
  remaining: number;
  resetAt: number;
}

/**
 * The network seam. `refResolver` (M2) takes this as a REQUIRED option so
 * `_lib` never names `fetch`; the worker and the main-thread fallback each
 * supply `fetch` at their own boundary.
 */
export type FetchLike = (
  url: string,
  init?: RequestInit
) => Promise<Response>;

// ── Worker protocol ──────────────────────────────────────────────────────────
// `id` is a monotonic dispatch counter: the newest request wins, and any late
// response carrying an older id is discarded by the stale-response guard. The
// `phase` discriminator ("A" offline report · "B" network resolve follow-up)
// makes two same-id messages distinguishable — a `B` for the current id is
// accepted after its `A`; a duplicate `B` or a late `A` is dropped.
export interface WorkerInputPayload {
  id: number;
  phase: "A" | "B";
  source: string;
  resolve: boolean; // Phase B only: run the network phase (off on the typing path)
  budget: RateLimitState; // carried across the session
}

// BOTH phases post the SAME full envelope — never a partial.
export interface WorkerOutputPayload {
  id: number;
  phase: "A" | "B";
  ok: boolean;
  fatalError: string | null;
  uses: ClassifiedUses[];
  resolutions: Resolution[];
  rewrittenYaml: string | null;
  diff: UnifiedDiff | null;
  permissions: GrantTable | null;
  findings: Finding[];
  metrics: ToolMetrics;
  rateLimit: RateLimitState;
  /**
   * SCAFFOLD-ONLY: the analyzed text echoed back, which is what the
   * DiagnosticPane mirrors today. Replaced by the derived output surfaces
   * (pinned YAML / diff / findings / receipts) once the domain lands.
   */
  echo: string | null;
}
