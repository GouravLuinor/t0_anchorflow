# Changelog

All notable changes to Anchorflow are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
calendar versioning for release passes (`MAJOR.MINOR.PATCH` dated per entry).

**Version reset (stated, not hidden).** The internal scaffold pass below is
numbered **1.8.0** — it was the last numbered build of the *shell*, before the
domain pass was finished. The first release of the finished product resets to
**1.0.0**, so the public version starts at the product's first shippable state
rather than inheriting the shell's bump count. The newest entry is therefore
`1.0.0`, and `1.8.0` is kept below it as the historical record of the scaffold.

[Unreleased]: https://anchorflow.norai.tech
[1.0.0]: https://anchor.norai.tech

## [Unreleased] — 2026-10-22 — Certified Copy redesign (branch `redesign`)

### Changed
- New visual world, **Certified Copy** (security printing), replacing
  Matchlight: own token set, Schibsted Grotesk + condensed Martian Mono, 2px
  radii, guilloché rule, and a seal generated from every pinned SHA
  (`_lib/seal.ts`). `DESIGN.md` + `.impeccable/design.json` replace
  `docs/DESIGN.md`, `design_tokens.json` and `docs/surface-brief.md`.
- The workstation answers first: a verdict sentence and one next step, then a
  uses ledger with per-pin receipts, then Findings · Token grants · Pinned file
  · Diff tabs. The old toolbar, diagnostic pane and metrics grid are gone.
