# Anchorflow — GitHub Actions Workstation

**Anchorflow** (`anchorflow`) is a NorAI Tier-0 developer workstation: a
client-side GitHub Actions workstation that pins every action to an immutable
commit SHA, audits the `GITHUB_TOKEN` grants per job, detects template-injection
sinks from untrusted event data, and returns a red/green diff of exactly what
changed. It runs entirely in the visitor's browser — a workflow file is never
uploaded, and nothing is computed server-side.

- **Route**: `/tools/anchorflow` (the root `/` is a server-side `redirect()`)
- **Port**: 3004 · **Subdomain / PM2**: `anchor.norai.tech` · `anchor-norai`
- **Version**: 1.0.0 (shipped)
- **Design system**: Certified Copy — security-printing material: a pale
  security-paper ground, intaglio ink, seal green for pinned, indigo for a
  moving ref, and a guilloché seal drawn from every pinned SHA, in light and
  dark (`DESIGN.md`, `.impeccable/design.json`)

## What it does (all offline, all deterministic)

| Surface | What it gives you |
|---|---|
| **6 classified `uses:` classes** | `remoteRef` · `sha40` · `sha256` · `local` · `docker` · `invalid` — every step and job-level call, in source order, with a summary count per class |
| **Six finding categories** | `unpinned-uses` · `moving-ref` · `excessive-permissions` · `template-injection` · `dangerous-trigger` · `persist-credentials` (+ `resolution` from Phase B) |
| **Grant table** | the effective `GITHUB_TOKEN` scope per job — the job block overriding the top-level block per scope, with an UNSET table when nothing declares one |
| **Pinned YAML** | an offset-surgical rewrite that replaces only the `uses:` scalar bytes; every other byte, comment, blank line and flow spacing survives |
| **Diff** | a red/green unified diff of the rewrite — empty until refs are actually resolved |
| **Receipts** | per ref: the endpoints used, the hop chain, the resulting SHA and a `git ls-remote` cross-check you can run yourself |

Phase A is the offline report: it parses, classifies, audits, builds the grant
table, computes the no-op rewrite and the diff, and returns **always —
`ok: true`** even when the workflow is malformed (the parse error rides the
envelope instead of throwing).

Phase B is the **opt-in** resolver: one click on **Resolve & pin** reads
`owner/repo@ref` from `api.github.com`, pins moving refs to 40-hex commit SHAs,
and merges back into the Phase-A envelope (`uses`, `permissions`, `ok`, the
offline findings and rewritten YAML are all preserved). It is *disabled by
default* and makes no request until a visitor asks for one, and each receipt
carries a `git ls-remote` cross-check you can run yourself, plus the standing
caveat: a SHA is a point-in-time snapshot, and the tag can move later.

## Quick start

```bash
npm install
npm run dev            # http://127.0.0.1:3004/tools/anchorflow
npm run test:e2e       # Playwright, boots the real standalone artifact
```

## Repository shape

```
app/
├── page.tsx                    # root → server redirect() to the workstation
├── layout.tsx                  # ThemeProvider + site chrome
├── globals.css                 # Certified Copy token layer (light + dark)
├── icon.tsx                    # the brand seal
├── opengraph-image.tsx         # 1200×630 share card
├── sitemap.ts · robots.ts      # SEO (tool, guides index, six guides)
└── tools/
    └── anchorflow/
        ├── page.tsx            # H1 + promises · workstation · compare · guide · FAQ · JSON-LD
        ├── learn/              # the six guide pages (programmatic SEO)
        ├── _lib/               # THE PURE CORE — 21 modules, zero React / DOM / fetch
        ├── _hooks/             # useToolWorker · useKeyboardShortcuts · useAuth
        ├── _components/        # the surface, incl. auth/ (offer-never-lock)
        ├── _store/             # useToolStore (persisted: source, autoResolve only)
        ├── _workers/           # compute.worker.ts — the Phase-A/B worker
        └── __tests__/          # first-load boundary · contrast
├── components/ui/              # shared primitives (button, dialog, switch, …)
├── e2e/                        # pipeline · resolve · smoke · visual (4 spec files)
├── lib/                        # site (FAQ, comparison, family tools) · learn (guides) · utils
├── scripts/bench-phase-a.ts    # `npm run bench`
├── deploy.sh                   # dirty-tree guard → supply-chain gate → release
└── ecosystem.config.js         # PM2: anchor-norai on 127.0.0.1:3004
.github/ci.yml · oracle.yml     # default CI + the live differential oracle
```

### `_lib` — the pure core (21 modules)

Every module here is deterministic and side-effect free: no React, no DOM, no
IO, and **never** a `fetch` call (`_lib/__tests__/purity.test.ts` greps for the
name and fails). The worker and the main-thread fallback each supply the network
seam at their own boundary.

