# Anchorflow — Architecture (ARCHITECTURE.md)

> Companion to `SPEC.md` and `PLAN.md`. Mirrors RegexCraft's structure
> (`regex-craft/docs/blueprint.md`) exactly where the workload is sync
> (watchdog/stale-guard/fallback), and diverges where it isn't (Anchorflow adds an
> **async resolve phase** that talks to `api.github.com`).

---

## 1. Stack & reasoning

| Layer | Choice | Why (Anchorflow-specific) |
|---|---|---|
| Framework | **Next.js 15 App Router** (`^15.5.x`) + **React 19** + TS `strict` | Sibling parity; App Router root `redirect()`; standalone output for PM2/Docker. |
| TS | `strict: true`, `moduleResolution: "bundler"`, `paths: { "@/*": ["./*"] }` | Copy regex-craft `tsconfig.json`. |
| Styling | **Tailwind `^3.4`** + `tailwindcss-animate` + Matchlight tokens | Dual-theme token ladder, one accent, inverted zinc. |
| State | **zustand `^5`** | Persist content-only; atomic single-`set()` settle. |
| Theming | **next-themes `^0.4`** | Per-tool `storageKey="anchorflow-theme"`. |
| YAML | **eemeli `yaml` `^2.9`** (`Document` API, `keepSourceTokens`) | **Only** library that preserves comments/formatting. js-yaml cannot round-trip comments — forbidden. |
| Compute | **Web Worker** + pure `_lib` core | Off-main-thread; never freeze the UI. |
| Tests | **vitest `^4`** (node) + **@playwright/test `^1.6x`** | Pure-core unit suites; e2e on the real standalone artifact. |
| Lint | **eslint `^9`** flat config | `no-explicit-any: error`, strict unused-vars. |
| Runtime egress | `fetch` → `api.github.com`, **browser-direct** | The tool's ONLY third-party origin, called by the visitor's browser (CSP `connect-src`). Optional Supabase auth (env-gated) is inert by default. |

Bundle budget: initial page JS ≤ 200 kB (`context.md` §1.1). The `yaml` package is
imported **only** inside `_lib` (worker + fallback), never in a component, so it
stays off the first-load path.

**`_lib` is IO-free (BAR item 8).** `_lib` never performs network IO, never touches
the DOM, and **never names `fetch` or `globalThis.fetch`**. `refResolver`'s
`fetchImpl` is therefore a **required** option — the worker
(`_workers/compute.worker.ts`) and the main-thread fallback (`_hooks/useToolWorker.ts`
→ `degradeToMainThread`) each supply `fetch` at their own boundary, which is also
the test seam. Enforced by a source-scan test (SPEC §9 AC-16).

---

## 2. Design system

Matchlight token ladder is reused verbatim (canvas/ink/surface ladder, one
`brand-lime` accent, semantic-only violet/amber/rose, inverted zinc neutral, the
craft-floor rules, five interaction states). Anchorflow maps the semantic colors
to its own meaning, as the shipped `_components/DiagnosticPane.tsx` renders them:
- **lime** = pinned / match / primary / the privacy promise.
- **violet** = **pending resolution** (a ref the resolver has not dispatched yet)
  and **minor** severity in the findings bands.
- **amber** = warn / degraded / truncation / the `uses:` scan cap / the rate-limit
  banner.
- **rose** = error finding / copy-failure toast / a ref refused by the path-safety
  gate.
Ink-on-canvas is measured `>10:1` in both themes and the secondary/muted zinc
steps clear `4.5:1` on the surfaces they render on — computed from the shipped
`app/globals.css` values by `app/tools/anchorflow/__tests__/contrast.test.ts`.
Full surface semantics: `docs/DESIGN.md`.

---

## 3. Module map — exact `_lib` boundaries & signatures

Folder rules (mirror regex-craft): `_lib` is **pure** (no React/DOM/IO); `_workers`
imports **only** `_lib`; `_components` may import `_lib`+`_store`, never the reverse.
`_lib/types.ts` has **zero runtime imports** (pure `interface`/`type` + worker
protocol).

```
app/tools/anchorflow/
  _lib/                                   21 modules — pure, no React / DOM / IO / fetch
    types.ts            zero-import types + worker protocol
    constants.ts        EVERY cap/budget/deadline constant (single grep site, ARCH §7.1)
    textMetrics.ts      bytes/words/lines, the code-point-safe truncation, the dispatch cap
    yamlParse.ts        source -> WorkflowModel (structure + offsets), parse errors as values
    classify.ts         UsesRaw -> ClassifiedUses (6 classes x 2 scopes)
    permissionAudit.ts  WorkflowModel -> Finding[] (over-broad grants, token coupling)
    grantTable.ts       WorkflowModel -> GrantTable (effective scope per job, UNSET aware)
    injectionDetect.ts  WorkflowModel -> InjectionSink[] (-> template-injection findings)
    triggerAudit.ts     dangerousTriggerAudit + persistCredentialsAudit
    actionCatalog.ts    per-action / per-job guidance knowledge (guide, scopes, untrusted refs)
    findings.ts         severity bands + legend, canonical sort, formatters
    analyze.ts          PHASE A: the whole offline pipeline (parse -> ... -> diff -> metrics)
    compute.ts          runPhaseA + analyzeResolve (Phase B) + resolutionFindings (shared)
    refResolver.ts      ClassifiedUses -> Resolution[] (async, path-safe, fetch seam)
    rewrite.ts          source + resolutions -> pinned string, offset-surgical edits
    diff.ts             before/after -> UnifiedDiff (LCS line diff)
    presets.ts          DEFAULT_WORKFLOW + TRUST_PILLS (single source for both)
    guide.ts            GUIDE_TABS (KnowledgeHub content, one array)
    authGate.ts         shouldPromptSignIn policy
    protocol.ts         monotonic id + phase rank guard (isStaleDispatch / acceptDispatch)
    supabaseClient.ts   env-gated lazy OAuth client (no IO without keys)
    __tests__/*.test.ts
  _workers/compute.worker.ts
  _hooks/useToolWorker.ts
  _store/useToolStore.ts
```

The 21 modules are exactly what `ls app/tools/anchorflow/_lib/*.ts` prints;
`README.md` carries the per-module export table, and this section pins the
boundaries and the signatures the rest of the doc refers to.

### 3.1 `types.ts` (zero runtime imports)

