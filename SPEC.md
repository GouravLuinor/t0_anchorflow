# Anchorflow — Product & Delivery Specification (SPEC.md)

> Planning doc. No production code here. This is the contract the build (Phase 3)
> and the exit-gate (BAR.md §10) are measured against. Where a value is copied from
> a sibling, the source is cited so implementers stay in lockstep.

| | |
|---|---|
| **Name** | Anchorflow |
| **Slug** | `anchorflow` |
| **Port** | **3004** (pinned in every file that mentions it; never 3000) |
| **Subdomain** | `anchor.norai.tech` |
| **PM2 service** | `anchor-norai` |
| **Repo route** | `app/tools/anchorflow/` (root `app/page.tsx` → `redirect("/tools/anchorflow")`) |
| **Baseline / bar** | TokenCraft floor · RegexCraft canonical bar · Matchlight design system |

---

## 1. One-line thesis

**Paste a `.github/workflows/*.yml`; get back a SHA-pinned, permission-audited,
diffable workflow — 100% in your browser.** The only network is read-only,
unauthenticated `GET` requests to `api.github.com` used to resolve `owner/repo@ref`
→ commit SHA. No LLM in v1.

Anchorflow turns the two things every Actions team eventually needs — **pin every
action to an immutable commit** and **stop over-permissioning the `GITHUB_TOKEN`** —
from a manual chore into a paste-and-copy operation, with a red/green diff of exactly
what changed and a per-pin receipt you can reproduce by hand.

---

## 2. Users & jobs-to-be-done

Three primary users, all reached with zero signup:

1. **The platform / DevEx engineer.** "Harden our CI supply chain this sprint."
   Wants to pin every action, tighten token scope, and hand a reviewable PR.
   JTBD: paste workflow → get SHA-pinned YAML + permission grant table + a clean
   diff to drop into a PR.
2. **The security-minded maintainer.** "I inherited a `pull_request_target` workflow
   and I'm scared of it." Wants template-injection sinks and dangerous-trigger
   coupling surfaced with an actionable fix, not a wall of theory. JTBD: paste →
   severity-tagged findings with remediation and reproduce receipts.
3. **The OSS maintainer / solo dev.** "I just want `actions/checkout@v4` pinned and a
   note for Dependabot." JTBD: paste → copy the pinned YAML with `# v4` comments
   Dependabot keeps working.

Common thread: **trust**. Nobody wants to upload their workflow (proprietary CI) to a
SaaS scanner. Anchorflow's moat is that the sensitive compute (parse, audit, diff) is
offline and the only outward bytes are public `owner/repo@ref` strings sent to the
public API.

---

## 3. Core promise & privacy posture

- **Sovereign, offline-first core.** Parse, classify, audit, injection-detect, and
  diff all run locally with zero network. The tool is fully useful with the network
  unplugged — it simply reports "pinning unavailable" and still returns the full
  permission/injection/danger report and the moving-ref warnings.
- **Only egress = `api.github.com`, and it is browser-direct.** Read-only
  unauthenticated `GET`s of public ref-resolution endpoints sent **from the visitor's
  own browser** (that is why the CSP needs `connect-src https://api.github.com`;
  there is no server-side proxy, no VPS relay, and no Anchorflow backend that ever
  sees a workflow). The quota therefore belongs to the visitor's browser IP, not to
  Anchorflow's host. No user payload is sent anywhere other than the public
  `owner/repo` + `ref` tokens required to resolve them. Proven by a default-path
  e2e request guard that (a) allow-lists exactly the CSP `connect-src` origins,
  (b) asserts **zero** external requests before the first resolve, and (c) asserts
  every `api.github.com` URL body contains **only** `owner/repo[/subpath]/<ref-kind>`
  (see §9 AC-12) — not by a marketing line.
- **Auth is offer-never-lock.** The optional Supabase auth infra ships so the tool
  matches BAR §11, but it is env-gated to a no-op and **gates nothing core**: the
  pinned YAML, the diff, and the findings report are always ungated and copyable
  (see §4 F9, §5).
- **UI never blocks.** All compute runs in a Web Worker; the main thread keeps
  running under a 5,000-line workflow (see §9 AC-11).

---

## 4. MVP feature set (v1, deterministic)

