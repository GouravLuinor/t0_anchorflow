# Changelog

All notable changes to Anchorflow are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
calendar versioning for release passes (`MAJOR.MINOR.PATCH` dated per entry).

## [1.0.0] — 2026-10-11 — First production release

### Added

The complete Anchorflow workstation: an offline GitHub Actions hardener that
parses, classifies, rewrites, audits and diffs a workflow entirely in the
browser, with an opt-in read-only GitHub resolver for SHA pinning.

**Offline core (Phase A — zero network, zero egress)**
- Structural `uses:` collection from the eemeli `yaml` document, with offsets
  preserved on a code-point boundary, plus an input cap
  (`MAX_INPUT_BYTES = 262_144`) that reports rather than silently drops.
- Six-class classification over two scopes: pinned `sha40` · fixed dotted tag ·
  moving major/minor · `local` · `docker` · `invalid`, with the moving-ref rule
  and a per-node `# line N · jobs.<id>.steps[i].uses` annotation.
- Offset-surgical rewrite that re-emits pinned SHAs while keeping the author's
  comments and flow spacing byte-for-byte, and the red/green unified diff of
  that rewrite. With no resolutions the rewrite is a byte-identical NO-OP.
- Four audits over the SAME `WorkflowModel` the classifier reads, concatenated
  into one canonical deterministic findings array (offset, then category, then
  id): **permission** grants (top-level and per-job), **template injection**
  sinks in untrusted `${{ … }}` interpolations, **dangerous triggers**
  (`pull_request_target`, `workflow_run`), and **persist-credentials**
  (`contents: write` on checkout). Grouped and rendered by severity band.
- Effective `GITHUB_TOKEN` grant table per job, including inheritance through
  `permissions: write-all` and reusable-workflow scopes.

**Read-only GitHub resolver (Phase B — opt-in)**
- Unauthenticated GETs of `api.github.com` refs endpoints only, resolving each
  `uses:` to an immutable commit SHA through both hops of an annotated tag.
- SHA pinning written into the rewrite with the diff repainting, plus resolution
  receipts: `<endpoint> → <tag-object-sha> → <commit-sha>`, the `ls-remote`
  cross-check line and a `resolvedAt` stamp, in call order.
- Rate-limit UX: an advisory hourly budget ledger, a rate-limit banner (never a
  blocker — the offline report stays complete), a negative TTL for 404s so a
  repeated typo never re-spends quota, and a debounced Phase B that never fires
  per keystroke.
- `autoResolve` defaults to **OFF**: the default path makes zero external
  requests, asserted in CI by `e2e/visual.spec.ts`. The request guard's
  allow-list and the CSP `connect-src` are exactly equal.

**Architecture**
- Web Worker pipeline (`_workers/compute.worker.ts`) owning all parsing,
  computation and formatting: monotonic request ids behind a phase-ranked
  stale-response guard, adaptive debounce (0/40/120 ms by input length), a
  1.5 s terminate-and-respawn watchdog on Phase A only, and an artifact LRU.
- Main-thread fallback (`degradeToMainThread`) that runs the **same** pure core
  as the worker at the stricter sync deadline, dynamically imported at degrade
  time so the parser never rides in First Load JS. Degradation re-arms the
  dispatch, so a worker that dies before replying still yields the same report.
- `_lib/` stays pure (no React, no DOM, no IO, never a `fetch`) with a
  purity test, zero-runtime `_lib/types.ts`, and every cap in one
  `_lib/constants.ts`.
- Dual-theme Matchlight surface (light + dark, next-themes class strategy),
  the five interaction states on every control, one authored motion, and
  keyboard shortcuts (`⌘K` palette, `⌘P` example, `⌘⇧C` copy, `⌘↵` focus).

### Performance

First Load JS for `/tools/anchorflow` is **180 kB** against the 200 kB budget.

The happy path weighs nothing extra: the parser, the audits and the resolver
are reached only by the worker chunk and by the on-demand main-thread
fallback, both of which are dynamic boundaries. `framer-motion` is loaded the
first time a toast actually appears. The remaining first load is Next.js/React
framework plus the workstation chrome — measured in `BENCHMARKS.md`.

[1.8.0]: https://anchor.norai.tech

## [1.8.0] — 2026-10-11

### Added — Tier-0 application shell (this build)

The runnable end-to-end placeholder: paste → Web Worker → render → instant copy,
dual-theme, fully packaged. No domain analysis logic yet; the seams are typed and
tested.

**Shell & UX**
- Single centered page at `/tools/anchorflow` (root `app/page.tsx` server
  `redirect()`), composition order per the bar: sticky `SiteHeader` → station
  `h1` + tagline + three trust pills → one workstation card (`TopToolbar` +
  `RawEditorPane` | `DiagnosticPane` + status strip) → `CompetitorMatrix` →
  `KnowledgeHub` → `FaqSection` → `StudioFooter`.
- Skip link to `#workstation`, exactly one `<h1>`, `banner`/`main`/
  `contentinfo` landmarks, no `max-w-*` on `<main>`, per-section
  `mx-auto w-full max-w-7xl px-4 md:px-6 lg:px-8`.
- Two-pane workstation that stacks below `lg`; `RawEditorPane` is a real
  controlled `<textarea>` wired to the persisted store.
- Global mounts outside the workstation card: ⌘K `CommandPalette`,
  `SignInModal`, `StatusLiveRegion`, `Toaster`.
