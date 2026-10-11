# Anchorflow — Execution Plan (PLAN.md)

> Thin-slice-first plan for Phase 3. Every task names the **exact files it owns** +
> **its test**, so parallel implementers get disjoint file sets. Gates follow
> `BAR.md` §6: `typecheck → lint → test → build → playwright`. No production code
> lives in this doc; code lands in the files each task owns.

---

## 1. Strategy — thin slice first

M1 ships a **working end-to-end copy** with resolution **stubbed/offline**
(parse → classify → audit → diff → copy) so the shell, worker, store, and the
comment-preserving rewrite are proven before any network exists. Real resolution
(M2) is an isolated module behind a **required** `fetchImpl` seam, so it can't
destabilize M1. Each milestone is independently shippable and adds one capability
loop (`_lib` first → red/green test → worker envelope → atomic settle → render →
e2e).

`autoResolve` **defaults to `false`**: the default path is hermetic and makes **zero**
external requests until the visitor opts in (AC-12). M1 therefore ships with the
network phase inert.

```
M1 parse+classify+audit+diff (offline, zero-egress) ─► M2 resolver + rate-limit UX
                                                                 │
M5 polish/theme/benchmarks/CI/docs ◄─ M3 permissions audit ── M4 injection+danger+persist-credentials
```

Dependency chain: M2 depends on M1's store + worker envelope; M3/M4 depend on the
`WorkflowModel` from M1 (and M3/M4 are **mutually independent** — parallelizable); M5
depends on all features existing. M1-T7 (SEO/sitemap) is independent of everything
and may start immediately.

---

## 2. Feasibility results (all run in `/tmp/afp`, never in the repo)

### 2.1 eemeli `yaml` round-trip — the crux finding
Installed `yaml@2.9.1`. **Whole-doc `doc.toString()` is NOT byte-preserving**: it
normalizes flow spacing and pre-comment whitespace.

Observed (no-op `toString()` vs original):
```
ORIGINAL : "...branches: [main]   # only main\n...\n  contents: read      # least privilege\n..."
ROUNDTRIP: "...branches: [ main ] # only main\n...\n  contents: read # least privilege\n..."
           ^^^^ [main]→[ main ]      ^  collapsed 6 spaces → 1
```
**Conclusion:** the "byte-for-byte except changed `uses:`" requirement is met by
**offset-based surgical rewrite** (`parseDocument(src,{keepSourceTokens:true})` +
per-scalar `.range`), **not** by re-emitting the document. Validated:

```
=== SURGICAL OUTPUT (only the two uses lines change) ===
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262  # v4
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020  # v4
=======================================================
all original formatting/comments preserved byte-for-byte: true
line count equal: true   |   changed line indices: [13,17]
```

`[main]`, `read      #`, and every comment survive untouched. This is `yamlRewrite.ts`
(ARCH §3.9) and the basis of AC-2/AC-3.

### 2.2 Real GitHub API — the resolver contract (captured live, from the browser)
CORS confirmed: `access-control-allow-origin: *`; preflight `OPTIONS → 204`. The call
is made **by the visitor's browser** (CSP `connect-src`), so the 60/hr quota belongs
to the visitor's IP — there is no server relay.
Rate-limit headers present: `x-ratelimit-limit: 60`, `-remaining: 48`, `-used: 12`,
`-resource: core`, `-reset: 1791675998`.

Lightweight tag (`actions/checkout@v4`) — `type:"commit"`, sha is the commit:
```json
GET /repos/actions/checkout/git/ref/tags/v4
{ "ref":"refs/tags/v4",
  "object": { "sha":"11d5960a326750d5838078e36cf38b85af677262",
              "type":"commit", "url":".../commits/11d5960a…" } }
```
Annotated tag (`pnpm/pnpm@v9.12.0`) — `type:"tag"`, then deref to the commit:
```json
GET /repos/pnpm/pnpm/git/ref/tags/v9.12.0
{ "object": { "sha":"85b44e09fb0988e3e307fa59de1cf79a525b51e9", "type":"tag" } }
GET /repos/pnpm/pnpm/git/tags/85b44e09fb0988e3e307fa59de1cf79a525b51e9
{ "tag":"v9.12.0", "object": { "sha":"fc7eed08c5d25b7e7349863bec0e43dca4247cd0", "type":"commit" } }
```