```ts
// ── Classification ──
export type UsesClass = "sha40" | "sha256" | "remoteRef" | "local" | "docker" | "invalid";
export type UsesScope = "step" | "job";          // job = jobs.<id>.uses (reusable workflow call)
export type ResolveStatus =
  | "not-requested" | "resolved" | "unknown-ref" | "rate-limited"
  | "network-error"
  /** Refused BEFORE any request: the owner/repo/ref failed the path-safety
   *  check. A value, never a silent fetch and never a silent drop. */
  | "unsafe-ref";

export interface UsesRaw {
  id: string; jobId: string; scope: UsesScope;
  stepIndex: number | null;                     // null when scope === "job"
  raw: string;                                  // the UNQUOTED scalar text
  start: number;                                // scalar start offset in source
  valueEnd: number;                             // offset AFTER the value (past closing quote if quoted)
  existingComment: string | null;               // trailing comment text on the line, if any
}
export interface ClassifiedUses extends UsesRaw {
  cls: UsesClass;
  owner: string | null; repo: string | null; subpath: string | null; ref: string | null;
  moving: boolean;                              // MOVING_REFS membership OR /^v?\d+$/
}

// ── Workflow structure (from yamlParse — collected STRUCTURALLY, never by key name) ──
export interface StepNode {
  index: number;
  usesRaw: string | null; usesStart: number | null; usesValueEnd: number | null;
  usesComment: string | null;
  run: string | null; withValues: Record<string, string>; ifExpr: string | null;
  persistCredentials: boolean | null;    // checkout steps only
  checkoutRef: string | null;            // with.ref on checkout steps
}
export interface JobNode {
  id: string; permissions: RawPermissionBlock | null; steps: StepNode[];
  uses: UsesRaw | null;                  // job-level reusable-workflow call (scope "job")
  withInputs: Record<string, string>;    // reusable-workflow inputs (injection-scanned)
}
export interface TriggerInfo { pullRequestTarget: boolean; workflowRun: boolean; }
export interface RawPermissionBlock { all?: "read" | "write"; scopes: Record<string, "read" | "write" | "none">; }
export interface WorkflowModel {
  ok: boolean; error: string | null;       // malformed-YAML message; errors-as-values
  topPermissions: RawPermissionBlock | null;
  triggers: TriggerInfo;
  jobs: JobNode[];
  uses: UsesRaw[];                         // FLATTENED: step uses + job uses (scope-tagged)
  usesCap: { seen: number; scanned: number; capped: boolean };
}

// ── Resolution ──
export interface ResolveReceipt {
  endpoint: string;          // e.g. GET /repos/{o}/{r}/git/ref/tags/{ref}
  returnedSha: string;       // the FINAL commit sha
  dereferencedFrom?: string; // annotated: the tag-object sha before deref
  lsRemote: string;          // git ls-remote cross-check line (peeled)
  resolvedAt: string;        // ISO-8601; display-only, exempt from determinism compare
}
export interface Resolution {
  ref: ClassifiedUses;
  resolvedSha: string | null;
  status: ResolveStatus;
  receipt: ResolveReceipt | null;
  endpointsUsed?: string[];          // every API path ISSUED, in call order (AC-12)
  commitSha?: string | null;         // the final commit sha
  tagObjectSha?: string | null;      // the annotated tag's own object sha
  dereferencedFrom?: string | null;  // same sha, spelled the receipt's way
  refKind?: "tag" | "branch" | null;
  httpStatus?: number | null;        // deciding status; null when cache-served
}

export interface ToolMetrics {
  lineCount: number; byteCount: number;        // byteCount = the ORIGINAL size
  usesCount: number; resolvedCount: number;
  parseTimeMs: number; resolveTimeMs: number;
  truncated: boolean;
  usesSeen: number; usesScanned: number; usesCapHit: boolean;   // the scan cap
  characterCount: number; wordCount: number;
}

// ── Findings — ONE canonical array (injection sinks are template-injection findings) ──
export type Severity = "error" | "warn" | "minor" | "info";   // four bands
export type FindingCategory =
  | "unpinned-uses" | "template-injection" | "excessive-permissions"
  | "dangerous-trigger" | "persist-credentials" | "moving-ref" | "resolution";
export interface Finding {
  id: string;                // "<category>:<jobId>:<stepIndex|job>:<n>" — deterministic
  category: FindingCategory; severity: Severity;
  title: string; detail: string; remediation: string; where: string;
  evidence?: string; receipt?: ResolveReceipt;
  start: number | null;      // source offset of primary evidence; null sorts LAST
}
export interface GrantRow { scope: string; level: "read" | "write" | "none"; source: "top" | `job:${string}`; }
export interface GrantTable {
  top: RawPermissionBlock | null;
  jobs: Array<{ jobId: string; block: RawPermissionBlock | null }>;
  effective: GrantRow[];
  unset: boolean;
}

// ── Injection (detector output; mapped into Finding[] by compute.ts) ──
export interface InjectionSink {
  id: string; where: string; expression: string; contextPath: string;
  severity: Severity; remediation: string; source: "run" | "with" | "if";
  start: number | null;
}

// ── Diff ──
export interface UnifiedDiffLine { kind: "context" | "add" | "del"; text: string; }
export interface UnifiedDiff { changed: number; lines: UnifiedDiffLine[]; }

// ── Metrics / budget / worker protocol ──
export interface ToolMetrics {
  lineCount: number; byteCount: number; usesCount: number;
  resolvedCount: number; parseTimeMs: number; resolveTimeMs: number;
  truncated: boolean;
  // The scan cap, reported so the UI can say how much it did NOT read.
  usesSeen: number; usesScanned: number; usesCapHit: boolean;
  characterCount: number; wordCount: number;
}
export interface RateLimitState { limit: number; remaining: number; resetAt: number; }

// Worker protocol: the phase discriminator makes two same-id messages distinguishable.
export interface WorkerInputPayload {
  id: number;
  phase: "A" | "B";          // "A" = offline report; "B" = network resolve follow-up
  source: string;
  resolve: boolean;          // Phase B only: run the network phase (off on the typing path)
  budget: RateLimitState;    // carried across the session
}
// BOTH phases post the SAME full envelope — never a partial.
export interface WorkerOutputPayload {
  id: number; phase: "A" | "B";
  ok: boolean; fatalError: string | null;
  uses: ClassifiedUses[]; resolutions: Resolution[];
  rewrittenYaml: string | null; diff: UnifiedDiff | null;
  permissions: GrantTable | null; findings: Finding[];
  metrics: ToolMetrics; rateLimit: RateLimitState;
}
```

> **There is no separate `sinks` output channel.** Injection sinks are emitted as
> `template-injection` **findings**, so the report is one array and the determinism /
> merge criteria (AC-10, AC-15) cover it end to end.