Each feature is spelled out precisely enough to write its test.

### F1 — Comment-preserving YAML parse

Parse the workflow preserving comments and formatting. Uses eemeli's `yaml`
`Document` API with `keepSourceTokens` so every scalar carries `range` offsets into
the **original** source string. **Rewrites are performed as offset-based surgical
text edits, never as a whole-document re-emit** — feasibility proved the latter
normalizes formatting (`[main]`→`[ main ]`, collapses `read      #`→`read #`), so it
is forbidden for the output path (see PLAN.md §2).

**Collection is structural, never lexical-by-key.** `uses:` nodes are gathered by
walking the document tree along the fixed paths `jobs.<id>.steps[].uses` and
`jobs.<id>.uses` — a mapping key literally named `uses` anywhere else (e.g. a
`with:` input named `uses`) is **never** collected, classified, resolved, or
rewritten. `run:` / `with:` / `if:` / `permissions:` / trigger keys are gathered the
same way, at their own known structural positions only.

Every collected `uses:` node records: the raw scalar text **without** quotes, the
scalar `start` offset, the **`valueEnd` offset**, the `scope` (`"step"` for a step,
`"job"` for a reusable-workflow call), and any pre-existing **trailing comment** on
the line. For a **quoted** scalar (`uses: "owner/repo@v1"`) the recorded `valueEnd`
is the offset **after the closing quote** — the ` # <ref>` annotation is appended
after the closing quote, never inside the quotes, and the raw text stored for
classification is the unquoted value.

Oversize inputs are truncated on a **code-point boundary** (a UTF-16 surrogate pair
is never split into a lone surrogate), and the **original** byte count is reported.

### F2 — `uses:` classification (6 classes, ×2 scopes)

Every `uses:` value is classified into exactly one of:

- **`sha40`** — `owner/repo[/path]@<40-hex>` already pinned to a commit. No network.
- **`sha256`** — `owner/repo[/path]@<64-hex>`. Treated as already-pinned (SHA-256 is
  not resolved; surfaced as an "unusual but pinned" note).
- **`remoteRef`** — `owner/repo[/path]@<tag | branch | HEAD>` needing resolution.
  Split into `owner`, `repo`, optional `subpath`, and `ref`.
- **`local`** — `./path` or `../path`. Skipped (never resolved; rendered in the
  class table, never rewritten).
- **`docker`** — `docker://image[:tag|@digest]`. Skipped (registry concern, out of
  v1 scope; emitted as a `resolution`/`info` note so nothing is invisible).
- **`invalid`** — empty / unparseable. Flagged, never rewritten.

**Scopes (M3).** A `uses:` is additionally tagged with its scope:

- **`step`** — `jobs.<id>.steps[].uses`. Pinnable.
- **`job`** — `jobs.<id>.uses`, the reusable-workflow call. **Also pinnable and
  supply-chain-critical**: it is classified, resolved, and rewritten exactly like a
  step `uses:`, and is **never silently dropped**. The rewrite is
  `jobs.<id>.uses: owner/repo/path@<sha> # <ref>`. The reusable workflow's `with:`
  input map is injection-scanned with the same rules as a step `with:` (F6).

**Scan cap (never a silent drop).** Structural scanning stops collecting detail after
`MAX_USES_SCAN` (`2_000`) `uses:` nodes; the model records
`usesCap = { seen, scanned, capped }` and the report emits a `resolution` / **warn**
reading "`uses:` scan capped at N nodes — M further nodes were not analyzed".

**Detected moving targets (`moving: true`)** — the adjudicated rule, verbatim:

> `moving = (ref matches ^v?\d+$) OR ref ∈ {main, master, HEAD, trunk, develop, latest}`

`@v4.2.0`, `@4.2`, and `@1.2.3-rc.1` are **NOT** moving (a dotted version, optional
`v` prefix, and a pre-release suffix are all fixed points). `@v4`, `@4`, `@latest`,
`@main`, `@master`, `@HEAD`, `@trunk`, `@develop` **ARE** moving. A moving ref fires
a `moving-ref` finding with **no network**.

### F3 — Ref → commit SHA resolution

Runs **in the visitor's browser** (SPEC §3). For each `remoteRef`:

