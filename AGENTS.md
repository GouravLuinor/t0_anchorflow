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
- **Subdomain / PM2**: `anchor.norai.tech` · `anchor-norai`
- **Design Philosophy**: Zero-bloat, client-side first, sub-millisecond tactile
  feedback, machined Linear/Raycast aesthetic implemented by the **Matchlight**
  design system (see §2). One authored motion. Mono means machine data.

---

## 2. Non-Negotiable Engineering Axioms

### 2.1 Matchlight surface ladder (reused verbatim from the sibling bar)

Do not invent a second visual language. Tokens live in `app/globals.css`
(`:root` light, `.dark` overrides on the same variable names),
`tailwind.config.ts`, and `design_tokens.json`. The craft-floor rules in
`docs/DESIGN.md` §8 are binding.

- **Canvas** (warm porcelain light / deep pine dark): `#fafaf7` / `#0c0e0b`
- **Ink**: `#181a15` / `#eceee4` — >10:1 on canvas in both themes (WCAG AAA)
- **Surfaces**: `surface-base` `#ffffff` / `#12120f` · `surface-subtle` `#f4f4ee` /
  `#171a14` · `surface-default` `#ffffff` / `#1b1e18` · `surface-elevated`
  `#fafaf6` / `#242820`
- **Hairlines**: `surface-border` `#e2e2d8` / `#2e3328`; hover
  `surface-borderHover` `#cbcbbd` / `#42493a`
- **One accent**: `brand-lime` `#3f6212` / `#bef264` — marks pin / primary /
  active / the privacy promise, and nothing else
- **Semantic state only**: `brand-violet` = capture/secondary scope ·
  `brand-amber` = warn/degraded/truncation/rate-limit · `brand-rose` = error
  finding / copy-failure toast
- **Inverted zinc is the only neutral.** `text-zinc-100` → headings · `-300` →
  secondary · `-400` → muted · `-500` → faint mono. No raw named palettes.
- **Craft floor**: no eyebrow kickers (small uppercase mono labels live only
  inside tool panes as functional measurements), no gradient text, no icon-card
  spine, no section numbers, no decorative glass, mono never decorative.
  `.glass-edge` is one inset hairline + one soft shadow; blur exists only in the
  sticky header and the palette scrim.
- **4px/8px modular grid.** Never `p-[13px]` / `w-[317px]`.

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

### 2.4 Five interaction states on all controls

Every button, card, tab, keycap, switch, input and menu item implements:

1. `Idle` — `border-surface-border bg-surface-subtle text-zinc-400`
2. `Hover` — `hover:border-surface-borderHover hover:bg-surface-elevated hover:text-zinc-100`
3. `Active / Pressed` — `active:scale-[0.97]` (`[0.98]` on larger controls)
4. `Focused` — `focus-visible:ring-2 focus-visible:ring-brand-lime/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas`
5. `Disabled / Loading` — `disabled:cursor-not-allowed disabled:opacity-50`

Transitions are `duration-150 ease-out-expo` restricted to the properties that
change, and collapse to 0.01 ms under `prefers-reduced-motion`. The single ring
value is `ring-brand-lime/70` on controls and `/40` on the `<details>` summary;
pick one per role and keep `docs/DESIGN.md` in agreement.

### 2.5 The worker contract (do not weaken)

- **Monotonic id + phase rank.** `_lib/protocol.ts` owns the pure guard: a `B`
  for the current id is accepted after its `A`; a duplicate `B` or a late `A` is
  dropped. Every reply carries the full envelope.
- **Adaptive debounce**: ≤ 5,000 chars → 0 ms · > 5,000 → 40 ms · > 20,000 →
  120 ms.
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
