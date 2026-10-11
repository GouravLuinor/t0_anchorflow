# Anchorflow — QUALITY_REPORT.md

> An honest post-build audit. Every gate below was run in this repo, on this
> machine, for the commit it ships with. Failures and gaps are admitted, not
> hidden.

**Build:** v1.8.0 (2026-10-11) · branch `main` · machine: 13th Gen Intel Core
i7-13620H (12 threads), 6 GB RAM, Linux x86_64, Node v24.13.0.

## 1. Gates

| # | Gate | Command | Result |
|---|---|---|---|
| 1 | Install | `npm install` | **PASS** — 457 packages, registry `https://registry.npmjs.org` |
| 2 | Typecheck | `npm run typecheck` (`tsc --noEmit`) | **PASS** — 0 errors |
| 3 | Lint | `npm run lint` (`eslint .`) | **PASS** — 0 errors, 0 warnings (`no-explicit-any: error`, strict unused-vars) |
| 4 | Unit | `npm test` (`vitest run`) | **PASS** — 7 suites, 89 tests |
| 5 | Build | `npm run build` | **PASS** — standalone output at `.next/standalone` |
| 6 | E2E | `npm run test:e2e` (`playwright test`) | **PASS** — 21 passed, 2 skipped (pixel baselines, deliberately) |

### Gate 1 — install

```
$ npm install
added 457 packages in 1m
```

### Gate 2 — typecheck

```
$ npm run typecheck
> anchorflow@1.8.0 typecheck
> tsc --noEmit
(no output — 0 errors)
```

### Gate 3 — lint

```
$ npm run lint
> anchorflow@1.8.0 lint
> eslint .
(no output — 0 errors)
```

### Gate 4 — unit tests

```
$ npm test
 Test Files  7 passed (7)
      Tests  89 passed (89)
   Duration  ~0.4s
```

Suites: `analyze` · `compute` (the Phase-B merge invariant) · `protocol`
(phase-rank stale guard) · `constants` (caps grep + BAR item-7 mapping) ·
`presets` (seeded first run) · `authGate` (policy matrix incl. degraded storage
and no-`window`) · `purity` (`_lib` is IO-free).

### Gate 5 — build

```
$ npm run build
Route (app)                            Size  First Load JS
├ ○ /                                  135 B         103 kB
├ ○ /_not-found                        135 B         103 kB
├ ○ /icon · /robots.txt · /sitemap.xml
└ ○ /tools/anchorflow                  107 kB         213 kB
```

Standalone artifact verified on disk: `.next/standalone/server.js` with
`public/` and `.next/static/` staged in — the same artifact the Playwright
webServer boots and the Dockerfile ships.

### Gate 6 — e2e (real standalone artifact)

```
$ npm run test:e2e
  21 passed, 2 skipped
```

The webServer runs `npm run build && … && PORT=3004 HOSTNAME=0.0.0.0 node
.next/standalone/server.js`, so the suite exercises the shipped artifact (CSP,
worker packaging, hydration), not a dev server. Journeys covered: root redirect,
landmarks, single `h1`, seeded first paint, the **worker round trip** (paste →
worker → diagnostic mirror → counts), `⌘K` open/close, `⌘⇧C` copy with clipboard
assertion and lime toast, per-pane copy, light/dark toggle flipping `<html
class>` and persisting under `anchorflow-theme`, clear/example, persistence
under `anchorflow-tool-storage` (content-only shape, `autoResolve: false`),
guide/FAQ rendering with JSON-LD derived from the same array, no horizontal
overflow at 390 and 1440, stack-below-`lg`, `main` max-width contract, and the
zero-egress request guard with zero uncaught errors.

## 2. Worker round-trip proof (as observed)

The e2e journey fills the editor with `"alpha béta\n"` and asserts:

```
diagnostic-echo text  === "alpha béta\n"          (the worker echoed it back)
metrics grid: characters 11 · words 2 · bytes 12 · lines 1
status strip: Ready
external requests:      none
uncaught page errors:   none
```