1. `GET https://api.github.com/repos/{owner}/{repo}/git/ref/tags/{ref}` → expect
   `{ object: { sha, type } }`.
2. If `type === "tag"` (**annotated**), deref:
   `GET /repos/{owner}/{repo}/git/tags/{sha}` → `{ object: { sha } }` = the commit.
3. If `type === "commit"` (**lightweight**), the returned sha is the commit.
4. Branch refs: `GET /repos/{owner}/{repo}/git/ref/heads/{ref}`.

A branch ref therefore costs up to 2 calls (tags 404 → heads 200), an annotated tag
2 calls, a lightweight tag 1 call. **Every dispatch reserves 2 units of budget** (1
for the chain GET, 1 held for the possible annotated deref); the unused unit is
released the moment the ref is resolved without a deref.

Rewrite the `uses:` value to the commit SHA and append ` # <original-ref>` —
**a single space before `#`, which is exactly GitHub's / Dependabot's own pin
format** — so Dependabot keeps working. The comment stays the honest original-ref
label, including for a branch or `HEAD`. Conditions:

- **404 (unknown ref):** keep the original value, do not rewrite, emit a
  `resolution`/`warn` finding with the endpoint in the receipt. Uncached 404s are
  negatively cached for a **short TTL** (`RESOLVE_NEGATIVE_TTL_MS = 60_000`) so a
  repeated typo does not re-spend quota inside one session; success caching is
  permanent-by-LRU.
- **403 / 429 / budget floor (rate-limit):** mark remaining refs
  `rate-limited`, keep their originals, surface remaining quota + reset time, and
  **do not lose the rest of the report** (permissions/injection/diff still render).
  Before the copy calls it "the hourly reset", the response is interrogated for
  `x-ratelimit-remaining` / `-limit` / `-reset` / `-resource` and then `Retry-After`
  (delta-seconds or HTTP-date); only a 403/429 that actually carries
  `x-ratelimit-remaining: 0` is labelled the **hourly** limit. A rate-headless 403 is
  labelled "temporarily blocked / abuse-detected", honours `Retry-After`, and never
  claims an hourly reset.
- **annotated vs lightweight** handled as above (§4 F3.2 vs F3.3).
- **subpath actions** `owner/repo/path@ref`: resolve the **repo**, keep the **path**;
  the rewrite is `owner/repo/path@<sha> # <ref>`.

### F4 — Red/green diff of exactly what changed

A deterministic line-based unified diff of `before` vs `after` YAML. Only `uses:`
lines change (F3 guarantees line count is preserved), so the diff is exactly the
pinned lines: red (`-`) original `@ref`, green (`+`) `@<sha>  # <ref>`. Plus a
change counter.

**Re-pinning is idempotent.** A `uses:` line already carrying a 40-hex SHA is
classified `sha40`, is never dispatched for resolution, and is **never rewritten** —
re-running Anchorflow on its own output yields a **zero-line diff**. An existing
trailing comment is replaced **only** when it *exactly* equals the original ref
token (after trimming); any other user comment (`# needed for CI`) is preserved
verbatim and the ` # <ref>` annotation is appended after it. No comment is ever
destroyed.

### F5 — Permissions audit + grant table

Build a grant table from top-level and per-job `permissions:` (scopes, listed in
§9) and flag:

1. **top-level `permissions: write-all`** — `excessive-permissions` / **error**.
2. **job-level `write-all`** — `excessive-permissions` / **error**.
3. **unset permissions** (no `permissions:` at any level) while the workflow uses
   actions that consume `GITHUB_TOKEN` — `unset` / **info**: "unset = inherits repo
   default; pin explicitly."
4. **over-broad write on a read-only job** (e.g. a pure build/test job still holding
   `contents: write` from a broad top grant) — `excessive-permissions` / **warn**.
5. **`id-token: write` over-grant** on jobs with no OIDC consumer — **warn**.

The grant table shows the **effective** scope per job (job block overrides top per
scope) and marks `unset`.

### F6 — Script-injection sink detection

Detect interpolation of untrusted contexts into `run:`, `with:` (step-level **and**
reusable-workflow job-level), and `if:` contexts.