### 3.2 `yamlParse.ts`
```ts
// ParseErrorValue = { message, line, column, reason } — the parser's reason
// with its native "at line L, column C" suffix stripped.
export type { ParseErrorValue } from "./types";
export interface ParseCaps { maxInputBytes?: number; maxUsesScan?: number; }
export interface ParseOptions { caps?: ParseCaps; }
export type ParseResult =
  | { ok: true; model: WorkflowModel }
  | { ok: false; error: ParseErrorValue };
export function yamlParse(source: string, options?: ParseOptions): WorkflowModel;
export function parseWorkflow(source: string, options?: ParseOptions): ParseResult;
export function parsePermissionBlock(node: unknown): RawPermissionBlock | null;
// `parseWorkflow` is the errors-as-value form; `yamlParse` unwraps it. Caps have
// defaults, so the empty source short-circuits without invoking the parser.
// `parsePermissionBlock` reads whichever permission block exists — top-level or
// per-job — and normalises both `permissions: read-all` and the per-scope map.
// Null when the key is absent, which is how the UNSET grant table gets its
// signal: `{}` is the least-privilege shape and is reported as such, not as an
// error.
```
eemeli `parseDocument(source, { keepSourceTokens: true })`. One structural traversal:
walk `jobs` → for each job collect job-level `uses` and `steps[]` → for each step
collect `uses`, `run`, `with`, `if`, checkout details; collect top-level and per-job
`permissions:` (→ `RawPermissionBlock`) and the trigger set. **Keys are read only at
their known structural positions** — a `with:` input named `uses` is never collected
as a `uses:` node (AC-1). `valueEnd` for a quoted scalar is the offset **after the
closing quote**. Malformed YAML ⇒ `{ ok:false, error }` (message with line/col lifted
from the parser, native prefix stripped) — a **value, never a throw**.

Truncation at `MAX_INPUT_BYTES` walks the string advancing **whole code points** (a
surrogate pair is 4 UTF-8 bytes and is never cut in half), and reports the
**original** byte count via `metrics.byteCount`.

`usesCap` records `{ seen, scanned, capped }`: collection stops at
`MAX_USES_SCAN` nodes but keeps counting `seen`, so the report can say "scan capped at
N — M further nodes not analyzed" and **never silently drops** the remainder.

### 3.3 `classify.ts`
```ts
export const MOVING_REFS: readonly string[];   // main master HEAD trunk develop latest
export const FLOATING_MAJOR_RE: RegExp;        // /^v?\d+$/
export const SHA40_RE: RegExp;                  // /^[0-9a-f]{40}$/
export const SHA256_RE: RegExp;                 // /^[0-9a-f]{64}$/
export function isMovingRef(ref: string): boolean;
export function isLocalPath(raw: string): boolean;    // `./` or `../` prefixed
export function isDockerRef(raw: string): boolean;    // `docker://` prefixed
export function splitRemoteRef(raw: string): RefParts | null;   // last `@` split
export function classifyOne(raw: string, meta: Omit<UsesRaw, "raw">): ClassifiedUses;
export function classifyUses(raws: UsesRaw[]): ClassifiedUses[];
export interface ClassSummary;                  // per-class counts for the class table
export function summarizeClasses(uses: readonly ClassifiedUses[]): ClassSummary[];
```
Regex/split-based, no network. `remoteRef` split on the **last** `@` (SHAs and
paths never contain `@`); `owner/repo[/subpath]@ref`. **Adjudicated moving rule
(verbatim):** `moving = (ref matches ^v?\d+$) OR ref ∈ {main, master, HEAD, trunk,
develop, latest}`. `@v4.2.0` / `@4.2` / `@1.2.3-rc.1` are **not** moving; `@v4` /
`@4` / `@latest` **are**.

### 3.4 `refResolver.ts`
```ts
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export interface ResolveOptions {
  fetchImpl: FetchLike;                 // REQUIRED — no hidden globalThis.fetch default (M11)
  concurrency?: number;                 // default MAX_RESOLVE_CONCURRENCY
  budget: RateLimitState;
  reserveFloor?: number;                // stop fanning when remaining - inFlight <= this
  signal?: AbortSignal;                 // the worker's single Phase-B controller
  deadlineMs?: number;                  // total wall-clock budget for the fan-out
  cache?: Map<string, string>;          // "owner/repo@ref" -> commit sha (LRU by caller)
  negativeTtlMs?: number;               // default RESOLVE_NEGATIVE_TTL_MS
  now?: () => number;                   // injectable clock (tests / determinism)
}
export async function resolveRefs(
  refs: ClassifiedUses[], options: ResolveOptions
): Promise<{ resolutions: Resolution[]; budget: RateLimitState }>;
```
Dedupes by `owner/repo@ref` (subpath dropped). Worker-pool of `concurrency`. Per ref:
tag chain (§4 F3) then heads fallback; annotated deref when `type==="tag"`.

**Budget accounting (adjudicated, optimistic).**
- `budget.remaining` is decremented **optimistically at dispatch**, and `inFlight`
  counts dispatched-but-unsettled calls, so a concurrent burst cannot overspend.
- **Dispatch gate:** a ref is dispatched **only** when
  `budget.remaining - inFlight > reserveFloor`.
- **2 units per dispatch:** 1 for the chain GET + 1 **reserved for the annotated
  deref**. The reserved unit is released the moment a ref resolves without a deref.
- On settle, `inFlight--`. If the annotated deref would land at/below the floor it
  is skipped and that ref is marked `rate-limited` with the endpoint in the receipt
  — never a silent drop.
- 404 → `unknown-ref`. `fetch` throw / non-2xx-otherwise / offline → `network-error`.
- **Rate-limit attribution:** parse `x-ratelimit-remaining` / `-limit` / `-reset` /
  `-resource` first; then `Retry-After` (delta-seconds or HTTP-date). Only a 403/429
  carrying `x-ratelimit-remaining: 0` is labelled the **hourly** limit; a
  rate-headless 403 is "temporarily blocked" and honours `Retry-After`.
- **Negative TTL:** an uncached 404 is cached (status-only, no sha) for
  `RESOLVE_NEGATIVE_TTL_MS` so a repeated typo does not re-spend quota in-session;
  successes are cached in the success LRU (`RESOLVE_CACHE_CAPACITY`) and served with
  **zero** quota spend.
- **Timeout:** each request uses an `AbortController` at `RESOLVE_TIMEOUT_MS`; the
  whole fan-out honours `deadlineMs`, and `options.signal` (the worker's Phase-B
  controller) aborts the entire in-flight fan-out.

### 3.5 `permissionAudit.ts` + `grantTable.ts`
```ts
export function permissionAudit(model: WorkflowModel): Finding[];
export function jobAnchor(job: JobNode): number | null;      // source offset of the job head
export const TOKEN_COUPLING_SCOPES: readonly string[];

