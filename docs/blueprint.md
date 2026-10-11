# Anchorflow — Architecture Companion (docs/blueprint.md)

> Mirrors the shipped code. Layer map, dispatch contract, caps table, state
> table, folder conventions, the add-a-capability loop, and deployment. The
> authoritative planning docs are `SPEC.md` (product contract) and
> `ARCHITECTURE.md` (domain design); this file is the as-built companion.

## 1. Layer map

```
app/tools/anchorflow/page.tsx          orchestration + layout only
  └── _hooks/useToolWorker.ts          worker lifecycle, debounce, watchdog, degrade
        ├── _workers/compute.worker.ts off-main-thread execution + artifact LRU
        ├── _lib/compute.ts            pipeline orchestrator (runPhaseA + analyzeResolve)
        │     ├── _lib/analyze.ts      PHASE A — the whole offline pipeline (pure)
        │     ├── _lib/yamlParse.ts    source → WorkflowModel, parse errors as values
        │     ├── _lib/classify.ts     the `uses:` classes (6 classes × 2 scopes)
        │     ├── _lib/permissionAudit.ts + grantTable.ts
        │     ├── _lib/injectionDetect.ts
        │     ├── _lib/triggerAudit.ts
        │     ├── _lib/rewrite.ts      offset-surgical rewrite (the crux)
        │     ├── _lib/diff.ts         the red/green unified diff
        │     ├── _lib/refResolver.ts  the opt-in, path-safe resolver (fetch seam)
        │     ├── _lib/findings.ts     severity bands + the canonical sort
        │     ├── _lib/textMetrics.ts  bytes/words/lines + the code-point-safe cap
        │     ├── _lib/actionCatalog.ts / guide.ts / presets.ts
        │     ├── _lib/protocol.ts     the phase-rank stale guard (pure)
        │     ├── _lib/authGate.ts / supabaseClient.ts
        │     └── _lib/constants.ts    every cap/budget/deadline (one grep site)
        └── _store/useToolStore.ts     zustand result/state sink
```

  21 modules in total; `README.md` carries the per-module export table.

- `_lib/` is **pure**: no React, no DOM, no IO, no `fetch` (enforced by
  `_lib/__tests__/purity.test.ts`; `authGate.ts` is the single documented
  localStorage exemption, guarded by try/catch and covered by its own suite).
- `_lib/types.ts` has **zero runtime imports** — it holds the shared types and
  the worker protocol, so UI can never pull compiler logic into a bundle.
- `_workers` imports **only** `_lib`.
- `_components` may import `_lib` and `_store`, never the reverse.

## 2. Dispatch contract

### 2.1 Message shape

```ts
WorkerInputPayload  { id, phase: "A" | "B", source, resolve, budget }
WorkerOutputPayload { id, phase, ok, fatalError, uses, resolutions,
                      rewrittenYaml, diff, permissions, findings, metrics,
                      rateLimit }
```

Both phases post the **full** envelope; a partial is a bug.

### 2.2 Stale guard (phase-ranked)

```ts
const PHASE_RANK = { A: 1, B: 2 };
drop = msg.id < requestId
    || (msg.id === requestId && PHASE_RANK[msg.phase] <= lastPhaseRank);
```

A `B` for the current id is accepted after its `A`; a second `B` or a late `A`
for the same id is dropped. The pure implementation lives in
`_lib/protocol.ts` and is unit-tested (SPEC §9 AC-15).

### 2.3 Liveness strategy by phase

| Moment | Watchdog (1.5 s) | Phase-B `AbortController` |
|---|---|---|
| dispatch | **arm** | — |
| Phase A posts | **clear** | — |
| Phase B dispatched | never armed | previous aborted, new created |
| newer message mid-Phase-B | never armed | in-flight fan-out **aborted** |
| `degradeToMainThread()` | clear | aborted |

### 2.4 Debounce tiers

| Input length | Delay |
|---|---|
| ≤ 5,000 chars | 0 ms (instant) |
| > 5,000 | 40 ms |
| > 20,000 | 120 ms |

