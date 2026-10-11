# Anchorflow — Product Facts (docs/PRODUCT.md)

> Product facts only. The delivery contract lives in `SPEC.md`; the as-built
> architecture lives in `docs/blueprint.md`. Nothing in this file may contradict
> either.

## What it is

A 100% client-side workstation for hardening GitHub Actions workflows. Paste a
`.github/workflows/*.yml`; get a SHA-pinned, permission-audited, diffable
workflow back, plus the receipt that proves each pin by hand.

## Who it is for

| User | Job to be done |
|---|---|
| Platform / DevEx engineer | Harden CI supply chain this sprint; hand a reviewable PR |
| Security-minded maintainer | Inherited a `pull_request_target` workflow and needs the sinks surfaced |
| OSS maintainer / solo dev | Pin `actions/checkout@v4`, keep Dependabot working |

## Core promise

- Parse, classify, audit, detect and diff run locally with zero network. The
  only egress is a read-only, unauthenticated `GET` to `api.github.com` used to
  resolve `owner/repo@ref` → commit SHA — made by the visitor's own browser, and
  only after the visitor presses **Resolve & pin** (or opts into auto-resolve).
- Auth is offer-never-lock; no core surface is gated.
- The UI never blocks: all compute runs in a Web Worker, with a same-core
  main-thread fallback.

## The shipped surface (v1.0.0)

Everything below renders on first load — no network, no opt-in, no flag.

**The offline report (Phase A, always):**

1. **Six `uses:` classifications** per node, in source order — `remoteRef`,
   `sha40`, `sha256`, `local`, `docker` and `invalid` — with the moving /
   pending / already-pinned notes alongside them, so an unresolvable or
   unparseable node stays visible instead of becoming invisible.
2. **Four finding families**, severity-banded worst-first with a one-line legend
   under the header: `unpinned-uses`, `moving-ref`,
   `excessive-permissions`, `template-injection`, `dangerous-trigger`,
   `persist-credentials` — each with a plain-English detail, a `# line N`
   location and a one-click remediation copy.
3. **The grant table** — the effective `GITHUB_TOKEN` scope per job, showing
   which scope came from the top-level block and which from the job block, with
   an explicit UNSET state when nothing declares `permissions:`.
4. **The rewritten YAML** — an offset-surgical rewrite that changes only the
   `uses:` scalars. Comments, blank lines, flow spacing and trailing whitespace
   survive byte-for-byte; with no resolutions it is a byte-identical NO-OP.
5. **The diff** — a red/green unified diff of exactly what the rewrite changes,
   empty until refs are resolved.
6. **The receipts** — for every resolved ref: the endpoints used, the hop chain
   (`GET /repos/o/r/git/ref/tags/v4 → <sha>`), the resulting 40-hex SHA, and a
   `git ls-remote` cross-check line the reader can run by hand.

**The opt-in resolver (Phase B):** one click on **Resolve & pin** reads
`owner/repo@ref` from `api.github.com`, pins each moving ref to the commit the
ref points at today, records the whole chain, and merges the outcome back into
the offline envelope without ever blanking it. Spent quota is reported with a
countdown; a rate limit, a 404 or an offline visitor all produce friendly copy
over a complete report.

## Non-goals (v1)

No LLM, no full workflow schema validation, no non-GitHub CI, no bulk repo
scanning, no secret-value scanning, no backend, no gating of core value.
`if:` raw-expression scanning **is** in scope.

## Positioning

Studied, not copied:

- **actionlint** — browser-native, zero-network, as-you-type. Its structural
  limit (cannot resolve SHAs) is Anchorflow's wedge.
- **zizmor** — its audit taxonomy shapes our severity-tagged, category-grouped
  findings (`unpinned-uses`, `template-injection`, `excessive-permissions`,
  `dangerous-trigger`, `persist-credentials`); we implement our own
  deterministic detectors.
- **StepSecurity** — the report-card / least-privilege framing and the
  "every conclusion is independently reproducible" ethos behind the permission
  grant table and the reproduce receipts.
- **gh-actions-lock / pinact / gha-pinner** — CLI-only; their pinning mechanics
  inform the algorithm, never the code.

## Success metrics

- **Pinning coverage** — every `remoteRef` either resolves or carries an
  explicit `unknown-ref` / `rate-limited` / `network-error` / `unsafe-ref`
  status; never a silent drop.
- **Determinism** — identical input ⇒ byte-identical rewritten YAML + identical
  findings array (content, length and canonical order).
- **Quota discipline** — the 60/hr limit belongs to the visitor's browser IP;
  the client holds an advisory reserve floor (`RATE_LIMIT_RESERVE`) to preserve
  the visitor's own budget and stops at it, saying so.
- **No freeze** — a 5,000-line workflow stays interactive (measured in
  `BENCHMARKS.md`), and a pathological one settles a friendly verdict instead of
  hanging.
- **Zero-egress proof** — a default-path request guard, not a marketing line.