- H1 is the search intent ("Pin GitHub Actions to commit SHAs, in your
  browser"). The comparison now names categories, not brands, and its claims
  were corrected.
- Canonical origin is `https://anchorflow.norai.tech`.

### Added
- Six guide pages under `/tools/anchorflow/learn/*` with TechArticle +
  BreadcrumbList JSON-LD; WebApplication JSON-LD beside FAQPage; OG image;
  `llms.txt`; sitemap entries for every guide.
- The Nor AI family footer with the other free tools.

### Fixed
- Worker readiness handshake: dispatches wait for the worker's `ready`
  message, so a slow first load no longer shows a false "time budget" error.
- The sign-in modal no longer claims saved state that doesn't exist.

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
  requests, asserted in CI by `e2e/visual.spec.ts`. The default-path guard's
  allow-list is empty (nothing may leave the origin), and the CSP separately
  *declares* `api.github.com` as the only app-data egress the opt-in resolver may
  use — the permission is granted there, the default simply never spends it. Every
  request the resolver does make is re-checked for origin, empty query, empty
  fragment and a traversal-free owner/repo.

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

### Changed — the review-fix pass (same release)

Two independent reviews returned GO-WITH-FIXES; every finding is applied here
rather than carried forward.

- **Determinism:** `resolutionFindings` no longer reads the ambient clock. The
  rate-limit countdown is rendered against the `nowMs` the caller injects — the
  same one the resolver stamps receipts with — pinned by a regression test that
  builds a **future-dated 429 fixture twice** and asserts byte-identical output.
- **Byte-accurate input cap:** `truncateForDispatch` (moved into `_lib` so it can
  be unit-tested without a DOM) gates on `countBytes` and cuts on a code-point
  boundary. A CJK-heavy paste can no longer sail past the cap, and a surrogate
  pair can no longer be split.
- **Path safety:** the resolver now refuses an owner, repo or ref that fails a
  charset / `..`-traversal / length check — reporting it as a `resolution`
  finding with the reason, before any request is sent. Never a silent fetch and
  never a silent drop. The e2e AC-12 shape guard was tightened to the same rule.
- **Contrast:** the status-strip separators move from `text-zinc-600` (3.0:1 light
  / 3.6:1 dark — below AA) to `text-zinc-500` (4.6:1 / 5.1:1). The ratios are
  computed from the shipped `app/globals.css` by a new test, so the claim cannot
  drift again.
- **Silent drop:** a capped `uses:` scan now reports itself. The core carries
  `usesSeen` alongside `usesScanned`, and an amber strip states how many nodes
  were analysed and how many were not.
- **Dead code:** `isFreshResponse` is deleted; the single `isStaleDispatch`
  guard now covers both the inbound dispatch and the outbound reply.
- **Correctness:** `useAuth` no longer labels this tool `regexcraft`.
- **Bar artifacts:** `.github/workflows/oracle.yml` (weekly live differential
  oracle, skip-not-fail on 403/429), coverage gates scoped to the pure core in
  `vitest.config.mts` + `test:coverage` wired into `ci.yml`,
  `scripts/bench-phase-a.ts` + `npm run bench` (+ pinned `tsx`), a
  `git status --porcelain` refusal guard in `deploy.sh` ahead of the reset, and
  `ecosystem.config.js` (PM2 `anchor-norai`).
- **Polish:** a "Resolve & pin" command in the ⌘K palette (inert when nothing is
  pending), the keycap shadow as a theme-aware token, a monochrome provider mark,
  a press state on the FAQ summary, a disabled variant on the per-finding copy,
  a one-line severity legend, `TRUST_PILLS` rendered from its single source, and
  the dead `lib/clipboard.ts` removed.
- **Docs:** every document is regenerated from the shipped surface and the
  measured numbers — the `_lib` module map, the failure-mode copy, the token table
  and the caps table now match the code.

### Fixed — the round-3 AC-13 correction (same release)

A third independent verification pass returned SHIP-AFTER-FIXES with one
critical finding and a set of numeric slips. The critical one was real: the
worker dispatch cap lost the input's true size.

- **The byte cap no longer hides the input's real size (SPEC §9 AC-13).**
  `truncateForDispatch` returned only the sliced text, so the worker payload
  carried 262,144 bytes of an already-capped source and nothing else.
  `analyzeLocal` measured what it was given: `bytes = 262144`,
  `truncated = false`, and the amber "trimmed to 256 KiB" chip never rendered.
  A 334,933-byte paste therefore looked ~73 kB smaller than it was — and the
  forced-degrade path, which receives the full source, reported the true count,
  so the two engines openly disagreed on the same paste.
  `truncateForDispatch` now returns the whole `Truncation` (text +
  `originalBytes` + `truncated`); the dispatch payload carries
  `originalByteCount`; `analyzeLocal` reports
  `metrics.byteCount = originalByteCount ?? countBytes(actualSource)` with
  `truncated = originalByteCount > MAX_INPUT_BYTES`; and the main-thread
  fallback hands over the full source so `truncateToCap` derives the same two
  numbers. The payload stays bounded at the cap — the clone never carries the
  uncapped source — and the worker's Phase-A report LRU is keyed on
  `originalByteCount` + source, because two different oversize pastes can slice
  to the same 256 KiB prefix. Both engines now agree, metric for metric, on an
  oversize paste.
- **Test integrity:** `playwright.config.ts` set `reuseExistingServer: !CI`,
  which silently adopted whatever was already listening on 3004 — an orphan
  `next-server` nearly produced a false green against a stale artifact. Reuse is
  now disabled locally as well as in CI: Playwright refuses to start while the
  port is busy, so a stale server fails loudly instead of serving the suite a
  green lie.
- **Tests:** an input-cap e2e journey pastes 320,000 bytes and asserts the TRUE
  byte count, the amber cap chip, the capped dispatch payload that really
  crossed into the worker, and the worker/forced-degrade agreement; unit tests
  cover the carried count, both engines' identical metrics and the defensive
  over-cap case; `actionCatalog.ts` — 10.7 KB of real logic with no suite of its
  own — has one now (24 cases).
- **Docs regenerated from measurement:** coverage recomputed from
  `npm run test:coverage` (branches 80.76 % → **82.36 %**,
  `refResolver.ts` statements 85.1 % → **88.44 %**); the nested-flow memory
  probe re-measured on ten clean processes per shape (+46.5…+62.6 MiB nested,
  +17.3…+21.8 MiB flat) after the previous range did not reproduce; the bench
  table re-measured over ten consecutive runs; the machine row corrected to the
  12 logical CPUs `nproc` actually reports; README's bench summary aligned to
  `BENCHMARKS.md`; compile-vs-wall times separated (build 14.6 s compile /
  47.7 s wall); "eight `uses:` classes" corrected to **six** in `README.md` and
  `docs/PRODUCT.md`; the "every `_lib` module has a suite" claim softened to
  name its three exceptions; and the `next/font` build-time-vs-runtime caveat
  stated in README.

### Performance

First Load JS for `/tools/anchorflow` is **180 kB** against the 200 kB budget.

The happy path weighs nothing extra: the parser, the audits and the resolver
are reached only by the worker chunk and by the on-demand main-thread
fallback, both of which are dynamic boundaries. `framer-motion` is loaded the
first time a toast actually appears. The remaining first load is Next.js/React
framework plus the workstation chrome — measured in `BENCHMARKS.md`.

## [1.8.0] — 2026-10-11 — the application shell

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

All four gaps above are **closed by 1.0.0**: the domain core, the `yaml`
dependency and the gated live-oracle job all ship in the release above, and First
Load JS is 180 kB — 20 kB under budget. They are left here as the honest record of
what the 1.8.0 shell did not have.

[1.8.0]: https://anchor.norai.tech