- Keyboard set: `⌘K/⌃K` palette, `⌘P/⌃P` insert the example workflow,
  `⌘⇧C/⌃⇧C` copy the diagnostic output, `⌘↵/⌃↵` focus the input.
- Instruction-free empty states, `aria-label`s on every control, `role="status"`
  announcements behind an 800 ms trailing debounce.

**Compute pipeline**
- `_workers/compute.worker.ts`: off-main-thread entry, phase-ranked stale guard,
  artifact LRU (`ARTIFACT_CACHE_CAPACITY = 32`, size-guarded), deadline
  self-report, last-resort envelope with consistent counts.
- `_hooks/useToolWorker.ts`: monotonic ids, adaptive debounce (0/40/120 ms),
  1.5 s watchdog (terminate + respawn), single `degradeToMainThread` running the
  same pure core at `SYNC_DEADLINE_MS`, Phase-B scheduler behind `autoResolve`
  (off by default) with a worker-scope `AbortController`, 800 ms announce trail.
- `_lib/analyze.ts` — the placeholder measurement: the analyzed text echoed back
  plus character / word / byte / line counts, with code-point-safe truncation at
  `MAX_INPUT_BYTES` and the original byte count reported.
- `_lib/compute.ts` — Phase A (`runPhaseA`) and Phase B (`analyzeResolve`)
  implementing the C1 merge invariant: the Phase-A report is taken as the merge
  input, the offline findings are never blanked, and `ok` never flips on a
  network failure.
- `_lib/protocol.ts` — the pure phase-rank stale guard (a `B` after its `A` is
  accepted; a duplicate `B` or a late `A` is dropped).

**State**
- `_store/useToolStore.ts` — zustand `persist` content-only
  (`{ source, autoResolve }`) under `anchorflow-tool-storage` v1,
  `skipHydration` + explicit rehydrate, defensive `merge`, atomic `applyResult`
  with the field-merge guard.
- `_store/useAuthPromptStore.ts` for the offer-never-lock sign-in prompt.

**Design system**
- Matchlight token ladder reused verbatim in `app/globals.css` +
  `tailwind.config.ts` (lime primary; violet/amber/rose semantic; inverted zinc
  the only neutral), `scan-sweep` as the one authored motion, global
  `prefers-reduced-motion` kill-switch, themed selection/caret/scrollbars.
- All five interaction states on every control; `design_tokens.json` mirrors the
  ladder.

**Auth (env-gated no-op)**
- `_lib/supabaseClient.ts` singleton-promise lazy dynamic import, env-gated
  `null`; `_hooks/useAuth.ts`; `authGate.ts` policy with the degraded-storage and
  no-`window` paths; `SignInButton` explains itself instead of dead-ending when
  unconfigured.

**Packaging & ops**
- `next.config.ts`: `output: "standalone"`, CSP (dev-only `unsafe-eval`,
  `frame-ancestors 'none'`, `base-uri 'self'`, `object-src 'none'`), HSTS
  `max-age=63072000; includeSubDomains; preload`, `nosniff`, `Referrer-Policy`,
  `Permissions-Policy`, `poweredByHeader: false`; `connect-src` allows
  `'self' https://api.github.com` + optional Supabase OAuth hosts.
- 3-stage unprivileged `Dockerfile` (port 3004, healthcheck), `docker-compose.yml`
  bound to `127.0.0.1:3004:3004`, `Caddyfile` → `anchor.norai.tech`, SHA-gated
  `deploy.sh`, `.dockerignore`, `.env.example`.
- `.github/workflows/ci.yml` — typecheck → lint → unit → build → Playwright on
  the standalone artifact.

**Tests & docs**
- 7 vitest suites / 89 tests: `analyze`, `compute` (the merge invariant),
  `protocol` (phase-rank), `constants` (caps grep + BAR item-7 mapping),
  `presets` (seeded first run), `authGate` (policy matrix), `purity` (`_lib` is
  IO-free).
- Playwright: `smoke.spec.ts` (redirect, landmarks, seeded first paint, the
  worker round-trip, ⌘K, ⌘⇧C with clipboard assertion, theme flip, persistence
  shape, FAQ JSON-LD) and `visual.spec.ts` (no overflow at 390/1440, stack-below
  `lg`, single-column sections, `main` max-width contract, zero-egress request
  guard, zero uncaught errors).
- Docs: `README.md`, `AGENTS.md`, `BENCHMARKS.md`, `QUALITY_REPORT.md`,
  `RELEASE_CHECKLIST.md`, `docs/DESIGN.md`, `docs/blueprint.md`,
  `docs/PRODUCT.md`, `docs/surface-brief.md`, `tutorial.md`, `LICENSE` (MIT).

### Known gaps (admitted, not hidden)

- The domain analysis is not implemented: no YAML parse, no `uses:`
  classification, no ref → commit SHA resolution, no permission/injection/
  danger audits, no pinned rewrite, no diff. The diagnostic pane renders the
  placeholder measurement the core actually returns.
- `autoResolve` ships disabled with an explanatory tooltip rather than a silent
  no-op.
- First Load JS is 213 kB against the 200 kB budget (measured; see
  `BENCHMARKS.md`).
- No `yaml` dependency yet, and no oracle job — both arrive with the domain pass.

[1.8.0]: https://anchor.norai.tech