Phase B (network resolve) is deliberately decoupled: it debounces
`RESOLVE_DEBOUNCE_MS` (500 ms) after the last edit and only runs on an explicit
opt-in, because every resolve spends the visitor's own hourly quota.

## 3. Caps & budgets (single grep site: `_lib/constants.ts`)

| Constant | Value | Purpose |
|---|---|---|
| `MAX_INPUT_BYTES` | 262,144 | input ceiling; original byte count reported on truncate |
| `MAX_USES_SCAN` | 2,000 | structural `uses:` nodes scanned; remainder reported |
| `MAX_RESOLVES_PER_RUN` | 48 | network resolutions per run |
| `MAX_RESOLVE_CONCURRENCY` | 4 | parallel in-flight requests |
| `RESOLVE_TIMEOUT_MS` | 8,000 | per-request timeout |
| `RESOLVE_BUDGET_MS` | 25,000 | total resolve fan-out budget |
| `RATE_LIMIT_RESERVE` | 2 | stop fanning when `remaining - inFlight <= this` |
| `RESOLVE_CACHE_CAPACITY` | 64 | LRU resolved-sha entries |
| `RESOLVE_NEGATIVE_TTL_MS` | 60,000 | negative TTL for uncached 404s |
| `RESOLVE_DEBOUNCE_MS` | 500 | Phase B debounce |
| `WORKER_DEADLINE_MS` | 1,000 | Phase A cooperative budget (measured/WARN) |
| `SYNC_DEADLINE_MS` | 800 | main-thread fallback budget |
| `WATCHDOG_MS` | 1,500 | Phase A hard wall (terminate + respawn) |
| `ARTIFACT_CACHE_CAPACITY` | 32 | worker LRU entries |
| `SUCCESS_ANNOUNCE_DEBOUNCE_MS` | 800 | screen-reader announce trail |

**BAR item-7 mapping** (published in `constants.ts` so a reviewer has zero
judgement calls): `MAX_INPUT_BYTES ↔ MAX_TEST_LENGTH`,
`MAX_USES_SCAN ↔ MAX_MATCHES`, `WORKER_DEADLINE_MS`/`SYNC_DEADLINE_MS`/`WATCHDOG_MS`
same names, `RESOLVE_CACHE_CAPACITY ↔ ARTIFACT_CACHE_CAPACITY`.

## 4. State table

| Field | Kind | Notes |
|---|---|---|
| `source` | **persisted** | the workflow text, seeded from `DEFAULT_WORKFLOW` |
| `autoResolve` | **persisted** | opt-in; defaults `false` (zero egress on first paint) |
| `report` (uses/resolutions/rewrittenYaml/diff/permissions/findings/ok/fatalError) | transient | the settled output |
| `metrics` | transient | line/byte/char/word counts + timings + truncation flags |
| `isProcessing`, `errorMessage`, `isWorkerAvailable` | transient | pipeline health |
| `resolveStatus`, `rateLimit` | transient | Phase B status + budget |
| `isCommandPaletteOpen`, `statusAnnouncement` | transient | UI chrome |

Persist: `anchorflow-tool-storage` v1, `skipHydration: true`,
`createJSONStorage(() => localStorage)`, `partialize` limited to
`{ source, autoResolve }`, defensive `merge()`. Atomic settle:
`applyResult()` sets report + metrics + error + announcement in one `set()`, and
takes each report field from the payload only when defined.

## 5. Folder conventions

- One store per concern: `useToolStore` + `useAuthPromptStore`.
- `_components` files are named for their role, not their markup.
- New module order: `_lib/<module>.ts` → `_lib/__tests__/<module>.test.ts` →
  worker envelope field in `types.ts` → store field → component → e2e journey.
- Ports, names and slugs are never hard-coded in more than the files the bar
  names (see README "Deployment").

## 6. Adding a capability loop

1. Define the shape in `_lib/types.ts` (pure types only).
2. Write the failing suite in `_lib/__tests__/<module>.test.ts` (node env).
3. Implement the module in `_lib/` — no IO; inject any network seam.
4. Thread it through the worker envelope and `applyResult` with the
   field-merge guard intact.
