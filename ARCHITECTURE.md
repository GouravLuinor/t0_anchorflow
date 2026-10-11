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
8-floor craft rules, five interaction states, `scan-sweep`). Anchorflow maps the
semantic colors to its meaning:
- **lime** = pinned / match / primary / the privacy promise.
- **violet** = capture/secondary (e.g. the grant table's secondary scope).
- **amber** = warn/degraded/truncation/rate-limit banner.
- **rose** = error finding / copy-failure toast.
Contract identical to `regex-craft/docs/DESIGN.md`; dual-theme AAA in both themes.

---

## 3. Module map — exact `_lib` boundaries & signatures

Folder rules (mirror regex-craft): `_lib` is **pure** (no React/DOM/IO); `_workers`
imports **only** `_lib`; `_components` may import `_lib`+`_store`, never the reverse.
`_lib/types.ts` has **zero runtime imports** (pure `interface`/`type` + worker
protocol).

```
app/tools/anchorflow/
  _lib/
    types.ts            zero-import types + worker protocol
    constants.ts        EVERY cap/budget/deadline constant (single grep site, ARCH §7.2)
    yamlParse.ts        source -> WorkflowModel (structure + offsets)  [pure]
    classify.ts         UsesRaw -> ClassifiedUses (6 classes x 2 scopes)  [pure]
    pinningAudit.ts     ClassifiedUses -> Finding[] (unpinned-uses/moving-ref)  [pure]
    permissionAudit.ts  WorkflowModel -> Finding[] (+ grantTable)      [pure]
    injectionDetect.ts  WorkflowModel -> InjectionSink[] (-> findings) [pure]
    dangerTriggers.ts   WorkflowModel -> Finding[] (triggers+persist)   [pure]
    refResolver.ts      ClassifiedUses -> Resolution[] (async)        [pure, fetch seam]
    yamlRewrite.ts      source + Resolution[] -> pinned string        [pure, offset edits]
    diff.ts             before/after -> UnifiedDiff (LCS line diff)    [pure]
    presets.ts          DEFAULT_WORKFLOW + guide/faq content           [pure]
    compute.ts          pipeline orchestrator (analyzeLocal + resolve) [pure, shared]
    supabaseClient.ts   env-gated singleton promise (BAR §11)          [no IO]
    authGate.ts         shouldPromptSignIn policy                      [pure]
    __tests__/*.test.ts
  _workers/compute.worker.ts
  _hooks/useToolWorker.ts
  _store/useToolStore.ts
```

### 3.1 `types.ts` (zero runtime imports)

```ts
// ── Classification ──
export type UsesClass = "sha40" | "sha256" | "remoteRef" | "local" | "docker" | "invalid";
export type UsesScope = "step" | "job";          // job = jobs.<id>.uses (reusable workflow call)
export type ResolveStatus =
  | "not-requested" | "resolved" | "unknown-ref" | "rate-limited" | "network-error";

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
}

// ── Findings — ONE canonical array (injection sinks are template-injection findings) ──
export type Severity = "error" | "warn" | "info";
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
  truncated: boolean; usesScanned: number; usesCapHit: boolean;
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
export function yamlParse(source: string): WorkflowModel;
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
export function isMovingRef(ref: string): boolean;
export function classifyOne(raw: string, meta: Omit<UsesRaw, "raw">): ClassifiedUses;
export function classifyUses(raws: UsesRaw[]): ClassifiedUses[];
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

### 3.5 `permissionAudit.ts`
```ts
export function parsePermissions(raw: unknown): RawPermissionBlock | null;
export function buildGrantTable(model: WorkflowModel): GrantTable;
export function permissionAudit(model: WorkflowModel): Finding[];
```
Effective scope resolution (job block overrides top per scope; `all: write`/`read`
as a shorthand; omitted scope = absent). Produces the 5 canonical findings (SPEC
§4 F5) + the grant table for rendering.

### 3.6 `pinningAudit.ts`
```ts
export function pinningAudit(classified: ClassifiedUses[]): Finding[];
```
The precise `unpinned-uses` / `moving-ref` / class-note emitter (SPEC §4 F2):
- **`unpinned-uses` / `error`** — one per `remoteRef` node with `moving === true`.
- **`unpinned-uses` / `warn`** — one per non-moving `remoteRef`; also one per
  `invalid` node ("unparseable — never rewritten").
- **`moving-ref` / `warn`** — one per `moving === true` node, with the plain-English
  drift explanation. (A moving ref therefore yields two findings: the immutability
  finding and the drift finding.)
- **`resolution` / `info`** — one per `sha256` node ("unusual but pinned — not
  resolved") and one per `docker` node ("registry digest — out of v1 scope"), so no
  classified node is invisible.
- **`local`** — no finding (rendered in the class table).

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

### 3.8 `dangerTriggers.ts`
```ts
export function dangerousTriggerAudit(model: WorkflowModel): Finding[];
export function persistCredentialsAudit(model: WorkflowModel): Finding[];
```
PR-target/workflow-run + checkout-at-PR-head; token/permission coupling;
`persist-credentials` true/absent-with-risk.

### 3.9 `yamlRewrite.ts` (offset surgical — the crux)
```ts
export interface RewriteEdit { start: number; valueEnd: number; text: string; }
export function buildRewriteEdits(resolutions: Resolution[], classify: ClassifiedUses[]): RewriteEdit[];
export function applyEdits(source: string, edits: RewriteEdit[]): string;   // right-to-left
export function yamlRewrite(source: string, resolutions: Resolution[]): string;
```
Only `resolved` resolutions become edits, and **only for `remoteRef` inputs** — a
`sha40`/`sha256` node is never an edit, so re-pinning the tool's own output is a
**zero-diff, idempotent** re-run.

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

### 3.10 `diff.ts`
```ts
export function unifiedUsesDiff(before: string, after: string): UnifiedDiff;
```
Compact, deterministic LCS over lines; emit hunks with 3 lines of context; `+`/`-`
pairs. No external dependency (keeps the worker bundle small). Pure/unit-tested.

### 3.11 `compute.ts` (pipeline, shared by worker AND fallback)
```ts
export function analyzeLocal(source: string): Omit<WorkerOutputPayload, "id" | "phase">;   // Phase A (sync)
export async function analyzeResolve(
  source: string,
  model: WorkflowModel,
  classified: ClassifiedUses[],
  phaseA: Omit<WorkerOutputPayload, "id" | "phase">,   // the Phase-A report to MERGE
  budget: RateLimitState,
  fetchImpl: FetchLike,                                // REQUIRED (M11) — supplied at the boundary
  options?: { signal?: AbortSignal; now?: () => number }
): Promise<Omit<WorkerOutputPayload, "id" | "phase">>; // Phase B (async) → FULL ENVELOPE
```
Single source of semantics: the worker and the main-thread fallback both call these,
so the two paths cannot drift. Phase A never touches the network; Phase B is the only
fetch site, and `fetchImpl` is injected from outside `_lib`.

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
                              │   yamlParse → classify → pinningAudit → permissionAudit
                              │   → injectionDetect → dangerTriggers → moving-ref findings
                              ▼
                      post {id, phase:"A", …FULL offline report…}  ──► applyResult()  (paint immediately)
                              │   watchdog CLEARED here — it can never fire during Phase B
                              │
                    (autoResolve || "Resolve & pin")  &&  Phase A ok && remoteRefs present
                              │  debounce 500ms · LRU dedup
                    PHASE B  ▼  phase: "B"   (previous AbortController aborted; new one armed)
                              │   analyzeResolve(source, model, classified, phaseA, budget, fetch)
                              │   resolveRefs (pool 4, 2-unit budget reserve, per-ref timeout,
                              │                whole fan-out signal-abortable)
                              │   → yamlRewrite (offset edits) → unifiedUsesDiff
                              │   → resolution findings + receipts  →  MERGE with phaseA.findings
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
| **404 unknown ref** | `resolveRefs` sees 404 | `status=unknown-ref`, keep original value, finding + receipt with endpoint; negative-cache for `RESOLVE_NEGATIVE_TTL_MS` | "`owner/repo@vX` — unknown ref; kept original. Verify the tag exists." |
| **tag moved / ref drift** | the receipt's `resolvedAt` is older than the tag's own history, or a re-resolve returns a different sha | keep the annotated YAML (never silently re-pin), re-emit the pin finding, offer **Re-resolve** | "A SHA is a point-in-time snapshot: the tag can move later. This receipt was resolved at {resolvedAt} — re-resolve to check for drift." |
| **403 / 429 rate-limit** | 403/429 **or** `remaining - inFlight <= reserveFloor` | stop fan-out; remaining refs `rate-limited`; keep originals; report + receipts intact | `x-ratelimit-remaining: 0` ⇒ amber banner: "GitHub API hourly limit (60/hr, per IP) reached — resets in {Xm}. {N} refs left unverified; the full report is still below." `Retry-After` ⇒ "…retry in {Xs}…" · rate-headless 403 ⇒ "GitHub is temporarily blocking requests from this network ({resource}) — the full report is still below." |
| **CORS / offline / blocked** | `fetch` throws / `onerror` | `status=network-error`; keep originals; Phase A offline report still renders | "Can't reach api.github.com (offline or blocked). Analysis completed without pinning." |
| **child of malformed YAML** | `yamlParse` returns `!ok` | settle `fatalError` with line/col, clear report | "That doesn't parse as a workflow YAML — {line}:{col}: {reason}." |
| **oversized workflow** | `bytes > MAX_INPUT_BYTES` | truncate to cap **on a code-point boundary**, set `metrics.truncated`, report original bytes | "Trimmed to 256 KiB for analysis (original {N} KiB shown)." |
| **`uses:` scan cap** | `usesCap.capped` | keep counting `seen`; report the overflow | "`uses:` scan capped at 2,000 nodes — {M} further nodes were not analyzed." |
| **worker crash** | `onerror` / `onmessageerror` | `degradeToMainThread` → same core at `SYNC_DEADLINE_MS`, amber banner | "Main-thread mode active — Web Worker unavailable." |
| **catastrophic parse hang** | watchdog fires on Phase A | terminate + respawn bump id; friendly error; input re-enabled | "Analysis aborted — input was too complex to process in time." |
| **superseded Phase B** | a newer message arrives mid-resolve | worker-scope `AbortController` aborts the in-flight fan-out; its late results are dropped by the stale guard | (silent — the newest result wins) |

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
The e2e **allow-list equals this set exactly** (§10).

---

## 10. Testing / oracle strategy (beat-the-bar §9a)

- **Recorded VCR fixtures (default).** `_lib/__tests__/fixtures/*.json` replay the
  resolver chain (`200` lightweight, `200` annotated + deref, `404`, `403`, `429`)
  offline through the `fetchImpl` seam — deterministic, fast, in the default CI path.
  These back AC-4/AC-10.
- **Live oracle (gated job, not in the default green gate).** A scheduled
  `.github/workflows/oracle.yml` (`workflow_dispatch` + weekly cron) resolves tag set
  **T** against real `api.github.com` **and** cross-checks each against
  `git ls-remote "<url>" "refs/tags/<ref>^{}"` (git is present in the build box);
  it fails on drift. **T** covers one lightweight tag, one annotated tag, one subpath
  action, one branch, one moving alias (`@latest`), one floating major (`@v0`), and
  one deliberately unknown ref. The runner's `403`/`429` is reported
  **SKIP, not FAIL** — the GitHub-Actions runner IP is the only Anchorflow-side IP
  that ever talks to the API, and its quota is not the visitor's. Locks in AC-5 and
  catches GitHub API changes.
- **Unit (vitest, node).** Every `_lib` module has a suite in `_lib/__tests__/`;
  node env, pure core, no DOM/React. Includes the `_lib` source-scan test (no
  `fetch`/`globalThis.fetch` under `_lib/**`), the caps-name grep test, the
  `analyzeResolve` merge test, and the `shouldPromptSignIn` policy matrix.
- **E2E (Playwright, real standalone artifact).** `smoke` (redirect, landmarks,
  paste→report journey, persistence under `anchorflow-tool-storage`, ⌘K, **zero
  external requests on first paint with `autoResolve=false`**),
  `demos` (resolve journey with a **rate-limit/offline stub** + the catastrophic-input
  degradation with a bounded timeout + a 5,000-line no-freeze journey),
  `visual` (no horizontal overflow 390/1440,
  single-column below `lg`, **zero-egress request guard**, zero uncaught errors).
  Pixel baselines ship GREEN-or-SKIPPED.
- **Coverage gates** (SchemaCraft's): functions ≥ 90, lines/statements ≥ 80,
  branches ≥ 70, scoped to the pure core.
- Config reuse: copy regex-craft `tsconfig.json`, `eslint.config.mjs`,
  `vitest.config.mts`, `playwright.config.ts` (swap port 3002→**3004**), the auth
  files (`_lib/supabaseClient.ts`, `_lib/authGate.ts`, `_hooks/useAuth.ts`), and the
  UI primitives under `components/ui`.
