# Anchorflow — Architecture & Engineering Directives

You are the Staff Design Engineer and Lead Systems Architect for **Anchorflow**
(`anchorflow`), a NorAI Tier-0 developer workstation.

---

## 1. Tool Identity & Scope

- **Name**: Anchorflow
- **Slug**: `anchorflow`
- **Category**: CI/CD Supply-Chain Security
- **Mission**: a 100% client-side GitHub Actions workstation — pin every action
  to an immutable commit, audit the `GITHUB_TOKEN`, detect injection sinks, and
  hand back a red/green diff of exactly what changed.
- **Port**: **3004** (pinned in `package.json`, `playwright.config.ts`,
  `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `README.md`; never 3000)
- **Route**: `/tools/anchorflow` (root `app/page.tsx` is a server `redirect()`)
- **Subdomain / PM2**: `anchorflow.norai.tech` · `anchor-norai`
- **Design Philosophy**: Zero-bloat, client-side first, sub-millisecond tactile
  feedback, a security-printing world implemented by the **Certified Copy**
  design system (see §2.1). One authored motion. Mono means machine data.

---

## 2. Non-Negotiable Engineering Axioms

### 2.1 Certified Copy (the visual world)

Anchorflow's world is security printing: the page is a certified copy of your
workflow. `DESIGN.md` (root) and `.impeccable/design.json` are the source of
truth; tokens live in `app/globals.css` (`:root` light, `.dark` on the same
names) as RGB triplets, and `tailwind.config.ts` **replaces** `theme.colors`
with only these names, so a raw palette class (`zinc-400`, `lime-500`) does not
compile.

- **Ground**: `paper` · `sheet` (the certified copy) · `sunk` (code wells) ·
  `band` (header/footer) · rules `line` / `line-strong`.
- **Ink**: `ink` · `ink-2` · `ink-3`. Every text role clears 4.5:1 on paper,
  sheet, band and the composited wells/tints in both themes — asserted by
  `app/tools/anchorflow/__tests__/contrast.test.ts`, which parses globals.css.
- **One job per colour**: `seal` = pinned / primary / focus · `moving` = an
  unpinned (floating) ref · `critical` / `major` = finding grades, a refused
  ref, the scan cap, the rate limit, truncation.
- **Type**: Schibsted Grotesk for UI; Martian Mono at `font-stretch: 87.5%` for
  machine data only (YAML, SHAs, refs, receipts). `.figures` for tabular
  numerals.
- **Shape**: 2px radius, no panel shadows (`shadow-pop` is for overlays only),
  1px rules. The guilloché rule sits under the header and above the footer and
  nowhere else.
- **Signature**: every pinned row wears a guilloché seal drawn from its SHA
  (`_lib/seal.ts`, pure + tested; `_components/Seal.tsx`). A pin that lands in
  this session draws itself in (420 ms stroke, the one authored motion). An
  unpinned ref wears an open (dashed) seal.
- **Craft floor**: no eyebrows, no gradient text, no glass, no icon-card grids,
  no section numbers, no hero metrics, no coloured border-left over 1px, no
  emoji icons. Mono is never decorative.

### 2.2 Dual-theme requirement

Every surface ships **light + dark**. `darkMode: ["class"]` in
`tailwind.config.ts`; `next-themes` drives `<html class>` via
`_components/providers/ThemeProvider.tsx` (`storageKey="anchorflow-theme"`,
`attribute="class"`, `defaultTheme="system"`, `enableSystem`,
`disableTransitionOnChange`); `<html suppressHydrationWarning>` in
`app/layout.tsx`; and a **mounted-gated** `ThemeToggle` so pre-hydration paint is
stable. Theme preference (`anchorflow-theme`) and content
(`anchorflow-tool-storage`) are **never** merged into one store. A component that
only works in one theme is unfinished.

### 2.3 Off-main-thread heavy compute

All parsing, computation and formatting MUST execute inside
`app/tools/anchorflow/_workers/compute.worker.ts`, delegating to the pure core in
`_lib/analyze.ts` + `_lib/compute.ts`. The UI thread must never freeze. The
synchronous main-thread fallback shares the exact same core, so semantics cannot
drift — see `docs/blueprint.md` §2.

### 2.4 Interaction states on all controls

Every button, tab, switch, input and menu item has idle, hover, pressed,
`:focus-visible` (the global 2px `seal` outline, offset 2px) and disabled
(`disabled:cursor-not-allowed disabled:opacity-50`) states. Transitions are
`duration-150` on the properties that change, and the global kill-switch in
`globals.css` collapses every animation and transition under
`prefers-reduced-motion`.

### 2.5 The worker contract (do not weaken)

- **Monotonic id + phase rank.** `_lib/protocol.ts` owns the pure guard: a `B`
  for the current id is accepted after its `A`; a duplicate `B` or a late `A` is
  dropped. Every reply carries the full envelope.
- **Adaptive debounce**: ≤ 5,000 chars → 0 ms · > 5,000 → 40 ms · > 20,000 →
  120 ms.
- **Readiness handshake.** The worker posts `{type:"ready"}` when its module
  has evaluated; dispatches are held until then, the watchdog arms only on a
  real send, and a worker that never becomes ready degrades to the main thread
  after 15 s (`WORKER_BOOT_TIMEOUT_MS`). A slow first load is never a false
  timeout.
- **Watchdog 1.5 s on Phase A only.** Terminate + respawn, bump the request id,
  settle the friendly error, announce. Phase B is network work: abortable, never
  watchdogged.
- **Single `degradeToMainThread()`** on `onerror` / `onmessageerror`: kill timers,
  terminate the worker, flip `isWorkerAvailable`, run the same core on the main
  thread at `SYNC_DEADLINE_MS`, announce once.
- **Announcements** trail by 800 ms so a typing burst collapses into one
  screen-reader update; errors settle immediately.

### 2.6 Layer rules

- `_lib/` stays **pure**: no React, no DOM, no IO, and **never** a `fetch` call
  (enforced by `_lib/__tests__/purity.test.ts`). The worker and the main-thread
  fallback each supply the network seam at their own boundary.
- `_lib/types.ts` has **zero runtime imports** — types + the worker protocol
  only.
- `_workers` imports **only** `_lib`.
- `_components` may import `_lib` and `_store`, **never the reverse**.
- New capability loop: define in `_lib` first → red/green the test in
  `_lib/__tests__/` → extend the envelope in `types.ts` and pass it through →
  settle it inside the atomic action → render it with all five states → extend
  the Playwright journey. A keystroke-path capability goes through the debounce
  tiers + watchdog, never a new timer.

### 2.7 Privacy is a test, not a claim

- `autoResolve` defaults to **`false`**. The default path makes zero external
  requests, asserted in the default CI path by `e2e/visual.spec.ts`.
- The only declared egress is `connect-src https://api.github.com` (+ optional
  env-gated Supabase OAuth hosts). The CSP and the request guard's allow-list
  must stay exactly equal.
- Sign-in is **offer, never lock**: no core surface is ever gated.
- `shouldPromptSignIn` stays pure and unit-tested, including the degraded
  `localStorage` and no-`window` paths.

### 2.8 State split

- **Persisted (content only)**: `source`, `autoResolve` — per-tool key
  `anchorflow-tool-storage`, `version: 1`, `skipHydration: true`, defensive
  `merge()`.
- **Transient**: report, metrics, `isProcessing`, `errorMessage`,
  `isWorkerAvailable`, `resolveStatus`, `rateLimit`, palette/modal state,
  `statusAnnouncement`.
- **Atomic settle**: one `applyResult()` sets everything in a single `set()`, and
  takes each report field from the payload only when it is defined so a partial
  envelope can never blank the offline report.

### 2.9 Quality gates (all green, in this order)

```
npm run typecheck → npm run lint → npm test → npm run build → npm run test:e2e
```

E2E boots the **real standalone artifact** (`node .next/standalone/server.js` on
port 3004 with `public` + `.next/static` staged in), never a loose dev server.