**Whole-expression tokenization (M6).** The scanner tokenizes the **entire** `${{ … }}`
expression (or the entire bare `if:` string), not just its leading context path. Any
occurrence of an untrusted context anywhere inside — a nested function argument
`format('{0}', github.event.issue.title)`, a splat
`join(github.event.commits.*.message)`, string concatenation
`"t-${github.event.issue.title}"`, a ternary, an index — is detected.

**`if:` is a bare expression (adjudicated decision: implemented in v1).** A YAML
`if:` value is a GitHub expression with **no** `${{ }}` wrapper, so the scanner
feeds the raw string (a redundant wrapping `${{ … }}` is stripped first, if
present) through the same tokenizer. `if:`-sourced findings carry the
`if:`-specific remediation: *"move the value into `env:`, reference `${VAR}` in the
condition, or gate on a safe context such as `github.event_name`."*

Unexplored `github.event.*` severity: **`warn`** for the residual bucket, but an
enumerated ERROR context yields **exactly one** finding at `error` — most-specific
wins, never error+warn on the same sink.

Untrusted (enumerated, severity **error**): `github.event.issue.title`,
`...issue.body`, `github.event.pull_request.title`, `...body`, `...head.ref`,
`...head.label`, `...head.repo.*`, `github.event.comment.body`,
`github.event.review.body`, `github.event.review_comment.body`,
`github.event.discussion.title`, `...discussion.body`,
`github.event.head_commit.message` / `.author.*`,
`github.event.commits.*.message`,
`github.event.workflow_run.head_branch` / `.head_commit.message`,
`github.head_ref`, and fork-derived refs. Any **other** `github.event.*` in a
`run`/`with`/`if` sink is `warn` (attribution is broader than the enumerated set).
Each finding carries the offending expression, the context path, and remediation:
**move the value into `env:` and reference `${VAR}`.** Safe contexts are never
flagged: `github.sha`, `github.ref`, `github.repository`, `github.event_name`,
`github.run_id`, `github.run_number`, `github.job`, `github.workflow`,
`github.server_url`/`api_url`/`graphql_url`, `env.*`, `runner.*`, `matrix.*`,
`needs.*`, `steps.*`, `inputs.*`, `secrets.*` (in `run`).

### F7 — Dangerous-trigger detection

Flag a job triggered by `pull_request_target` **or** `workflow_run` that runs
`actions/checkout` with a `with.ref` equal to the PR/run **head** (untrusted code):
`github.event.pull_request.head.sha` / `.head.ref` /
`.head.repo.full_name`+ref, or `workflow_run.head_sha`. **error** — untrusted code
executing with the elevated job token. Additionally flag token/permission coupling:
a `pull_request_target`/`workflow_run` job that also holds a **write** scope
(`contents`/`packages`/`pull-requests`/`id-token`). **warn**.

### F8 — `persist-credentials` detection

Flag any `actions/checkout` step whose `with.persist-credentials` is `true` or
absent-with-risk (GitHub default is `true`). Recommendation: `persist-credentials:
false` for untrusted-code jobs. **warn** (suppressed → **info** in a fully pinned,
least-privilege, non-PR-target job).

### F9 — Output surfaces (all copyable, ⌘⇧C)

1. **Rewritten YAML** — pinned, comment-preserving. Copy button + ⌘⇧C.
   **Always ungated** (see §5 and the auth posture below).
2. **Diff view** — red/green unified diff + change count. **Always ungated.**
3. **Findings report** — severity-tagged, grouped by category, each with
   remediation. **Always ungated.** One canonical `findings` array (injection sinks
   are `template-injection` findings — there is no parallel, silently-droppable
   `sinks` channel).
4. **Per-pin reproduce receipt** — e.g.
   `GET /repos/actions/checkout/git/ref/tags/v4 → 11d5960a… (commit)` and the
   `git ls-remote "refs/tags/v4^{}"` cross-check line. The proof is one paste away.
   For an **annotated** tag the receipt shows **both** hops —
   `returnedSha` = the final commit, `dereferencedFrom` = the tag-object sha, plus
   the `ls-remote` peeled line — so the deref is auditable by hand. Every receipt
   carries `resolvedAt` and the standing caveat **"a SHA is a point-in-time
   snapshot: the tag can move later."**