### 2.3 Oracle — `git ls-remote` ground truth (for the differential test)
`git ls-remote` resolves both tag kinds to the **commit** via the `^{}` peel, exactly
matching the API:
- lightweight: `refs/tags/v4` → `11d5960a326750d5838078e36cf38b85af677262`
- annotated (peeled): `refs/tags/v9.12.0^{}` → `fc7eed08c5d25b7e7349863bec0e43dca4247cd0`
- branch: `refs/heads/main` → `f548e57e544e1ff5a4c46bf1e1b8685f8e4a348a`

### 2.4 Input cap
Measured ~35 bytes/line → a **5,000-line workflow ≈ 175 KiB**. Decided
`MAX_INPUT_BYTES = 262_144` (256 KiB), safely above a 5k-line workflow and bounded for
structured-clone + parse. Truncation cuts on a **code-point boundary** (never splitting
a surrogate pair). (Full caps table + the BAR item-7 mapping: ARCH §7.)

---

## 3. Milestones, tasks, file ownership, tests

> Ownership is **disjoint** across tasks in the same milestone. "Owns" = the only
> files that task edits. Shared config files (in §3.6) are owned by the M1 scaffold
> task so nobody else touches them.

### 3.1 M1 — Parse + classify + audit + diff (offline, zero-egress) — the thin slice
Tasks (mostly parallel after the scaffold):
- **M1-T0 Scaffold** — owns: repo config (`package.json` `^` deps incl. `yaml`,
  `tsconfig.json`, `next.config.ts`, `tailwind.config.ts`, `postcss.config.mjs`,
  `app/globals.css`, `app/layout.tsx`, `app/page.tsx` redirect, `app/sitemap.ts`,
  `app/robots.ts`, `design_tokens.json`,
  `eslint.config.mjs`, `vitest.config.mts`, `playwright.config.ts` port 3004,
  `.gitignore`, `.env.example`, `lib/utils.ts`, `lib/site.ts`, `_lib/constants.ts`,
  `Dockerfile`,
  `docker-compose.yml`, `Caddyfile`, `deploy.sh`, `.github/workflows/ci.yml`).
  Test: `npm run typecheck && npm run lint` green; e2e smoke: `/` → `/tools/anchorflow`
  redirect, one `<h1>`, `#workstation` visible. `_lib/constants.ts` must export every
  cap named in ARCH §7.1 (grep-guarded, AC-16).
- **M1-T1 `_lib/types.ts` + `_lib/yamlParse.ts`** — owns the two files +
  `__tests__/yamlParse.test.ts`.
  Test: parse fixture set; assert `WorkflowModel` fields, `uses:` ranges, malformed-YAML
  returns `ok:false` with a line/col message (value, not throw). **Structural
  collection:** `with: { uses: … }` (and every other non-structural key named `uses`)
  yields **zero** collected nodes. Both `jobs.<id>.steps[].uses` **and**
  `jobs.<id>.uses` (job-level, `scope:"job"`, `stepIndex:null`) are collected.
  **Quoted scalars:** `uses: "owner/repo@v1"` records the unquoted `raw` and a
  `valueEnd` **after** the closing quote. Oversize truncation lands on a code-point
  boundary (no lone surrogate) with the original byte count reported, and
  `MAX_USES_SCAN` overflow sets `usesCap.capped` + reports "scan capped at N" and
  never silently drops (AC-13).
- **M1-T2 `_lib/classify.ts` + `_lib/pinningAudit.ts`** — owns both files + 2 suites.
  Test: all 6 classes across the corpus; exact ref-split (`owner/repo[/subpath]@ref`);
  the moving rule at **both poles** — `@v4.2.0`/`@4.2`/`@1.2.3-rc.1` ⇒ `moving:false`,
  `@main`/`@master`/`@HEAD`/`@trunk`/`@develop`/`@latest`/`@v4`/`@4` ⇒ `moving:true`
  (AC-1). `pinningAudit` emits exactly the classes of finding named in the
  ARCH §3.6 emitter table (unpinned-uses error for a moving ref / warn for a fixed tag
  or an invalid node, moving-ref warn, resolution info for sha256 and docker, nothing
  for local).