// grantTable.ts
export function buildGrantTable(model: WorkflowModel): GrantTable;
export function effectiveJobGrants(model: WorkflowModel): GrantRow[];
export function expandBlock(block: RawPermissionBlock | null): Record<string, …>;
export function blockScopes(block: RawPermissionBlock | null): string[];
export function describeGrant(scope: string, level): string; // plain-English semantics
export function scopeSemantics(scope: string): string;
export const PERMISSION_SCOPES: readonly string[];
```
Effective scope resolution (job block overrides top per scope; `all: write`/`read`
as a shorthand; omitted scope = absent). The grant table is emitted for EVERY
workflow: a missing permissions block is an **UNSET** table (`unset: true`,
`top: null`), which is the information the audit reports — `{}` at top level is
the least-privilege shape and is reported as such, not as an error.

### 3.7 `injectionDetect.ts`
```ts
export const UNTRUSTED_CONTEXTS: ReadonlyArray<{ path: string; severity: Severity; note: string }>;
export const SAFE_CONTEXT_PREFIXES: readonly string[];
export function injectionDetect(model: WorkflowModel): InjectionSink[];
```
**Whole-expression tokenization.** The scanner tokenizes the **entire** `${{ … }}`
body (or the entire bare `if:` string; a redundant wrapping `${{ … }}` is stripped
first) into identifier/path tokens — walking quotes, parens, brackets, dots, `*` and
index syntax — so an untrusted context is found anywhere: a nested function argument
`format('{0}', github.event.issue.title)`, a splat
`join(github.event.commits.*.message)`, string concatenation
`"t-${github.event.issue.title}"`, a ternary, an index. It is **not** limited to a
leading context path. Sources are step `run`, step `with`, job-level `with`, and `if`.
Match against `UNTRUSTED_CONTEXTS` (error) or the generic `github.event.*` bucket
(warn); skip when the token starts with a `SAFE_CONTEXT_PREFIXES` member.
**Dedupe (adjudicated):** the sink severity is the maximum over its tokens — an
enumerated ERROR context yields **exactly one** `error`, never error+warn.
Remediation: "move to `env:` then reference `${VAR}`"; `if:`-sourced findings carry
the `if:`-specific remediation. Backed by AC-7 (both poles + whole-expression +
dedupe).

### 3.8 `triggerAudit.ts`
```ts
export function dangerousTriggerAudit(model: WorkflowModel): Finding[];
export function persistCredentialsAudit(model: WorkflowModel): Finding[];
```
PR-target/workflow-run + checkout-at-PR-head; token/permission coupling;
`persist-credentials` true/absent-with-risk.

### 3.9 `rewrite.ts` (offset surgical — the crux)
```ts
export interface RewriteEdit { start: number; valueEnd: number; text: string; }
export type ResolutionInput =
  | readonly Resolution[] | ReadonlyMap<string, Resolution> | Iterable<Resolution>;
export function toResolutionMap(input: ResolutionInput | null | undefined): Map<string, Resolution>;
export function offsetsStillHold(source: string, uses: ClassifiedUses): boolean;
export function isPinnable(resolution: Resolution): resolution is PinnableResolution;
export function buildRewriteEdits(
  source: string,
  resolutions: ResolutionInput | null | undefined,   // the SOURCE comes FIRST
  classify?: readonly ClassifiedUses[]
): RewriteEdit[];
export function applyEdits(source: string, edits: RewriteEdit[]): string;   // right-to-left
export function pinScalar(uses: ClassifiedUses, sha: string): string;
export function applyPin(source: string, uses: ClassifiedUses, pin: PinSpec): RewriteEdit;
export function yamlRewrite(source: string, resolutions: ResolutionInput | null | undefined): string;
```
Only `resolved` resolutions become edits, and **only for `remoteRef` inputs** — a
`sha40`/`sha256` node is never an edit, so re-pinning the tool's own output is a
**zero-diff, idempotent** re-run. `offsetsStillHold` re-checks that the bytes at the
recorded range are still that node's own scalar, so a stale resolution replayed
against different source can never splice a SHA into the wrong offset.

`edit.text = owner/repo[/subpath]@<sha> # <ref>` — a **single space** before `#`
(GitHub's / Dependabot's own pin format). The replacement is always an **unquoted
plain scalar**: hex + `@` + ` # ` are all plain-safe in YAML, so a previously quoted
`uses: "owner/repo@v1"` is emitted as `uses: owner/repo@<sha> # v1`, with the
annotation **after** the (removed) closing-quote position recorded in `valueEnd`.

**Existing trailing comments (adjudicated, no data loss):**
- If the line already carries a trailing comment whose text (trimmed) **exactly
  equals** the original ref token → the comment is replaced in place (no doubling).
- **Otherwise the user's comment is preserved verbatim** and ` # <ref>` is appended
  after it (e.g. `- uses: o/r@sha # needed for CI # v4`). No comment is ever
  overwritten or destroyed.

`applyEdits` sorts by `start` desc and splices, so untouched bytes (comments, flow
spacing, blank lines) are preserved byte-for-byte — the property AC-2/AC-3 lock in.
Overlapping edits are dropped rather than corrupting the output.

### 3.10 `diff.ts`
```ts
export const DIFF_CONTEXT_LINES = 3;
export function unifiedUsesDiff(before: string, after: string): UnifiedDiff;
```
Compact, deterministic LCS over lines; emit hunks with 3 lines of context; `+`/`-`
pairs. No external dependency (keeps the worker bundle small). Pure/unit-tested.

### 3.11 `analyze.ts` — Phase A, one function, the whole offline pipeline

```ts
export type ReportBody = Omit<WorkerOutputPayload, "id" | "phase">;
export interface AnalyzeOptions { now?: () => number }   // injectable clock
export function analyzeLocal(source: string, options?: AnalyzeOptions): ReportBody;
export function parseErrorCopy(error: ParseErrorValue, phase, engine): string | null;
export function isOverDeadline(metrics: ToolMetrics, deadlineMs: number): boolean;
export { EMPTY_METRICS, ANALYZE_TIMEOUT_ERROR } from "./constants";
```