| Module | Exports and responsibility |
|---|---|
| `types.ts` | Zero-runtime-import types + the worker protocol: `ClassifiedUses`, `Resolution`, `Finding`, `GrantTable`, `ToolMetrics`, `WorkerInputPayload`/`WorkerOutputPayload` |
| `constants.ts` | `MAX_INPUT_BYTES` 262,144 · `MAX_USES_SCAN` 2,000 · `MAX_RESOLVES_PER_RUN` 48 · `MAX_RESOLVE_CONCURRENCY` 4 · `RESOLVE_TIMEOUT_MS` 8,000 · `RESOLVE_BUDGET_MS` 25,000 · `RATE_LIMIT_RESERVE` 2 · `RESOLVE_NEGATIVE_TTL_MS` 60,000 · `RESOLVE_DEBOUNCE_MS` 500 · `WATCHDOG_MS` 1,500 · `WORKER_DEADLINE_MS` 1,000 · `SYNC_DEADLINE_MS` 800 · `ANALYZE_TIMEOUT_ERROR` · `EMPTY_METRICS` · `DEFAULT_RATE_LIMIT` |
| `textMetrics.ts` | `countBytes` / `countWords` / `countLines` / `measureText` / `lineOfOffset` / `truncateToCap` / **`truncateForDispatch`** — the byte-accurate dispatch cap, returning the capped text **plus** the original byte count and `truncated` verdict so the cap never hides the input's real size |
| `yamlParse.ts` | `yamlParse`, `parseWorkflow`, `parsePermissionBlock` — the offline parse with the `uses:` scan cap and a `ParseErrorValue` instead of a throw |
| `classify.ts` | `classifyUses`, `classifyOne`, `splitRemoteRef`, `isMovingRef`, `isLocalPath`, `isDockerRef`, `summarizeClasses` — the six `uses:` classes (`sha40` · `sha256` · `remoteRef` · `local` · `docker` · `invalid`) |
| `permissionAudit.ts` | `permissionAudit`, `jobAnchor`, `TOKEN_COUPLING_SCOPES` (re-exports `parsePermissions`) |
| `grantTable.ts` | `buildGrantTable`, `effectiveJobGrants`, `expandBlock`, `describeGrant`, `scopeSemantics`, `PERMISSION_SCOPES`, `parsePermissions` |
| `injectionDetect.ts` | `injectionDetect`, `injectionFindings`, `findExpressions`, `tokenizeExpression`, `isSafeContext`, `matchUntrustedContext`, `UNTRUSTED_CONTEXTS` |
| `triggerAudit.ts` | `dangerousTriggerAudit`, `persistCredentialsAudit` |
| `actionCatalog.ts` | `knowledgeFor`, `ownerRepo`, `isCheckout`, `jobProfile`, `needsWriteScope`, `isFullyPinned`, `UNTRUSTED_REF_EXPRESSIONS` — the per-action and per-job guidance knowledge |
| `findings.ts` | `SEVERITY_BANDS`, `SEVERITY_LEGEND`, `sortFindings` (offset → category → id), `countBySeverity`, `worstSeverity`, `formatFinding`, `formatFindings`, `evidenceText` |
| `analyze.ts` | **Phase A, the whole offline pipeline**: `analyzeLocal` → parse → classify → audit → grant table → rewrite → diff → metrics, always `ok: true`; `ReportBody`, `AnalyzeOptions`, `parseErrorCopy`, `isOverDeadline` |
| `compute.ts` | **the pipeline orchestrator**: `runPhaseA` (Phase A), `analyzeResolve` (Phase B → the merged envelope), `resetCountdown`, `resolutionFindings`, `toOutputPayload` |
| `refResolver.ts` | The opt-in resolver: `resolveRefs`, `isResolvable`, `canDispatch`, `buildReceipt`, `refApiPath`/`refUrl`, `endpointLabel`, `refCacheKey`, `API_ORIGIN`, plus the path-safety guards `isSafeOwner` / `isSafeOwnerRepoSegment` / `isSafeRef` / `unsafeRefReason` |
| `rewrite.ts` | `yamlRewrite`, `buildRewriteEdits(source, resolutions, classify?)`, `applyPin`, `pinScalar`, `applyEdits`, `toResolutionMap`, `offsetsStillHold`, `isPinnable` |
| `diff.ts` | `unifiedUsesDiff`, `DIFF_CONTEXT_LINES` — the red/green diff of the rewrite |
| `presets.ts` | `DEFAULT_WORKFLOW` (the seeded first run) and `TRUST_PILLS` — the only source of both |
| `guide.ts` | `GUIDE_TABS` — the KnowledgeHub content, one array, one render path |
| `authGate.ts` | `shouldPromptSignIn`, `bumpSessionCount`, `SESSION_COUNT_KEY` — pure, incl. degraded `localStorage` and no-`window` paths |
| `protocol.ts` | `PHASE_RANK`, `isStaleDispatch`, `acceptDispatch`, `DispatchState`, `INITIAL_DISPATCH_STATE` — the monotonic id + phase-rank guard applied to every inbound dispatch **and** every outbound reply |
| `supabaseClient.ts` | The env-gated lazy OAuth client (`isSupabaseConfigured`, `getSupabaseClient`) — inert without env keys |

