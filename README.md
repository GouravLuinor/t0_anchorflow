# Anchorflow

> Pin, audit and diff GitHub Actions workflows — entirely in your browser.

Part of the **Nor AI Tier-0** suite of high-density, client-side developer
workstations — machined Linear/Raycast-class UI (light + dark), off-main-thread
compute, and zero server-side handling of your workflow file.

---

## Overview

Anchorflow turns the two chores every Actions team eventually faces — **pin every
action to an immutable commit** and **stop over-permissioning
`GITHUB_TOKEN`** — into a paste-and-copy operation.

**Status of this build (v1.8.0, the application shell):** the shell, the worker
pipeline, the dual-theme design system, the state split and the packaging are
complete and green. The analysis core currently ships the **placeholder
measurement**: paste a workflow and the worker returns the analyzed text plus
character / word / byte / line counts, mirrored live into the diagnostic pane
with an instant-copy affordance. The domain logic (YAML parse, `uses:`
classification, ref → commit resolution, permission audit, injection detection,
the pinned rewrite and the red/green diff) lands in the next pass behind the
seams this build already exposes — see [Known gaps](#known-gaps-for-the-domain-agent).

---

## Key features (shipped)

- **Worker-first pipeline.** Every edit dispatches to `_workers/compute.worker.ts`
  behind a monotonic request id with a phase-ranked stale guard, adaptive
  debounce (0 / 40 / 120 ms by input size), and a 1.5 s watchdog that terminates
  and respawns the worker instead of freezing the tab. A worker failure degrades
  to the **same pure core** on the main thread — never a lie about being async.
- **Live diagnostic mirror.** The output pane renders exactly what the worker
  posts: the placeholder measurement today, the derived surfaces tomorrow.
- **Instant copy everywhere.** Per-pane copy button and `⌘⇧C`, both through one
  clipboard helper (async Clipboard API → hidden-textarea `execCommand`
  fallback), each with a brand-lime success toast and a rose failure toast.
- **Dual-theme Matchlight design system.** The warm-porcelain light theme and the
  deep-pine dark theme ship flawless: ink on canvas clears > 10:1 (WCAG AAA) in
  both, with a mounted-gated theme toggle, per-tool `storageKey`, and a global
  `prefers-reduced-motion` kill-switch. One accent (lime) is spent only on pins,
  primary actions and the privacy promise; violet/amber/rose are strictly
  semantic.
- **Five interaction states on every control.** Idle · hover · active
  (`scale-[0.97]`) · focus-visible (accent ring) · disabled/loading, all at
  `duration-150 ease-out-expo` and collapsing to 0.01 ms under reduced motion.
- **One page that hosts everything.** Sticky `SiteHeader` → station `h1` + trust
  pills → one workstation card (`TopToolbar` + RawEditorPane | DiagnosticPane) →
  `CompetitorMatrix` → `KnowledgeHub` → `FaqSection` → `StudioFooter`, with the
  ⌘K command palette, sign-in modal, live region and toaster mounted globally.
- **Persisted content, transient state.** Your workflow text and the
  `autoResolve` opt-in persist under `anchorflow-tool-storage` v1; results,
  metrics, worker health and UI chrome never do. `autoResolve` defaults **off**,
  so a first paint makes **zero** external requests.
- **Optional auth that gates nothing.** A Supabase client is a lazy dynamic
  import behind env keys; with the keys absent, sign-in explains itself and every
  core surface stays copyable with no account.

---

## Stack

- **Next.js 15** (App Router, `output: "standalone"`) · **React 19** · **TypeScript** (strict)
- **Tailwind CSS ^3.4** + `tailwindcss-animate` · **Matchlight** token ladder
- **zustand ^5** (persist, content-only, `skipHydration` + explicit rehydrate)
- **next-themes ^0.4** (`attribute="class"`, `storageKey="anchorflow-theme"`)
- **@supabase/supabase-js ^2** — optional, env-gated, inert by default
- Radix UI primitives + `lucide-react` icons; `framer-motion` for the toaster
- **vitest ^4** (node env, pure core) · **@playwright/test ^1.6x** (real standalone artifact)

---

## Prerequisites

- **Node.js ≥ 20** (22 recommended; built on 24)
- npm 10+

---

## Getting started

```bash
npm install
cp .env.example .env.local   # optional — the tool is fully functional without it
npm run dev
```

Open [http://localhost:3004/tools/anchorflow](http://localhost:3004/tools/anchorflow).
`/` redirects there (a server `redirect()`, so the root ships no client JS).

### Verify

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint . (no-explicit-any: error)
npm test            # vitest — 7 suites, 89 tests
npm run build       # production build (standalone)
npm run test:e2e    # Playwright — boots the real standalone artifact
```

`npm run test:e2e` builds once and then serves the packaged standalone artifact
with its `public/` + `.next/static/` staged in. If a server is already listening
on 3004, Playwright adopts it (`reuseExistingServer`) — so kill a stale
standalone from an earlier build before re-running, or you will test the old
artifact.

---

## Scripts

| Script | What it does |
|---|---|
| `dev` | Next.js dev server on port **3004** |
| `build` | Production build (standalone output for PM2/Docker) |
| `start` | Serve the production standalone build on port **3004** (PM2 `anchor-norai` in production) |
| `lint` | ESLint across the repo |
| `typecheck` | TypeScript strict check (`tsc --noEmit`) |
| `test` | Vitest unit tests (`**/__tests__/**/*.test.ts`) |
| `test:watch` | Vitest in watch mode |
| `test:e2e` | Playwright smoke + visual suites (Chromium) |

CI mirrors this order exactly — `.github/workflows/ci.yml`: typecheck → lint →
unit → build → Playwright on the standalone artifact, artifacts uploaded on
failure.

---

## Architecture

```
app/
├── layout.tsx                      # fonts, metadataBase from NEXT_PUBLIC_SITE_URL, ThemeProvider
├── page.tsx                        # server redirect() → /tools/anchorflow
├── robots.ts · sitemap.ts · icon.tsx
├── error.tsx · global-error.tsx · not-found.tsx
└── tools/anchorflow/
    ├── page.tsx                    # single page: header → station → workstation → matrix/guide/faq → footer
    ├── _components/
    │   ├── TopToolbar.tsx          # offline posture, auto-resolve opt-in (disabled until M2), Example/Clear
    │   ├── RawEditorPane.tsx       # the input <textarea> (persisted source)
    │   ├── DiagnosticPane.tsx      # the worker-output mirror + instant copy
    │   ├── SiteHeader.tsx · StudioFooter.tsx · ThemeToggle.tsx
    │   ├── CommandPalette.tsx · StatusLiveRegion.tsx
    │   ├── CompetitorMatrix.tsx · KnowledgeHub.tsx · FaqSection.tsx
    │   ├── auth/SignInButton.tsx · auth/SignInModal.tsx
    │   └── providers/ThemeProvider.tsx
    ├── _hooks/
    │   ├── useToolWorker.ts        # worker lifecycle, phase-ranked stale guard, debounce, watchdog, degrade
    │   ├── useKeyboardShortcuts.ts # ⌘K · ⌘P · ⌘⇧C · ⌘↵
    │   └── useAuth.ts              # env-gated Supabase session
    ├── _lib/                       # PURE: no React, no DOM, no IO, no fetch
    │   ├── types.ts                # zero-import types + the worker protocol
    │   ├── constants.ts            # every cap/budget/deadline (single grep site)
    │   ├── analyze.ts              # the placeholder measurement core
    │   ├── compute.ts              # Phase A / Phase B orchestrator + the merge invariant
    │   ├── protocol.ts             # the phase-rank stale guard (pure, tested)
    │   ├── presets.ts · guide.ts   # seeded workflow + guide content
    │   ├── authGate.ts · supabaseClient.ts
    │   └── __tests__/              # analyze · compute · protocol · constants · presets · authGate · purity
    ├── _store/
    │   ├── useToolStore.ts         # zustand persist (content only) + atomic applyResult
    │   └── useAuthPromptStore.ts
    └── _workers/compute.worker.ts  # off-main-thread entry + artifact LRU
components/ui/                      # Tier-0 UI primitives (button, keycap, badge, dialog, …)
e2e/                                # smoke.spec.ts · visual.spec.ts
docs/                               # DESIGN · blueprint · PRODUCT · surface-brief
lib/                                # site (FAQ source) · utils (cn, copyTextToClipboard) · clipboard
```

### Worker protocol

- Every message carries a monotonic `id` **and** a `phase` (`"A"` offline report ·
  `"B"` network resolve follow-up). The stale guard ranks phases, so a `B` for
  the current id is accepted after its `A`, while a duplicate `B` or a late `A`
  is dropped. Both phases post the **full** envelope — never a partial.
- **Watchdog:** Phase A is native and uninterruptible, so a dispatch that
  overruns 1.5 s terminates and respawns the worker and settles a friendly
  error. Phase B never arms the watchdog — the network is abortable through the
  worker-scope `AbortController`.
- **Honest fallback:** on `onerror` / `onmessageerror`, the hook flips
  `isWorkerAvailable = false`, announces once, and runs the **same pure core**
  synchronously at the stricter `SYNC_DEADLINE_MS`.

### Persistence

`anchorflow-tool-storage` v1 persists **content only** — `source` and
`autoResolve` — via `partialize`, with `skipHydration: true` and an explicit
`rehydrate()` on mount. `applyResult` settles report + metrics + error +
announcement in a single `set()` and takes each report field from the payload
only when it is defined, so a partial envelope can never blank the offline
report. Theme (`anchorflow-theme`) and content are never merged.

### Layout contract

`<main>` is `w-full overflow-x-hidden` with **no** `max-w-*`; every inner section
is `mx-auto w-full max-w-7xl px-4 md:px-6 lg:px-8`; the two-pane workstation
stacks below `lg`. `e2e/visual.spec.ts` asserts zero horizontal overflow at 390
and 1440, the stacking behaviour, and that no section ever carries a stray
max-width.

### Keyboard shortcuts

| Chord | Action |
|---|---|
| `⌘K` / `⌃K` | Toggle the command palette |
| `⌘P` / `⌃P` | Insert the example workflow (the preset affordance) |
| `⌘⇧C` / `⌃⇧C` | Copy the current diagnostic output |
| `⌘↵` / `⌃↵` | Focus the primary input (rAF-deferred) |

---

## Deployment

- **Port 3004 is pinned in every file that mentions it** — `package.json`
  (`dev` + `start`), `playwright.config.ts` (`baseURL` + `webServer` `PORT=` +
  `url`), `Dockerfile` (`ENV PORT`, `EXPOSE`, `HEALTHCHECK`),
  `docker-compose.yml` (`127.0.0.1:3004:3004`), `Caddyfile`, and this file.
  Keep them in sync; 3000 is reserved for the website.
- **Production truth:** PM2 process `anchor-norai` running
  `npm run build && npm start` standalone output on the VPS, behind nginx +
  certbot TLS for `anchor.norai.tech` (see `DEPLOYMENT_PLAYBOOK.md` at the repo
  root). TLS is terminated at the proxy; the app binds the pinned port.
- **Parallel Docker path:** the 3-stage unprivileged `Dockerfile` (uid/gid
  1001, healthcheck), `docker-compose.yml` bound to loopback, and the SHA-gated
  `deploy.sh` (`DEPLOY_CONFIRM=1` required before `git reset --hard origin/main`).
- **Canonical origin:** `NEXT_PUBLIC_SITE_URL` is the single source consumed by
  `app/layout.tsx` (`metadataBase`), `app/sitemap.ts` and `app/robots.ts`;
  `.env.example` is authoritative.
- **Security headers:** one CSP + HSTS + `nosniff` + `Referrer-Policy` +
  `Permissions-Policy` set for every route, `poweredByHeader: false`.
  `connect-src` allows `'self' https://api.github.com https://*.supabase.co
  wss://*.supabase.co` — the GitHub origin is the tool's only app-data egress
  and is called by the **visitor's own browser** (there is no relay), the
  Supabase hosts exist only for optional OAuth and are inert when unset.

### Privacy, and where it is proven

- `autoResolve` defaults to **false**, so the default path makes **zero**
  external requests. This is not a marketing line: `e2e/visual.spec.ts` runs a
  request guard in the default path asserting that no request leaves the origin
  on first paint, while typing, or while computing — plus zero uncaught page
  errors.
- When resolution ships, the only outward bytes will be the public
  `owner/repo@ref` tokens required to resolve a pin.
- No payload, no telemetry, no account, no backend.

---

## Caveats

- **The analysis core is a placeholder.** Parse, classification, resolution,
  audits, rewrite and diff are not implemented in this build; the diagnostic
  pane shows the measurement the core actually returns. Auto-resolve is
  deliberately disabled rather than shipping a silent no-op.
- **First Load JS is 213 kB** against the 200 kB budget in `context.md` §4.1 —
  an admitted, measured gap (the RegexCraft route it mirrors is larger). See
  `BENCHMARKS.md`.
- **The `yaml` dependency is not yet installed.** The comment-preserving parse
  (eemeli `yaml`, `Document` API with `keepSourceTokens`) arrives with the
  domain pass; the caps, types and `_lib` boundaries it needs are already in
  place.
- Fonts are fetched at **build time** only (Next.js self-hosts them); the
  running app makes no third-party font requests.

---

## Known gaps for the domain agent

The seams are deliberately exposed and typed (see `app/tools/anchorflow/_lib/`):

| Seam | File | What lands |
|---|---|---|
| Classification | `types.ts` → `UsesRaw` / `ClassifiedUses` / `UsesClass` / `UsesScope` | the 6 classes × 2 scopes, structural collection, `valueEnd` past the closing quote |
| Resolution | `types.ts` → `FetchLike` / `Resolution` / `ResolveReceipt`; `compute.ts` → `analyzeResolve` | `refResolver.ts` behind a **required** `fetchImpl`, budget floor, LRU, negative TTL |
| Findings | `types.ts` → `Finding` / `Severity` / `FindingCategory` | pinning, permissions, injection, danger-trigger, moving-ref audits — one canonical array |
| Rewrite + diff | `types.ts` → `UnifiedDiff` | offset-surgical pinned YAML + the red/green diff |
| Grants | `types.ts` → `GrantTable` / `RawPermissionBlock` | the effective-scope table |
| Caps | `constants.ts` | already pinned and grep-guarded, including the BAR item-7 mapping |

---

## License

MIT — see [LICENSE](LICENSE).