`analyzeLocal` IS the offline report: cap the input → `yamlParse` → `classifyUses`
→ the four audits (`permissionAudit`, `injectionDetect`, `dangerousTriggerAudit`,
`persistCredentialsAudit`) → `unpinned-uses` / `moving-ref` / class-note findings →
`buildGrantTable` → the no-op `yamlRewrite` (byte-identical with no resolutions,
AC-2) → `unifiedUsesDiff` (empty, AC-9) → metrics. It returns `ok: true` even for a
malformed workflow: the parse error rides the envelope as a `ParseErrorValue`.

### 3.12 `compute.ts` (pipeline, shared by worker AND fallback)
```ts
export function runPhaseA(source: string): ReportBody;                          // = analyzeLocal
export async function analyzeResolve(
  phaseA: ReportBody,                       // the Phase-A report to MERGE — the first input
  options: PhaseBOptions = {}
): Promise<ReportBody>;                     // Phase B (async) → FULL ENVELOPE
export interface PhaseBOptions {
  fetchImpl?: FetchLike;    // supplied at the boundary; absent ⇒ merge-contract no-op
  resolve?: boolean;        // actually spend quota — false ⇒ Phase B never leaves the origin
  budget?: RateLimitState;
  concurrency?: number;
  cache?: Map<string, string>;         // success LRU
  negativeCache?: Map<string, number>; // negative TTL store
  signal?: AbortSignal;                // the worker's single Phase-B controller
  now?: () => number;                  // injectable clock, BOTH timings and receipts
  deadlineMs?: number;
}
export function resetCountdown(resetAt: number, nowMs: number): string;
export function resolutionFindings(
  resolutions: readonly Resolution[],
  budget: RateLimitState,
  nowMs: number                            // INJECTED — the only clock these findings read
): Finding[];
export function toOutputPayload(body: ReportBody, dispatch: { id: number; phase }): WorkerOutputPayload;
```
Single source of semantics: the worker and the main-thread fallback both call these,
so the two paths cannot drift. Phase A never touches the network; Phase B is the only
fetch site, and `fetchImpl` is injected from outside `_lib`.

**DETERMINISM (AC-15):** `resolutionFindings` takes the `nowMs` the caller injects —
the same one `refResolver` stamps receipts with — and never reads the ambient clock,
so two runs over the same inputs produce byte-identical findings, including a
future-dated 429 fixture whose countdown would otherwise track the wall clock.
`_lib/__tests__/analyzeResolve.test.ts` pins that with a serialization compare.

**`analyzeResolve` merge contract (C1 — the invariant a builder must not break):**

1. `analyzeResolve` **takes the Phase-A report** as its first merge input.
2. It returns the **merged full envelope**, never a partial `Pick`:
   - `uses` = `phaseA.uses` (Phase B never reclassifies; resolution lands in
     `resolutions`).
   - `permissions` = `phaseA.permissions` (never re-derived, never `undefined`).
   - `findings` = `[...phaseA.findings, ...phaseBFindings]` then sorted into the
     canonical order (§ AC-10). Reads are defensive: if an incoming Phase-A array is
     somehow `undefined`, the merge **must not** store `undefined`/`[]` over the
     offline report — the offline report's arrays are preserved.
   - `ok` = `phaseA.ok` — a Phase-B 404/429/offline **never** flips `ok` to `false`.
   - `rewrittenYaml` / `diff` = recomputed from the resolutions.
   - `metrics` = merged (Phase-A `parseTimeMs` kept, `resolveTimeMs` added,
     `resolvedCount` set).
   - `rateLimit` = the post-fan-out budget.
3. Phase B emits only `resolution`-category findings (resolved / unknown-ref /
   rate-limited / network-error + receipts).

---

## 4. Worker & async-resolve design

Anchorflow's compute is a **parse + async-resolve pipeline**, so it diverges from
RegexCraft's single synchronous dispatch. It splits into two phases that share the
monotonic-id stale guard but use **different liveness strategies**, because a hanging
parse (native, uninterruptible) and a slow network (abortable) are different animals.

**The six design points:**

1. **Two-phase worker (`compute.worker.ts`) with a `phase` discriminator.** Every
   message carries `phase: "A" | "B"`, so two messages with the same monotonic `id`
   (A then B) are distinguishable. On each message: run **Phase A**
   (`analyzeLocal` — parse·classify·pinning·permissions·injection·danger·moving-refs,
   zero network) synchronously under `WORKER_DEADLINE_MS`, post it. If `input.resolve`
   is true and there are `remoteRef`s, run **Phase B** (`analyzeResolve`) and post it.
   **Stale guard with phase rank:**
   ```ts
   const PHASE_RANK = { A: 1, B: 2 } as const;
   const drop =
     msg.id < requestIdRef.current ||
     (msg.id === requestIdRef.current &&
       PHASE_RANK[msg.phase] <= PHASE_RANK[lastPhaseRef.current]);
   if (drop) return;                    // stale or replay (B twice, or A after B)
   requestIdRef.current = msg.id; lastPhaseRef.current = msg.phase;
   ```
   Phase A is subject to the **1.5 s watchdog** (`WATCHDOG_MS`: terminate + respawn,
   degrade path).
2. **Single in-flight Phase B (worker-scope `AbortController`).** The worker holds one
   module-scope controller. At the start of **every** Phase B:
   ```ts
   phaseBController?.abort();                 // never two resolves in flight
   const controller = new AbortController();
   phaseBController = controller;
   ```
   The signal flows into `analyzeResolve(..., { signal })` → `resolveRefs` →
   `fetchImpl(url, { signal })`. A second dispatch (or a newer Phase A, or
   teardown/degade) aborts the in-flight fan-out, so the hourly budget is never
   double-spent on a superseded request. **Phase B never arms the
   terminate-watchdog** — network is abortable, so it uses the `AbortController` +
   `RESOLVE_BUDGET_MS` and always settles with per-ref statuses rather than being
   killed.
   **Watchdog lifecycle (adjudicated, pinned):**
   | Moment | `WATCHDOG_MS` terminate timer | Phase-B `AbortController` |
   |---|---|---|
   | dispatch (message posted) | **arm** | — |
   | Phase A posts (`ok` or `fatalError`) | **clear** | — |
   | Phase B dispatched | **never armed** | previous aborted; new created + passed as `signal` |
   | Phase B posts | (already clear) | retained, marked settled; abort is a no-op |
   | any newer message arrives mid-Phase-B | never armed | in-flight Phase B is **aborted** |
   | `degradeToMainThread()` | clear | aborted |
   A stray timer therefore can never kill a mid-fetch Phase B.
