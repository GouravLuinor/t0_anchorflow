// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — shared types + the worker protocol.
//
// ZERO runtime imports (pure `interface`/`type` only): the worker, the
// main-thread fallback and the UI all read this file, so no compiler logic can
// leak into a component bundle through it.
//
// DOMAIN SEAMS: the classification / resolution / findings / permissions /
// diff shapes below are the contract the domain agents (M1–M4) implement.
// M1 (parse / classify / rewrite / diff) has LANDED — `uses`, `rewrittenYaml`
// and `diff` are populated on the Phase-A path and the placeholder `echo`
// mirror is RETIRED: the derived surfaces are the output. `permissions` and
// `findings` are populated by the D2 audits (permissions · template-injection ·
// dangerous triggers · persist-credentials); the resolver seam
// (`FetchLike`) stays a required option so `_lib` never names `fetch`.
// Arrays ship EMPTY (never `undefined`) so the merge contract holds.
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
  | "network-error"
  /**
   * The reference was REFUSED before any request was sent: its owner / repo /
   * ref failed the resolver's path-safety check (charset, `..` traversal or an
   * unsafely long token). A value, never a silent drop and never a fetch.
   */
  | "unsafe-ref";

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

/**
 * Malformed-YAML diagnostics, carried as a VALUE (never a throw) so the worker
 * can settle `fatalError` with the parser's own line and column.
 */
export interface ParseErrorValue {
  /** Human reason, with eemeli's native suffix stripped. */
  message: string;
  /** 1-based parser line, or null when the parser gave none. */
  line: number | null;
  /** 1-based parser column, or null when the parser gave none. */
  column: number | null;
  /** Same as `message`; kept so a consumer can quote the raw reason. */
  reason: string;
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
  runStart: number | null;
  withValues: Record<string, string>;
  /** Offset of every `with:` input value, keyed like withValues (audit line cites). */
  withStarts: Record<string, number>;
  ifExpr: string | null;
  ifStart: number | null;
  persistCredentials: boolean | null; // checkout steps only
  checkoutRef: string | null; // with.ref on checkout steps
}

export interface JobNode {
  id: string;
  permissions: RawPermissionBlock | null;
  /** Offset of this job's own `permissions:` block; null when the job is UNSET. */
  permissionsStart: number | null;
  steps: StepNode[];
  uses: UsesRaw | null; // job-level reusable-workflow call (scope "job")
  withInputs: Record<string, string>; // reusable-workflow inputs
  /** Offset of every reusable-workflow input value, keyed like withInputs. */
  withInputStarts: Record<string, number>;
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
  /** Offset of the top-level `permissions:` block; null when the workflow is UNSET. */
  topPermissionsStart: number | null;
  triggers: TriggerInfo;
  jobs: JobNode[];
  uses: UsesRaw[]; // FLATTENED: step uses + job uses (scope-tagged)
  usesCap: { seen: number; scanned: number; capped: boolean };
}

// ── Resolution ───────────────────────────────────────────────────────────────
/** One hop of the resolve chain, quoted for the receipt UI. */
export interface ResolveHop {
  /** `GET /repos/{o}/{r}/git/ref/tags/{ref}` — the AC-12 path, never the host. */
  endpoint: string;
  /** The object sha this hop returned; null when it returned an error. */
  sha: string | null;
  /** HTTP status of this hop; 0 when the hop was never issued. */
  httpStatus: number;
}

export interface ResolveReceipt {
  endpoint: string; // e.g. GET /repos/{o}/{r}/git/ref/tags/{ref}
  returnedSha: string; // the FINAL commit sha
  dereferencedFrom?: string; // annotated: the tag-object sha before deref
  lsRemote: string; // git ls-remote cross-check line (peeled)
  resolvedAt: string; // ISO-8601; display-only, exempt from determinism compare
  /** Why a hop was withheld or a call failed — quoted in the findings copy. */
  note?: string | null;
  /** Every hop in call order, so the UI renders `<endpoint> → <sha> → <sha>`. */
  chain?: ResolveHop[];
}

export interface Resolution {
  ref: ClassifiedUses;
  resolvedSha: string | null;
  status: ResolveStatus;
  receipt: ResolveReceipt | null;
  /** D3 — the chain's every endpoint, in call order (AC-12 receipt trail). */
  endpointsUsed?: string[];
  /** D3 — the final commit sha, when the chain resolved one. */
  commitSha?: string | null;
  /** D3 — the annotated tag's own object sha, before the dereference. */
  tagObjectSha?: string | null;
  /** D3 — the annotated tag's object sha, spelled the receipt's way. */
  dereferencedFrom?: string | null;
  /** D3 — which ref namespace the chain resolved through. */
  refKind?: "tag" | "branch" | null;
  /** D3 — the deciding response's HTTP status (null when cache-served). */
  httpStatus?: number | null;
}

// ── Findings — ONE canonical array ───────────────────────────────────────────
/**
 * Severity ladder, worst-first. The four grades render as the four finding
 * bands critical · major · minor · info (SPEC §4 F5-F8 name the same grades
 * error / warn / info for the audits each grade belongs to).
 */
export type Severity = "error" | "warn" | "minor" | "info";

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
  /** The most specific untrusted context found at the site. */
  contextPath: string;
  severity: Severity;
  remediation: string;
  source: "run" | "with" | "if";
  /** 1-based step index, or null for a job-level `with:` input. */
  stepIndex: number | null;
  /** Every untrusted context the site carries, most specific first. */
  contextPaths: string[];
  /** The finding copy for this sink (the `Finding.detail` it maps to). */
  detail: string;
  start: number | null;
}

// ── Diff ─────────────────────────────────────────────────────────────────────
export interface UnifiedDiffLine {
  /** `context` = unchanged · `add` = only in `after` · `del` = only in `before`. */
  kind: "context" | "add" | "del";
  text: string;
  /** 1-based line in `before`; null for an added line. */
  beforeLine: number | null;
  /** 1-based line in `after`; null for a deleted line. */
  afterLine: number | null;
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
  /** `uses:` nodes the collector saw, scanned or not (the cap never hides them). */
  usesSeen: number;
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
}