Every surface ships the canonical **lime success toast** on copy, **rose** on
failure, and keycap hints (`⌘⇧C`). Seeded first-run: a small example workflow ships
as `DEFAULT_WORKFLOW` so the instrument is non-blank on first paint (guarded by a
test that it yields ≥ 1 finding — via a **moving** ref, which needs no network — and
≥ 1 resolvable ref).

**Auth posture (adjudicated: offer, never lock).** The auth infra
(`SignInModal` / `authGate` / `useAuth`, env-gated no-op) ships to satisfy BAR §11,
but **no core surface is ever gated by sign-in**. If a convenience export exists it
must **no-op to the ungated copy** when the Supabase keys are absent.
`shouldPromptSignIn` is a pure function with unit tests covering the authenticated,
manual, export, 2nd-visit, degraded-`localStorage`, and no-`window` paths.

---

## 5. Non-goals (v1)

- **No LLM.** No plain-English explainer (documented Later). Keeps the "only egress
  is api.github.com" claim airtight and the output fully deterministic/testable.
- **No full workflow schema/semantic validation** beyond `GITHUB_TOKEN`-relevant
  checks. Anchorflow is not actionlint; it does not catch every syntax error.
- **No non-GitHub CI** (GitLab, CircleCI, Jenkins).
- **No bulk repo scanning.** 60 req/hr is a deliberate anti-abuse bound; one
  workflow at a time.
- **No secret VALUE detection / scanning.** We look at structure, never secret
  contents.
- **No backend, ever.** There is no server-side resolver: `api.github.com` calls are
  made by the visitor's own browser (§3), so the 60/hr budget is the visitor's IP's
  and never Anchorflow's host's.
- **No gating of core value.** Sign-in is never required to pin, diff, audit, or
  copy (§4 F9).
- `if:` raw-expression scanning **is in v1** (F6) — it is deliberately *not* listed
  here.

---

## 6. Later (explicitly deferred)