3. **Concurrency cap + optimistic 60/hr budget accounting.** `resolveRefs` runs a
   worker pool of `MAX_RESOLVE_CONCURRENCY = 4` over the dedup'd queue.
   `RateLimitState` is seeded from the first response's
   `X-RateLimit-Limit/Remaining/Reset` and updated after every call; **before each
   dispatch** the pool checks `remaining - inFlight > reserveFloor` (2 units reserved
   per dispatch for the annotated deref) and, if not, leaves the rest `rate-limited`
   (no more calls). Budget lives at module scope in the worker so it survives across
   keystrokes and the session never overspends the visitor's own hourly quota.
4. **Resolve LRU cache + short negative TTL.** `Map<"owner/repo@ref", sha>` capped at
   `RESOLVE_CACHE_CAPACITY = 64`, true-LRU by delete+reinsert on hit, **successes
   only** (404/rate-limit re-attempt next run, except an uncached 404 that is
   negatively cached for `RESOLVE_NEGATIVE_TTL_MS`). This is what makes re-typing
   cheap: an already-resolved ref is served from cache with zero quota spend.
5. **Debounce tiers — two clocks.** Phase A mirrors RegexCraft adaptive debounce by
   source length (`≤5k→0 ms`, `>5k→40 ms`, `>20k→120 ms`) so typing feels instant.
   Phase B is **deliberately decoupled from typing**: it debounces
   `RESOLVE_DEBOUNCE_MS = 500` after the last edit **and** is deduped by the LRU,
   because every resolve spends the hourly budget — it must not fire on every
   keystroke. **`autoResolve` defaults to `false`** (persisted, user opt-in), so the
   default path makes **zero** network calls until the visitor asks. There is also an
   explicit **"Resolve & pin"** affordance for a user-initiated, deadline-aware
   resolve.
6. **Stale guard + partial-preserve settle.** Every message carries the monotonic
   `id` (+ `phase`); the guard in point 1 is the first statement. Phase A settles
   (`applyResult`) immediately so permissions/injection/moving-ref findings
   paint before any network; Phase B settles in a **second atomic `set()`** that
   **field-merges into the current report** (each field is taken from the payload
   only when it is defined; a partial or empty payload therefore **cannot blank the
   offline report**). A rate-limit/offline Phase B therefore **never wipes Phase A's
   offline report** (the SPEC §4 F3 promise).

`useToolWorker.ts` owns: initial spawn, rehydrate (`useToolStore.persist.rehydrate()`),
debounce schedules for both phases, the watchdog (Phase A only), `degradeToMainThread`
(worker `onerror`/`onmessageerror`/watchdog → amber banner + **same pure core** on the
main thread at `SYNC_DEADLINE_MS`, with `fetch` supplied there), and the trailing
800 ms success announcement. Constants kept verbatim-in-spirit:
`WATCHDOG_MS = 1500`, `SUCCESS_ANNOUNCE_DEBOUNCE_MS = 800`, `WORKER_DEADLINE_MS =
1000`, `SYNC_DEADLINE_MS = 800`.

---

## 5. State — zustand store (`useToolStore.ts`)

One tool store + one auth-prompt store (mirror regex-craft).

| Field | Kind | Notes |
|---|---|---|
| `workflow` (source YAML) | **persisted** | seeded from `DEFAULT_WORKFLOW`; `partialize` = `{ workflow }` |
| `autoResolve` (bool) | **persisted** | user opt-in for the network phase; **defaults `false`** |
| `report` (uses/resolutions/diff/permissions/**findings**/rewrittenYaml) | transient | the settled output — one findings array, no `sinks` channel |
| `metrics` | transient | line/byte counts, timings, uses-scan counts |
| `isProcessing`, `resolveStatus` | transient | pipeline busy; Phase B status idle/running/limited/offline |
| `errorMessage` | transient | fatal (malformed/oversize) copy |
| `isWorkerAvailable` | transient | `null`/`true`/`false` |
| `rateLimitState` | transient | current budget (start seeded from a constant) |
| palette/ui booleans, `statusAnnouncement` | transient | `{ message, seq }` |

Persist config (copy regex-craft): key `anchorflow-tool-storage`, `version: 1`,
`skipHydration: true`, `createJSONStorage(() => localStorage)`, defensive `merge()`.
**Atomic settle:** `applyResult(payload)` sets report + metrics + error +
announcement in a **single** `set()`; error results clear stale output.
**Field-merge guard:** `applyResult` takes each report field from the payload only
when it is defined (`payload.findings ?? report.findings`, etc.), so a Phase-B or
fallback envelope that omits a field preserves the offline report instead of blanking
it. Theme (`anchorflow-theme`) and content (`anchorflow-tool-storage`) are **never
merged**.

---

## 6. Data-flow diagram

```
 paste/seed DEFAULT_WORKFLOW   (autoResolve = false ⇒ NO network yet)
         │
         ▼
 [debounce by size]  ──►  _workers/compute.worker.ts (id = monotonic, phase = "A")
                              │
                    PHASE A  ─┴─ analyzeLocal(source)   [sync, no network, watchdog 1.5s ARMED]
                              │   yamlParse → classify → permissionAudit → grantTable
                              │   → injectionDetect → triggerAudit → unpinned/moving-ref findings
                              │   → no-op yamlRewrite (byte-identical) → unifiedUsesDiff (empty)
                              ▼
                      post {id, phase:"A", …FULL offline report…}  ──► applyResult()  (paint immediately)
                              │   watchdog CLEARED here — it can never fire during Phase B
                              │
                    (autoResolve || "Resolve & pin")  &&  Phase A ok && remoteRefs present
                              │  debounce 500ms · LRU dedup
                    PHASE B  ▼  phase: "B"   (previous AbortController aborted; new one armed)
                              │   analyzeResolve(phaseA, { fetchImpl, budget, now, … })
                              │   resolveRefs (pool 4, 2-unit budget reserve, per-ref timeout,
                              │                whole fan-out signal-abortable)
                              │   → buildRewriteEdits(source, resolutions, classified) → applyEdits
                              │   → unifiedUsesDiff → resolutionFindings(…, nowMs) → MERGE
                              ▼
                      post {id, phase:"B", …FULL merged envelope…}  ──► applyResult()  (atomic, field-merged)
                              │
          stale guard (id/phase rank drop) · watchdog covers Phase A only · fail → degradeToMainThread (same core)
```

---

## 7. Caps & budgets (shared constants table)