That is the paste → Web Worker → render path, end to end, on the real artifact.

## 3. Measurements that matter

| Metric | Value |
|---|---|
| Phase A, 5,000-line fixture (4,760 lines / 166,724 B) | median **1.279 ms**, p95 1.686 ms (n = 50) |
| Phase A, 1,000-line fixture (960 lines / 33,374 B) | median **0.227 ms**, p95 0.531 ms |
| Phase A, 3× cap fixture (19,010 lines / 666,974 B) | median 7.734 ms analyzed at the 256 KiB cap |
| Worst case vs `WATCHDOG_MS` (1,500 ms) | **> 100× margin** |
| First Load JS, `/tools/anchorflow` | 213 kB (103 kB shared) |

Full commands and the machine note live in `BENCHMARKS.md`; a reviewer re-runs
them.

## 4. Open gaps (admitted)

1. **The domain analysis is not implemented.** No YAML parse, no `uses:`
   classification, no ref → commit SHA resolution, no permission / injection /
   danger-trigger audits, no pinned rewrite, no diff. The diagnostic pane renders
   the placeholder measurement the core actually returns. The seams (`types.ts`
   shapes, `analyzeResolve` merge invariant, `FetchLike` boundary, caps) are in
   place and tested.
2. **`autoResolve` is disabled, not implemented.** The toolbar switch is
   deliberately in the fifth state (disabled) with an explanatory tooltip, so it
   cannot silently no-op.
3. **First Load JS 213 kB vs the 200 kB budget** (`context.md` §4.1). Smaller
   than the RegexCraft route it mirrors, but over the stated budget. Candidate
   reductions for the polish pass: lazy-load the toaster's `framer-motion`
   dependency, tree-shake lucide icon imports per component.
4. **No `yaml` dependency yet.** The comment-preserving parse (eemeli `yaml`
   `Document` + `keepSourceTokens`) arrives with the domain pass, along with
   `refResolver.ts`, the audits, `yamlRewrite.ts`, `diff.ts` and `presets.ts`
   fixtures.
5. **No oracle job.** The live `git ls-remote` differential test and the
   recorded VCR fixtures are deferred with M2.
6. **No coverage thresholds wired.** `vitest.config.mts` runs the suites but the
   SchemaCraft-style coverage gates (`functions ≥ 90`, `lines/statements ≥ 80`,
   `branches ≥ 70`) are not enabled; the pure core is small and the suites are
   behaviour-complete, but the gate itself is missing.
7. **Pixel baselines are skipped by design**, with a regenerate note in the spec,
   so the visual suite is GREEN-or-SKIPPED rather than RED on stale goldens.
8. **`docs/ui-kit.md` is not shipped** (the bar lists it "as applicable"); the
   component inventory lives in `docs/DESIGN.md` §9 instead.

## 5. What is verified rather than claimed

- Zero egress is a **test** (`e2e/visual.spec.ts`), asserted on first paint,
  while typing, and while computing — with `autoResolve` defaulting to `false`.
- `_lib` purity is a **test** (`purity.test.ts`): no `fetch`, no `globalThis`,
  no `document`, no `window`, no React import in the compute modules, and zero
  runtime imports in `types.ts`.
- The caps are a **test** (`constants.test.ts`): every name resolves to exactly
  one declaration site with the published value, and the BAR item-7 mapping is
  asserted to be documented inline.
- The merge invariant is a **test** (`compute.test.ts`): a Phase-B envelope can
  never blank the offline report's `findings` / `uses` / `permissions`, and `ok`
  never flips on a network failure.
- The layout contract is a **test**: `main` carries `w-full overflow-x-hidden`
  and no `max-w-*`; every section carries `mx-auto` + `max-w-`; zero horizontal
  overflow at 390 px and 1440 px; the two panes stack below `lg`.