- **M1-T3 `_lib/yamlRewrite.ts` + `_lib/diff.ts`** — owns both files + 2 suites.
  Test: no-op `yamlRewrite(source,[])` byte-identical (AC-2); applying recorded SHAs
  changes **only** `uses:` lines + appends ` # <ref>` (single space) + preserves line
  count (AC-3); `unifiedUsesDiff` reports exactly the N changed lines red/green
  (AC-9); **comment rules** — an existing ` # <ref>` that exactly equals the ref token
  is replaced in place, a real user comment (`# needed for CI`) is preserved and the
  ref comment is appended, a quoted scalar is rewritten unquoted with the annotation
  after the closing quote; **idempotency** — re-pinning a file whose `uses:` lines are
  already `@<40-hex>` is a zero-diff, and a job-level `uses:` rewrites correctly.
- **M1-T4 `_workers/compute.worker.ts` (Phase A) + `_hooks/useToolWorker.ts`
  (Phase A path) + `_lib/compute.ts` (analyzeLocal)** — owns all three.
  Test: Phase A settles the offline report; watchdog 1.5s + `degradeToMainThread` +
  `degrade` fallback uses the **same core**; every message carries
  `phase:"A"|"B"` and the stale guard honours the phase rank; the watchdog is armed
  on dispatch and **cleared the moment Phase A posts**; e2e `demos`:
  catastrophic-input → friendly error, input still enabled.
- **M1-T5 `_store/useToolStore.ts` + `_lib/presets.ts`** — owns both.
  Test: persist is content-only (`workflow`/`autoResolve`) under
  `anchorflow-tool-storage` v1, `skipHydration`, defensive `merge`; `applyResult`
  atomic single-`set` **with the field-merge guard** (a payload missing `permissions`
  never blanks it); **`autoResolve` defaults `false`**; seeded `DEFAULT_WORKFLOW`
  yields ≥1 finding (emitted by a **moving** ref, so no network is needed) + ≥1
  `remoteRef` (AC-14).