All values live in **`_lib/constants.ts`** — one file, so a Phase-4 `grep` of any cap
name below lands on exactly one site (AC-16).

### 7.1 Anchorflow caps

| Constant | Value | Purpose |
|---|---|---|
| `MAX_INPUT_BYTES` | `262_144` (256 KiB) | input ceiling (≈ 5k-line workflow ≈ 175 KiB); original byte count reported on truncate |
| `MAX_USES_SCAN` | `2_000` | structural `uses:` nodes scanned (no network); remainder reported, never dropped |
| `MAX_RESOLVES_PER_RUN` | `48` | network resolutions per run; also bounded by the budget floor |
| `MAX_RESOLVE_CONCURRENCY` | `4` | parallel in-flight requests |
| `RESOLVE_TIMEOUT_MS` | `8_000` | per-request `AbortController` timeout |
| `RESOLVE_BUDGET_MS` | `25_000` | total wall-clock for the resolve fan-out |
| `RATE_LIMIT_RESERVE` | `2` | stop fanning when `remaining - inFlight <= this` |
| `RESOLVE_CACHE_CAPACITY` | `64` | LRU resolved-sha entries |
| `RESOLVE_NEGATIVE_TTL_MS` | `60_000` | negative TTL for uncached 404s |
| `RESOLVE_DEBOUNCE_MS` | `500` | Phase B debounce after last edit |
| `WORKER_DEADLINE_MS` | `1_000` | Phase A cooperative budget — **measured / WARN threshold** (AC-11) |
| `MAX_INPUT_BYTES` / `MAX_USES_SCAN` / `MAX_RESOLVES_PER_RUN` | `262_144` / `2_000` / `48` | truncation, scan-cap and per-run resolve-cap behaviour — all governed by AC-13 |
| `SYNC_DEADLINE_MS` | `800` | main-thread fallback budget |
| `WATCHDOG_MS` | `1_500` | Phase A hard wall (terminate + respawn) — never armed for Phase B |
| Debounce tiers (Phase A) | `0 / 40 / 120 ms` | by source length `≤5k / >5k / >20k` |

Errors are **values, never throws**: malformed YAML and every resolve failure come
back as status fields, not exceptions. Truncation reports the **original** byte count.

### 7.2 Published caps-name mapping (domain cap ↔ BAR item-7 expectation)

BAR §10 item 7 names its expectations after the RegexCraft domain. This table resolves
each Anchorflow cap to the BAR expectation so a Phase-4 reviewer has **zero judgement
calls** (AC-16):

| BAR item-7 expectation (RegexCraft domain) | Anchorflow equivalent (`_lib/constants.ts`) | Value |
|---|---|---|
| `MAX_TEST_LENGTH` (input slice ceiling) | **`MAX_INPUT_BYTES`** | `262_144` |
| `MAX_MATCHES` (reported-match ceiling) | **`MAX_USES_SCAN`** | `2_000` |
| `WORKER_DEADLINE_MS` | `WORKER_DEADLINE_MS` | `1_000` |
| `SYNC_DEADLINE_MS` | `SYNC_DEADLINE_MS` | `800` |
| `WATCHDOG_MS` | `WATCHDOG_MS` | `1_500` |
| `ARTIFACT_CACHE_CAPACITY` (worker LRU) | **`RESOLVE_CACHE_CAPACITY`** | `64` |
| *(network-domain additions)* | `MAX_RESOLVES_PER_RUN` · `MAX_RESOLVE_CONCURRENCY` · `RESOLVE_TIMEOUT_MS` · `RESOLVE_BUDGET_MS` · `RATE_LIMIT_RESERVE` · `RESOLVE_NEGATIVE_TTL_MS` · `RESOLVE_DEBOUNCE_MS` | `48` · `4` · `8_000` · `25_000` · `2` · `60_000` · `500` |

---

## 8. Failure modes (each with required graceful behavior + copy)