- LLM plain-English explainer for a permissions block / finding (BYOK, opt-in,
  ephemeral — mirrors Judgewright's one optional call; would relax `connect-src`).
- Single-call resolver optimization via `GET /repos/{o}/{r}/commits/{ref}` (1 call
  instead of the 2-step tag chain) behind a quota-aware toggle.
- `@ref → release notes` link, action diff (old vs new tag), multi-file/zip.
- Optional GitHub App / PAT to raise the rate limit (user-supplied, never stored).
- Docker-image digest pinning (`docker://…@sha256:…`) — intentionally out of v1
  scope per F2.

---

## 7. Success metrics

- **Pinning coverage:** on the fixture corpus, 100% of `remoteRef`s either resolve to
  a commit or carry an explicit `unknown-ref` / `rate-limited` / `network-error`
  status — never a silent drop.
- **Determinism:** identical input ⇒ byte-identical rewritten YAML + identical
  findings array (AC-10).
- **Quota discipline:** **adjudicated reframing — the 60/hr limit is SERVER-enforced
  and belongs to the visitor's browser IP, not to Anchorflow.** The client therefore
  holds an *advisory floor* (`RATE_LIMIT_RESERVE`) to preserve the visitor's own
  budget and to keep a run's fan-out inside the server-advertised
  `x-ratelimit-remaining`; it stops at the floor and says so. Anchorflow neither
  enforces nor promises a per-hour cap it cannot see across IPs. This caveat is
  written into `README.md` and `QUALITY_REPORT.md`.
- **No freeze:** 5,000-line workflow stays interactive; Phase A settles well under
  the worker deadline (AC-11), verified with ≥2.5× margin on CI-class hardware.
- **Zero-egress proof:** the default CI path asserts only `api.github.com` (+ auth
  hosts) is contacted (AC-12), and asserts zero external requests before the first
  resolve.

---

## 8. Competitor positioning (studied, not copied)

- **actionlint** (rhysd.github.io/actionlint): browser-native, zero-network,
  as-you-type linter. We mirror its **zero-network-as-default + instant
  as-you-type feedback** for parse/classify/audit. Its structural limit — it
  **cannot resolve SHAs** (no network by design) — is exactly Anchorflow's wedge.
- **zizmor** (zizmorcore/zizmor): its audit **taxonomy** shapes our severity-tagged,
  category-grouped findings: `unpinned-uses`, `template-injection`,
  `excessive-permissions`, `dangerous-trigger` (e.g. `pull_request_target`),
  `persist-credentials`, `use-trusted-publishing`. We adopt the taxonomy and
  severity framing; we implement our own deterministic detectors.
- **StepSecurity.io**: the **report-card / least-privilege** framing and the
  "every conclusion is independently repoducible" ethos — the source of our
  permission grant table + reproduce receipts.
- **gh-actions-lock / pinact / gha-pinner**: CLI-only; their pinning *mechanics*
  inform the algorithm, but Anchorflow is browser-only and does not port their code.

---

## 9. Quantified acceptance criteria (each demonstrable by an automated test)

Fixtures: a committed corpus **F** (workflows) + recorded resolver fixtures **R**
(JSON envelopes replayed offline). grep/glob the actual numbers at build time.
Every criterion below names its test location (`_lib/__tests__/*.test.ts` or
`e2e/*.spec.ts`) so a builder cannot claim a fix without a red/green test.

- **AC-1 (classification).** Across **F**, every `uses:` is classified into exactly
  one of the 6 classes **and** one of the 2 scopes (`step` / `job`); a classifier
  suite asserts the exact class breakdown for a labeled subset (≥ 1 of each class
  present) and the moving-ref rule at **both poles**: `@v4.2.0` / `@4.2` /
  `@1.2.3-rc.1` set `moving: false`, while `@main`,`@master`,`@HEAD`,`@trunk`,
  `@develop`,`@latest`,`@v4`,`@4` all set `moving: true`. The collection is
  **structural**: a `with:` block containing a key named `uses` (and any other
  non-structural key named `uses`) yields **zero** classified nodes.
- **AC-2 (round-trip, no-op).** For each fixture in **F** with no resolves applied,
  `yamlRewrite(source, [])` returns **byte-for-byte identical** `source`
  (comments, blank lines, flow spacing `[main]`, and inline-comment whitespace
  survive). Proves the no-resolve path never mutates.
- **AC-3 (round-trip, pin).** For fixtures in **F** whose refs exist in **R**,
  applying the recorded SHAs yields a string that equals `source` on **every
  non-`uses:` line** (a line-diff asserts zero off-`uses:` changes), changes each
  target `uses:` to `owner/repo[/path]@<40-hex>`, appends ` # <original-ref>`
  (a **single space**; comment text equals the original ref token), and preserves
  line count. Covered for: a step `uses:`, a **quoted** scalar
  (`uses: "owner/repo@v1"` → the annotation lands **after** the closing quote), a
  **job-level** reusable-workflow `uses:`, and a subpath action.
  **Comment preservation:** when a target `uses:` line already carries a trailing
  `# <ref>` whose text (trimmed) **exactly equals** the original ref token, the edit
  replaces that comment in place (no doubling); when the line carries any **other**
  user comment (e.g. `# needed for CI`) that comment is preserved **verbatim** and
  ` # <ref>` is appended after it — no comment is ever destroyed.
- **AC-4 (resolution, offline).** Against **R**, the resolver returns the recorded
  SHA for each recorded ref and honors status transitions: 200 lightweight→
  `resolved`, 200 annotated→deref→`resolved`, 404→`unknown-ref` (original kept, not
  rewritten), 403/429→`rate-limited` (original kept, budget header parsed). It also
  proves the **budget gate**: seeded `remaining`/`inFlight` never lets total
  in-flight+settled dispatches exceed `remaining`, a ref is dispatched only when
  `remaining - inFlight > RATE_LIMIT_RESERVE`, **2 units** are reserved per dispatch
  (the annotated deref), and a lightweight ref releases its unused unit. A
  `fetchImpl` observing its signal proves a **second dispatch aborts the first**
  (single in-flight resolve).
- **AC-5 (resolution, live oracle).** A LIVE-gated job resolves tag set **T** and
  asserts each returned SHA equals
  `git ls-remote "<url>" "refs/tags/<ref>^{}"`. **T** covers, at minimum: one
  lightweight tag, one annotated tag, one **subpath** action, one **branch**, one
  **moving alias** (`@latest`), one **floating major** (`@v0`), and one
  **deliberately unknown ref** (both resolver and `ls-remote` must agree it does not
  exist). It fails on drift. A `403`/`429` from the GitHub-Actions runner's IP is
  reported **SKIP, not FAIL** — the runner IP is the only Anchorflow-side IP that
  ever talks to the API, and its quota is not the visitor's.
- **AC-6 (permissions).** On fixture **P**, the audit flags exactly the **5 canonical
  misconfigs** (top `write-all`; job `write-all`; unset-with-token-use; over-broad
  write on a read-only job; `id-token: write` over-grant) and does **not** flag a
  least-privilege reference workflow (negative case: `permissions: {}` +
  per-job read scopes ⇒ zero `excessive-permissions` findings).
- **AC-7 (injection).** The detector catches `run: echo ${{ github.event.issue.title
  }}` and the enumerated variants — a quoted `pull_request.body`; a `review.body` in
  a `with:` input; a `github.head_ref` case inside a multiline `run: |` block; a
  **nested-argument** case `run: echo $(format('{0}', github.event.issue.title))`
  and `join(github.event.commits.*.message)` (whole-expression tokenization, not a
  leading-path check); a **bare `if:` expression** (`if: github.event.issue.title ==
  'x'`) carrying the `if:`-specific remediation; and a **job-level** reusable
  workflow `with:` input — each at `error` severity. It does **not** flag the safe
  contexts: `github.sha`, `env.FOO`, `github.event_name`, `github.repository`,
  `matrix.*`. **Dedupe:** a sink containing both an enumerated error context and an
  unexplored `github.event.*` path yields **exactly one** finding at `error` — never
  an error **and** a warn for the same sink.
- **AC-8 (dangerous triggers + persist-credentials).** Flags a `pull_request_target`
  job with `actions/checkout` at PR-head ref; a `workflow_run` job likewise; and
  `persist-credentials: true`. Emits the `false` recommendation.
- **AC-9 (diff).** On a pinned fixture, the red/green unified diff reports exactly
  the number of changed `uses:` lines, each a `-`/`+` pair, with the `+` line
  carrying the commit SHA and `# <ref>`. Re-running the pipeline on its **own
  output** yields a **zero-line diff** (SHA40 lines are never rewritten).
- **AC-10 (determinism + merge).** Running the full pipeline twice on the same input
  (network stubbed by **R**, clock injected) yields **byte-identical** rewritten YAML
  and an **identical** findings array — identical in **content, length, and order**,
  where the order is the **canonical deterministic order**: ascending source offset
  (`Finding.start`; `null` sorts last), then `category`, then `id`. Every finding
  `id` is a deterministic function of its structural position
  (`<category>:<jobId>:<stepIndex|job>:<n>`), so no run-to-run ordering jitter is
  possible. **Merge:** offline `excessive-permissions`, `template-injection`, and
  `dangerous-trigger` findings **survive** a Phase-B that ends `404` or `429` — the
  Phase-B envelope contains the Phase-A findings concatenated with the Phase-B
  `resolution` findings, and never an empty or `undefined` `findings`/`uses`/
  `permissions` in their place. `permissions` is never re-derived by Phase B.
  (The only exempt-from-comparison values are the wall-clock `resolvedAt` / timings.)
- **AC-11 (no main-thread freeze).** A 5,000-line fixture (~175 KiB, generated) is
  pasted; the e2e `demos` journey confirms the input stays enabled, the UI stays
  interactive, **no 1.5 s watchdog fires and no degrade is entered** throughout
  (this is the pass/fail gate). The wall-clock number is a **measurement, not a hard
  gate**: `WORKER_DEADLINE_MS` (`1_000`) is a **measured / WARN threshold**. The
  default-path benchmark asserts a **relative** invariant — Phase A on the 5,000-line
  fixture completes in **< 0.5 × `WORKER_DEADLINE_MS`** and the 1,000-line fixture in
  **< 0.25 × `WORKER_DEADLINE_MS`** on whatever machine runs it — and
  `BENCHMARKS.md` records the real **median/p95** on a CI-class runner with
  **≥ 2.5× margin** against `WORKER_DEADLINE_MS` (i.e. measured p95 ≤ ~400 ms),
  which a reviewer re-runs.
- **AC-12 (hermetic zero-egress).** `autoResolve` defaults to **`false`**, and the
  default CI-path Playwright request guard asserts: (a) the seeded default workflow
  paints the **complete offline report with ZERO external requests** on first paint —
  no `api.github.com` call before the visitor opts into resolving; (b) every
  non-localhost request is in the CSP `connect-src` allow-set
  (`{api.github.com}` + optional auth hosts); (c) **every** `api.github.com` URL
  carries **only** `owner/repo[/subpath]` + the ref token — the guard asserts the
  path matches `^/repos/<owner>/<repo>/git/(ref/(tags|heads)/<ref>|tags/<40-hex>)$`
  and that `search` and `hash` are **empty** (no payload, no query, no fragment).
- **AC-13 (caps).** A >`MAX_INPUT_BYTES` fixture is truncated **on a code-point
  boundary** (no lone surrogate in the output) with the **original** byte count
  reported and a `truncated` flag; a fixture exceeding `MAX_USES_SCAN` reports
  "scan capped at N" and never silently drops the remainder; a fixture exceeding
  `MAX_RESOLVES_PER_RUN` stops network fan-out at the reserve floor, marks the
  remainder `rate-limited`, and **still returns the complete offline report** —
  findings, permissions, diff, and uses classification intact.
- **AC-14 (seeded first run).** `DEFAULT_WORKFLOW` (shipped in `presets.ts`) yields
  ≥ 1 finding (produced by a **moving** ref, so it needs no network) and ≥ 1
  `remoteRef` on first paint (guarded by a unit test, mirroring `presets.test.ts`).
- **AC-15 (worker protocol & merge).** Every worker message carries
  `phase: "A" | "B"`, and the stale guard distinguishes two same-`id` messages: a
  `B` for the current `id` is accepted after an `A`; an `A` after a `B`, or a second
  `B`, for the same `id` is dropped. `analyzeResolve` **takes the Phase-A report and
  returns the merged full envelope** (C1), and the worker always posts a **full**
  envelope, never a partial one. A `useToolWorker` test proves the worker-scope
  `AbortController` is aborted at the start of every new Phase B and that the
  watchdog is **armed on dispatch, cleared when Phase A posts, and never armed for
  Phase B** — a stray timer cannot kill a mid-fetch Phase B.
- **AC-16 (caps grep + `_lib` purity).** A Phase-4 reviewer can `grep` the caps and
  land on exactly one site with zero judgement calls: the published mapping table
  (ARCH §7.2) resolves domain cap → BAR item-7 expectation
  (`MAX_INPUT_BYTES↔MAX_TEST_LENGTH-equivalent`,
  `MAX_USES_SCAN↔MAX_MATCHES-equivalent`, `WORKER_DEADLINE_MS`/`SYNC_DEADLINE_MS
  ↔` same names, `WATCHDOG_MS↔WATCHDOG_MS`,
  `RESOLVE_CACHE_CAPACITY↔ARTIFACT_CACHE_CAPACITY`), and a grep test asserts each
  name exists in `_lib/constants.ts`. `refResolver`'s `fetchImpl` is a **required**
  option (no hidden `globalThis.fetch` default), and a source-scan test asserts
  `_lib/**` never names `fetch` / `globalThis.fetch` (BAR item 8: `_lib` is IO-free);
  the worker and the main-thread fallback each supply `fetch` at their own boundary.
- **AC-17 (auth no-op gating).** `shouldPromptSignIn` is pure and unit-tested across
  the authenticated / manual / export / 2nd-visit / degraded-`localStorage` /
  no-`window` paths. With the Supabase keys absent, an e2e journey copies the pinned
  YAML, the diff, and the findings report **with no sign-in prompt and zero
  `*.supabase.co` connections**; any convenience export no-ops to the ungated copy.
- **AC-18 (SEO single source).** `FAQPage` JSON-LD is derived from **the same array**
  the FAQ accordion renders (unit test asserts byte-equality of the rendered
  questions and the JSON-LD questions), and `app/sitemap.ts` + `app/robots.ts` are
  wired to the single canonical `NEXT_PUBLIC_SITE_URL` (test asserts the emitted
  URLs).