- **M1-T6 UI shell + panes** — owns `page.tsx`, `_components/*` (SiteHeader, TopToolbar,
  MainWorkspacePane input+highlight, InspectorPane, StatusLiveRegion, CommandPalette,
  CompetitorMatrix, KnowledgeHub, FaqSection, StudioFooter, ThemeToggle, auth/*,
  providers/*), `_hooks/useKeyboardShortcuts.ts`, `_hooks/useAuth.ts`,
  `_lib/supabaseClient.ts`, `_lib/authGate.ts`.
  Test: e2e `smoke`+`visual` (no overflow 390/1440, single-column below lg, ⌘K,
  paste→report, persistence via the store key); `shouldPromptSignIn` pure unit suite
  (authenticated / manual / export / 2nd-visit / degraded-localStorage /
  no-window) — AC-17; **no core surface is gated**: the pinned YAML, diff, and report
  are copyable with zero prompt and zero `*.supabase.co` connections when keys are
  absent; any convenience export no-ops to ungated copy.
- **M1-T7 SEO single-source** — owns `lib/site.ts` (the single `FAQS` array),
  `app/sitemap.ts`, `app/robots.ts`, `_components/FaqSection.tsx` JSON-LD helper.
  Test: unit assert the `FAQPage` JSON-LD emitted by `buildFaqJsonLd()` is
  byte-equal to the rendered `FAQS` array (one source, zero drift — BAR §10 item 16,
  AC-18); sitemap/robots URLs derive from `NEXT_PUBLIC_SITE_URL` only.

**M1 exit:** paste → parse + classify + audits + offline diff (moving-ref warnings) +
copy, dual-theme, worker + watchdog, **zero-egress smoke (autoResolve=false ⇒ no
external requests on first paint)**. This is the shippable thin slice.

### 3.2 M2 — Real resolver + rate-limit UX (isolated behind the required `fetchImpl` seam)
- **M2-T1 `_lib/refResolver.ts` + fixtures `__tests__/fixtures/*.json`** — owns file +
  fixtures + suite. Test: replay recorded 200-lightweight / 200-annotated+deref / 404 →
  correct status + kept-original on 404 (AC-4); **budget gate** — with a seeded
  `remaining` the pool never dispatches when `remaining - inFlight <=
  RATE_LIMIT_RESERVE`, reserves **2 units** per dispatch (annotated deref) and
  releases the unused one for a lightweight ref, so a 4-way concurrent burst cannot
  overspend (AC-4, AC-13); `options.signal` aborts an in-flight fan-out and the `fetchImpl` observes
  it; `Retry-After` / `x-ratelimit-resource` are parsed before a 403 is labelled the
  hourly reset; an uncached 404 is negative-cached for `RESOLVE_NEGATIVE_TTL_MS`
  (repeat costs zero fetch calls); `fetchImpl` is **required** and `_lib` never names
  `fetch` (AC-16).
- **M2-T2 `_workers/compute.worker.ts` (Phase B) + `_hooks/useToolWorker.ts` (Phase B
  path: debounce 500ms + "Resolve & pin") + `_lib/compute.ts` (analyzeResolve) + resolve
  LRU** — owns edits to those files. Test: concurrency ≤ 4; budget never overspends
  (seeded `X-RateLimit-*` honoured); LRU serves a repeat ref with **zero** fetch calls;
  **merge** — a 404/429 Phase-B envelope keeps every Phase-A
  `excessive-permissions` / `template-injection` / `dangerous-trigger` finding, with no
  `undefined`/empty `findings`/`uses`/`permissions`, and `ok` stays `true`, and the
  reply carries the **full** envelope (AC-10, AC-13, AC-15); **single in-flight** —
  dispatching Phase B twice aborts the first's `fetchImpl` (AC-15); per-ref timeout; a
  `phase:"B"` message after `phase:"A"` for the same id is accepted, a duplicate `B` or
  a late `A` is dropped.
- **M2-T3 resolve UI** — owns the resolve button/status + rate-limit/offline banner +
  receipt list `_components/*`. Test: e2e `demos`: resolve journey (network **stubbed**
  to fixtures) shows pinned YAML + diff + receipts; a forced 429 shows the amber
  rate-limit banner while the offline report persists; the receipt shows
  `tag-object-sha → commit-sha` plus the `ls-remote` peeled line plus `resolvedAt`
  and the point-in-time-snapshot caveat.
- **M2-T4 oracle job `.github/workflows/oracle.yml`** — owns that file.
  Test (gated): resolves tag set **T** live — one lightweight tag, one annotated tag,
  one subpath action, one branch, one moving alias (`@latest`), one floating major
  (`@v0`), one deliberately unknown ref — and asserts each equals
  `git ls-remote "refs/tags/<ref>^{}"` (AC-5); a runner 403/429 reports
  **SKIP, not FAIL**.

**M2 exit:** paste → resolve → pinned YAML + red/green diff + receipts, with honest
rate-limit/offline behavior and proof that the fan-out stays inside the visitor's own
hourly budget.

### 3.3 M3 — Permissions audit (**independent of M4** → parallelizable)
- **M3-T1 `_lib/permissionAudit.ts`** — owns file + suite.
  Test: flags exactly the 5 canonical misconfigs on fixture P and does **not** flag the
  least-privilege reference (AC-6); grant table `effective` scopes correct (job overrides
  top), `unset` flagged.
- **M3-T2 grant-table UI** — owns the permission pane `_components/*` + worker envelope
  field pass-through + `applyResult` field. Test: e2e renders the table + severity colors.

### 3.4 M4 — Injection + dangerous-trigger + persist-credentials
- **M4-T1 `_lib/injectionDetect.ts`** — owns file + suite.
  Test: catches `run: echo ${{ github.event.issue.title }}` + the enumerated variants
  (quoted `pull_request.body` in `with:`; `review.body` in a `with:` input;
  `github.head_ref` in a multiline `run: |`) at `error`; **whole-expression
  tokenization** — `run: echo $(format('{0}', github.event.issue.title))` and
  `join(github.event.commits.*.message)` and a concatenated `"t-${github.event.issue.title}"`
  (AC-7); **bare `if:`** — `if: github.event.issue.title == 'x'` flagged at `error`
  with the `if:`-specific remediation, `if: github.event_name == 'push'` not flagged;
  **job-level `with:`** inputs scanned the same way; **dedupe** — a sink with an
  enumerated error plus an unexplored `github.event.*` yields exactly one `error`;
  safe contexts `github.sha`/`env.*`/`github.event_name`/`matrix.*` skipped.
- **M4-T2 `_lib/dangerTriggers.ts`** — owns file + suite.
  Test: `pull_request_target` + checkout@PR-head; `workflow_run` likewise;
  token/permission coupling; `persist-credentials:true` flagged (AC-8).
- **M4-T3 findings report UI** — owns the grouped/severity-tagged findings `_components/*`.
  Test: e2e renders findings grouped with remediation + rose/amber semantics; renders
  from the single `findings` array (no `sinks` channel).

### 3.5 M5 — Polish, theme, benchmarks, CI, docs to the BAR
- **M5-T1 dual-theme AAA pass + craft-floor pass + motion** — owns `_components/*` +
  `app/globals.css`. Test: devtools contrast > 10:1 both themes; every control has all 5
  states; visual e2e GREEN.
- **M5-T2 `BENCHMARKS.md` + perf** — owns the file + `_lib/__tests__`/bench if any.
  Test: reproduce commands + real numbers (median/p95, N runs, machine noted);
  5k-line no-freeze (AC-11) — the default-path **relative** assertion
  (`5k-line < 0.5 × WORKER_DEADLINE_MS`, `1k-line < 0.25 ×`) plus the recorded
  `WORKER_DEADLINE_MS` as a **measured / WARN** threshold, with the CI-class-hardware
  p95 documented at **≥ 2.5× margin** (target ≈ ≤400 ms).
- **M5-T3 zero-egress + coverage gates + CI order + caps grep + `_lib` purity** — owns
  `e2e/*` guards, `vitest.config.mts` coverage thresholds, CI, and the
  `_lib/__tests__/constants.test.ts` + `_lib/__tests__/purity.test.ts` source-scan
  suites. Test: default-path request guard allow-list == CSP (AC-12); **zero external
  requests on first paint with `autoResolve=false`**; every `api.github.com` URL matches
  `^/repos/<owner>/<repo>/git/(ref/(tags|heads)/<ref>|tags/<40-hex>)$` with empty
  search/hash; zero uncaught errors; caps-name grep resolves every ARCH §7.1 name to
  `_lib/constants.ts`; coverage green.
- **M5-T4 docs set** — owns `README.md`, `AGENTS.md`, `docs/DESIGN.md`,
  `docs/blueprint.md`, `docs/surface-brief.md`, `docs/PRODUCT.md`, `docs/ui-kit.md`,
  `tutorial.md`, `CHANGELOG.md`, `LICENSE` (MIT), `QUALITY_REPORT.md`,
  `RELEASE_CHECKLIST.md`. Test: BAR §8/§15/§18 checklist; port 3004 in every file;
  README + QUALITY_REPORT carry the **60/hr caveat** — it is server-enforced and
  per-**visitor-browser-IP**, and the client holds an advisory reserve floor to
  preserve the visitor's own budget.
- **M5-T5 e2e vault (full spec set)** — owns `e2e/smoke|demos|visual.spec.ts`.
  Test: all three suites green on the standalone artifact.
- **M5-T6 auth no-op + ungated-core e2e** — owns the additions to
  `e2e/demos.spec.ts` and `_lib/__tests__/authGate.test.ts`.
  Test: with Supabase keys absent, the full copy journey needs no sign-in and makes zero
  `*.supabase.co` connections; `shouldPromptSignIn` policy matrix green (AC-17).

**M5 exit:** BAR.md §10 re-comparison passes 18/18 as pass/fail.

### 3.6 Cross-cutting seam files (owned by M1-T0 only)
`package.json`, `tsconfig.json`, `_lib/constants.ts`, all root configs, `lib/site.ts`,
`app/sitemap.ts`, `app/robots.ts`, and CI are edited **only** by M1-T0/T5 tasks.
Feature tasks claim only `_lib/<module>.ts`, their `__tests__`, and their
`_components/*` — so no two implementers ever open the same file.

---

## 4. Adjudicated decisions (VERBATIM — reviewer questions closed; no open items)

1. **`owner/repo@ref` slice rule — CLOSED.** Split on the **last** `@`, drop the
   subpath before resolving (one sha shared across `owner/repo/pathA@v4` and
   `…/pathB@v4`). Floating-major rule is **exactly**:
   `moving = (^v?\d+$) OR ref ∈ {main, master, HEAD, trunk, develop, latest}`.
   `@v4.2.0`, `@4.2`, `@1.2.3-rc.1` are **NOT** moving; `@v4`, `@4`, `@latest` **ARE**.
   Both poles are tested (AC-1).
2. **Resolver endpoint order — CLOSED.** The 2-step tag chain + heads fallback ships in
   v1 (it matches the verified facts and yields an auditable receipt). The 1-call
   `GET /repos/{o}/{r}/commits/{ref}` shortcut is a documented **Later** quota
   optimization, not v1.
3. **Annotated-tag receipts — CLOSED.** Show **both** hops:
   `tag-object-sha → commit-sha`, where `returnedSha` is the **final commit** and
   `dereferencedFrom` is the **tag-object** sha, **plus** the `ls-remote` peeled
   cross-check line and `resolvedAt`, and the standing copy **"a SHA is a
   point-in-time snapshot."**
4. **Rate-limit UX honesty — CLOSED (factual correction).** The resolver fetches from
   the **visitor's browser** (CSP `connect-src https://api.github.com` = browser-direct).
   There is **no VPS relay**, so the shared-VPS-IP worry is a **red herring**. Only the
   **CI oracle** uses GitHub-Actions-runner IPs; its `403`/`429` is handled as
   **SKIP, not FAIL**. The README/QUALITY_REPORT caveat states that 60/hr is
   **server-enforced and per-visitor-IP**, and that the client holds an **advisory
   reserve floor** to preserve the visitor's own budget.
5. **Dependabot comment format — CLOSED.** Append `owner/repo@<sha> # <ref>` with a
   **single space** before `#` — that is GitHub's own pin format, adopted verbatim.
   The comment remains the honest original-ref label for branches and `HEAD`.
6. **`github.event.*` warn bucket — CLOSED.** Keep **`warn`** for the residual bucket.
   Dedupe so an enumerated **ERROR** context yields **exactly one** error
   (most-specific wins), never error+warn. Tested (AC-7).
7. **Existing trailing `# <ref>` / re-pinning — CLOSED.** SHA40 lines are **never**
   rewritten (idempotent re-run ⇒ **zero-diff**). An existing trailing comment is
   reused/replaced **only** when it **EXACTLY equals** the original ref token; any
   unrelated user comment is **preserved** and ` # <ref>` is appended after it.
8. **`if:` raw-expression scanning — CLOSED: IMPLEMENTED IN v1.** A YAML `if:` value is
   a bare expression with **no** `${{ }}`; the scanner feeds the raw string through the
   same whole-expression tokenizer and emits the `if:`-specific remediation. It is
   **not** a non-goal. Tested (AC-7).
9. **Job-level `uses:` — CLOSED: SUPPORTED AND PINNED.** `jobs.<id>.uses` is a
   reusable-workflow call; it is classified and pinned exactly like a step `uses:`
   (supply-chain-critical), never silently dropped, and its `with:` inputs are
   injection-scanned. Tested (AC-1, AC-3, AC-7).
10. **Shared-IP quota degradation — CLOSED.** See decision 4: there is no shared server
    IP. The visitor's IP is the only quota that matters, and the reserve floor keeps
    the fan-out honest.
11. **`autoResolve` default — CLOSED: `false`.** Zero external requests on first paint;
    the seeded default workflow paints the complete offline report (AC-12).
12. **`AC-11` / baseline timing gate — CLOSED.** `WORKER_DEADLINE_MS` is a **measured /
    WARN** threshold, not a hard AC gate; the default-path assertion is **relative**
    (ratios of the same machine's speed) and the ≥2.5× margin is a documented
    measurement in `BENCHMARKS.md` (AC-11).

_No external actions, no live deploy, no commits this pass — docs only, per mandate._