5. Render it with all five interaction states and a copy affordance.
6. Extend the e2e spec that owns it: `smoke.spec.ts` (surface journeys),
   `pipeline.spec.ts` (worker / degraded / watchdog), `resolve.spec.ts`
   (the resolver and its receipts), or `visual.spec.ts` (structure + privacy).
7. Run the gates: typecheck → lint → test → coverage → build → bench → e2e.

## 7. Deployment

- **Port 3004** in `package.json` (dev + start), `playwright.config.ts`
  (baseURL + webServer PORT + url), `Dockerfile` (ENV PORT / EXPOSE /
  HEALTHCHECK), `docker-compose.yml` (`127.0.0.1:3004:3004`), `Caddyfile`,
  README.
- **Production truth:** PM2 `anchor-norai` on the VPS, `npm run build &&
  npm start` standalone output, nginx + certbot TLS on `anchor.norai.tech`
  (see `DEPLOYMENT_PLAYBOOK.md` at the repo root).
- **Parallel Docker path:** 3-stage unprivileged image + compose + SHA-gated
  `deploy.sh` (`DEPLOY_CONFIRM=1` before `git reset --hard origin/main`).
- **Canonical origin:** `NEXT_PUBLIC_SITE_URL` consumed by `app/layout.tsx`,
  `app/sitemap.ts`, `app/robots.ts`; `.env.example` is authoritative.
- **CSP profile** (`next.config.ts`):
  `connect-src 'self' https://api.github.com https://*.supabase.co wss://*.supabase.co`
  — the GitHub origin is the sole app-data egress and is browser-direct; the
  Supabase hosts are optional OAuth only and inert when the keys are absent.

## 8. Testing strategy

- **Unit (vitest, node):** every pure `_lib` module. Includes the caps grep
  suite, the `_lib` purity scan, the phase-rank protocol matrix, the Phase-B
  merge invariant, and the seeded-first-run guard.
- **E2E (Playwright, real standalone artifact)** — four spec files:
  - `smoke.spec.ts` — the surface journeys: redirect, landmarks, the seeded
    paint, the classification, the byte-identity of the first-paint rewrite, the
    empty diff, copy (⌘⇧C + per-pane + per-finding), the palette (including the
    Resolve & pin entry in both its enabled and inert states), theme flip,
    persistence shape, below-the-fold education, sign-in offer-never-lock, and
    the findings journey (AC-6 · AC-7 · AC-8).
  - `pipeline.spec.ts` — the compute contract: the worker happy path, the
    degraded main-thread path returning the SAME report, and the catastrophic
    watchdog journey (BAR §10 item 7).
  - `resolve.spec.ts` — the invocation guard, every pinned SHA, the receipts,
    the rate-limit and offline friendly copy, and the AC-12 URL-shape guard.
  - `visual.spec.ts` — structure and privacy: no overflow at 390/1440, stacking,
    the `main` max-width contract, the zero-egress request guard, zero uncaught
    errors, and the (skipped) pixel baselines.
- **Coverage:** `npm run test:coverage` gates the pure core (functions ≥ 90,
  lines/statements ≥ 80, branches ≥ 70) and is wired into `.github/workflows/ci.yml`.
- **Measurement:** `npm run bench` (`scripts/bench-phase-a.ts`) prints the real
  median/p95/max of the pure core on the machine named in `BENCHMARKS.md`; the
  default-path assertion is relative (`5k-line < 0.5 × WORKER_DEADLINE_MS`,
  `1k-line < 0.25 ×`).
- **Recorded VCR fixtures:** `_lib/__tests__/fixtures/*.json` replay the resolver
  chain (200-lightweight, 200-annotated + deref, 404, 403, 429) offline through
  the required `fetchImpl` seam.
- **Live oracle (gated, not in the default gate):** `.github/workflows/oracle.yml`
  runs `workflow_dispatch` + a weekly cron (`17 6 * * 0`) with `GH_LIVE=1`,
  re-resolves the recorded set and cross-checks each SHA with
  `git ls-remote … "refs/tags/<ref>^{}"`; a 403/429 or offline runner is
  reported SKIP, never FAIL.