| Failure | Detected by | Graceful behavior | User-facing copy |
|---|---|---|---|
| **404 unknown ref** | `resolveRefs` sees 404 on both namespaces | `status=unknown-ref`, keep the original value, finding + receipt with the endpoint; negative-cache for `RESOLVE_NEGATIVE_TTL_MS` | `Unknown ref — actions/checkout@v1`: "the tag and the branch lookup both 404'd, so the original value was kept and nothing was rewritten. Verify the tag exists (and that the repository is public)." |
| **tag moved / ref drift** | a re-resolve returns a different sha (or the reader runs the receipt's own `git ls-remote`) | the annotated YAML is never silently re-pinned; the receipt names the hop and the SHA | `Pinned to a commit SHA — actions/checkout@v4`: "Resolved through 2 hops of the read-only GitHub API, annotated tag object {short} dereferenced to commit {short}. A SHA is a point-in-time snapshot: the tag it replaced can still move, so re-resolve before a release to catch drift." |
| **403 / 429 rate-limit** | 403/429 **or** `remaining - inFlight <= reserveFloor` | stop fanning out; the refs after the floor are `rate-limited`; keep originals; report + receipts intact | Per-ref finding: "The GitHub API limit stopped this ref ({note}). {remaining} of {limit} requests remain this hour. The window resets in {countdown}. The offline report above is still complete." Plus the amber banner (`data-testid="rate-limit-banner"`): "GitHub's hourly API limit is reached · {remaining} of {limit} left · {reset}" — "Nothing was rewritten. The offline report above is still complete — findings, permissions and the uses classification are untouched — so re-run “Resolve & pin” after the window resets." |
| **unsafe owner/repo/ref** | the path-safety gate in `refResolver` | **refused before any request is sent**: `status=unsafe-ref`, no endpoint named in the receipt, an empty chain | `Not resolved — …`: "This reference was refused before any request was sent: the owner \"{owner}\" is not a safe GitHub owner name. Nothing was rewritten and the offline report above is still complete." |
| **CORS / offline / blocked** | `fetch` throws / `onerror` | `status=network-error`; keep originals; the Phase-A offline report still renders | `Not resolved — {label}`: "api.github.com could not be read for this ref ({note}). Nothing was rewritten and the offline report above is still complete." |
| **malformed YAML** | `parseWorkflow` returns `!ok` (eemeli's `doc.errors[0]`) | settle `fatalError` via `parseErrorCopy`, clear the report, keep the editor enabled | "That doesn't parse as a workflow YAML — {line}:{column}: {message}." The real string is `That doesn't parse as a workflow YAML — 6:1: All mapping items must start at the same column.`: eemeli's own reason with its `at line L, column C` suffix stripped and the position re-attributed by `toParseError` (no position ⇒ `unknown position`) |
| **oversized workflow** | `bytes > MAX_INPUT_BYTES` | truncate to the cap **on a code-point boundary**, set `metrics.truncated`, report the **ORIGINAL** bytes in `metrics.byteCount` | the editor's chip: "trimmed to 256 KiB for analysis" (amber, mono, `tabular-nums`) — and the `bytes` metric keeps the ORIGINAL count, so the cap never makes a workflow look smaller than it is |
| **`uses:` scan cap** | `usesCap.capped` | keep counting `usesSeen`; the amber strip reports the remainder | `UsesCapNotice` (`role="status"`, aria-label "Uses scan cap", `data-testid="uses-cap-notice"`): "`uses:` scan capped at 2,000 nodes — the remaining {N} were not analyzed. Everything below describes the first {M} nodes only." |
| **worker crash** | `onerror` / `onmessageerror` | `degradeToMainThread` → the same core at `SYNC_DEADLINE_MS`, amber banner | "Worker crashed — switched to main-thread mode" |
| **catastrophic parse hang** | the watchdog fires on Phase A | terminate + respawn, bump the request id, settle the friendly error, keep the input enabled | `ANALYZE_TIMEOUT_ERROR`: "Analysis exceeded the time budget — this workflow is too complex to process in time." |
| **superseded Phase B** | a newer message arrives mid-resolve | the worker-scope `AbortController` aborts the in-flight fan-out; its late results are dropped by the stale guard | (silent — the newest result wins) |

The copy column is the shipped string, not a paraphrase: `_lib/compute.ts`,
`_lib/analyze.ts` (`parseErrorCopy`) and `_lib/constants.ts` own it, and
`e2e/*.spec.ts` asserts the operative sentences in a real browser.

---

## 9. CSP profile (Anchorflow-specific `connect-src`)

The full header set is copied verbatim from regex-craft `next.config.ts`
(`frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'`,
HSTS `max-age=63072000; includeSubDomains; preload`, `nosniff`,
`Referrer-Policy`, `Permissions-Policy`; dev-only `unsafe-eval`;
`poweredByHeader: false`; `output: "standalone"`). The **only** difference is the
egress origin:

```
connect-src 'self' https://api.github.com https://*.supabase.co wss://*.supabase.co
```

`api.github.com` is Anchorflow's sole app-data egress, and it is **browser-direct** —
the call is made by the visitor's browser, never by a server relay, which is why the
origin must be in `connect-src` at all. `*.supabase.co`/`wss:` are present solely for
optional env-gated OAuth (inert when keys are absent — zero runtime connections).

Two statements, not one: the **default-path guard** asserts that nothing leaves the
origin at all (`autoResolve` is off, so the e2e allow-list is empty and any
non-same-origin request fails the journey), while this **CSP declaration** is the
permission the opt-in resolver *may* use once a visitor asks for a resolve. They are
complementary, and the second is not evidence that the first happened. §10 spells out
the URL-shape guard that then applies to every request the resolver does make.

---

## 10. Testing / oracle strategy (beat-the-bar §9a)

- **Recorded VCR fixtures (default).** `_lib/__tests__/fixtures/*.json` replay the
  resolver chain (`200` lightweight, `200` annotated + deref, `404`, `403` with
  `x-ratelimit-remaining: 0`, `429` with `Retry-After`) offline through the
  `fetchImpl` seam — deterministic, fast, in the default CI path. These back
  AC-4/AC-10, and the future-dated 429 fixture is what the AC-15 determinism
  compare is built on.
- **Live oracle (gated job, not in the default green gate).**
  `.github/workflows/oracle.yml`, **shipped**: `workflow_dispatch` **+ a weekly cron
  (`17 6 * * 0`, Sundays 06:17 UTC)** runs
  `npx vitest run app/tools/anchorflow/_lib/__tests__/refResolver.live.test.ts` with
  `GH_LIVE=1`. That suite resolves tag set **T** against the real `api.github.com`,
  compares every returned SHA against the pinned expectations in
  `_lib/__tests__/fixtures/index.ts`, and cross-checks each with
  `git ls-remote "<url>" "refs/tags/<ref>^{}"` (git is present in the build box) —
  so an API change or an upstream tag drift fails the job. **T** covers one
  lightweight tag, one annotated tag, one subpath action, one branch, one moving
  alias (`@latest`), one floating major (`@v0`) and one deliberately unknown ref.
  The step is `continue-on-error: true` and the following step prints the verdict:
  a runner `403`/`429` or an offline host is reported **SKIP, not FAIL** — the
  GitHub-Actions runner IP is the only Anchorflow-side IP that ever talks to the
  API, and its quota is not the visitor's. Locks in AC-5 and catches GitHub API
  changes without ever turning a shared IP into a red suite.
- **Unit (vitest, node).** Every `_lib` module has a suite in `_lib/__tests__/`
  (plus the tool-level `__tests__/` for the first-load boundary and the contrast
  floors); node env, pure core, no DOM/React. Includes the `_lib` source-scan test
  (no `fetch`/`globalThis.fetch` under `_lib/**`), the caps-name grep test, the
  `analyzeResolve` merge test, the `shouldPromptSignIn` policy matrix, the
  byte-cap/surrogate-pair truncation tests, the path-safety gate tests, and the
  determinism serialization compare.
- **E2E (Playwright, real standalone artifact).** Four specs:
  `smoke` (redirect, landmarks, paste→report journey, persistence under
  `anchorflow-tool-storage`, ⌘K, the palette's Resolve & pin in both its enabled
  and inert states, copy/theme, sign-in offer-never-lock, the findings journey);
  `resolve` (the invocable resolve journey, every pinned SHA, the rate-limit and
  offline friendly copy, and the tightened AC-12 URL-shape guard);
  `pipeline` (worker happy path, the degraded main-thread path returning the SAME
  report, and the **catastrophic watchdog journey** — a worker that never answers
  settles the friendly copy inside a bounded timeout with the input still enabled);
  `visual` (responsive structure at 390/1440, stacking, **zero-egress request
  guard**, zero uncaught errors). Pixel baselines ship GREEN-or-SKIPPED.
- **Coverage gates** (SchemaCraft's, **shipped and wired into
  `.github/workflows/ci.yml`**): functions ≥ 90, lines/statements ≥ 80, branches
  ≥ 70, scoped to the pure core by `vitest.config.mts`, run by
  `npm run test:coverage` and gated — a run below any threshold exits non-zero.