## Privacy and security invariants

- **Zero egress on the default path.** `autoResolve` defaults to `false`; the
  first paint, typing and computing make **zero** external requests, asserted in
  the default CI path by `e2e/visual.spec.ts`.
- **Fonts are the one build-time exception, and they are not runtime egress.**
  Inter and JetBrains Mono are pulled by `next/font` at **build** time and
  self-hosted as same-origin `woff2`, so at runtime the fonts are ordinary
  first-party responses — nothing reaches a third-party font host (BAR §5.2).
- **The default-path guard asserts that nothing leaves the origin.** Its
  allow-list is empty, so if anything but a same-origin request appears the e2e
  journeys fail. The CSP in `next.config.ts` separately **declares**
  `https://api.github.com` as the only app-data egress the opt-in resolver *may*
  use (plus the env-gated Supabase OAuth hosts, which make no connection without
  keys) — the declaration is the permission the resolver is given, not a claim
  that the default path uses it.
- **Every URL is re-checked on the wire.** The e2e AC-12 shape guard asserts
  `https://api.github.com` as the origin, no query, no fragment, and owner/repo
  matching `^[A-Za-z0-9._-]+$` with no `..` traversal in either segment.
- **Nothing unsafe is ever fetched.** `refResolver` refuses an owner, repo or ref
  that fails the path-safety check and reports it as a `resolution` finding with
  the reason — never a silent fetch, never a silent drop.
- **Offer, never lock.** No core surface is ever gated by sign-in; removing the
  env keys leaves a working instrument (`_lib/authGate.ts` is pure and unit-tested
  for the unconfigured path).
- **Worker watchdog.** Phase A runs under a 1.5 s watchdog (terminate + respawn,
  then a friendly verdict); Phase B is abortable and never watchdogged. The
  catastrophic journey in `e2e/pipeline.spec.ts` forces a worker that never
  answers and asserts the friendly copy plus a still-enabled editor.

## Keyboard

| Shortcut | Action |
|---|---|
| <kbd>⌘K</kbd> / <kbd>⌘P</kbd> (Mac) · <kbd>Ctrl</kbd>+<kbd>K</kbd> / <kbd>Ctrl</kbd>+<kbd>P</kbd> | open the command palette |
| <kbd>⌘⇧C</kbd> · <kbd>Ctrl</kbd>+<kbd>⇧C</kbd> | copy the diagnostic output |
| <kbd>⌘↵</kbd> · <kbd>Ctrl</kbd>+<kbd>↵</kbd> | focus the workflow input |
| <kbd>⌘⏎</kbd> · <kbd>Ctrl</kbd>+<kbd>⏎</kbd> | **inside the palette**: run *Resolve & pin* directly (inert when nothing is pending) |

## Culture

Engineering rules that are binding, not aspirational, live in `AGENTS.md`:

- `_lib` stays pure — no React, no DOM, no IO, never `fetch`.
- Four interaction states minimum on every control; one accent colour; mono
  means machine data.
- The worker contract (monotonic id + phase rank, adaptive debounce, watchdog)
  is not to be weakened.
- Privacy is a test, not a claim.

## Commands

| Command | What it runs |
|---|---|
| `npm run dev` | the dev server on port 3004 |
| `npm run build` | the production standalone build |
| `npm run start` / `node .next/standalone/server.js` | the standalone artifact on port 3004 |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | eslint |
| `npm test` | the vitest unit suites |
| `npm run test:coverage` | vitest with coverage gates for the pure core |
| `npm run bench` | the Phase-A benchmark (`scripts/bench-phase-a.ts`) |
| `npm run test:e2e` | Playwright, booting the real standalone artifact |

## Verification summary (v1.0.0, 2026-10-11)

| Gate | Result |
|---|---|
| `npm run typecheck` | 0 errors |
| `npm run lint` | 0 problems |
| `npm test` | 22 suites · 380 passed, 1 skipped (live oracle) |
| `npm run test:coverage` | functions 96.9% · statements 93.3% · branches 82.4% · lines 96.0% (all above thresholds) |
| `npm run build` | First Load JS on `/tools/anchorflow` = **180 kB** (20 kB under budget) |
| `npm run test:e2e` | 4 spec files · 43 passed, 2 skipped (pixel baselines) |
| `npm run bench` | Phase A median 14.7–16.9 ms (1k) / 62.4–68.6 ms (5k) / 114.3–125.0 ms (3× cap) |

Details and honest remaining gaps: `BENCHMARKS.md` and `QUALITY_REPORT.md`.
Live-oracle orchestration: `.github/workflows/oracle.yml`. Release steps:
`RELEASE_CHECKLIST.md`.
