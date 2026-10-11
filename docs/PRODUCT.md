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
  resolve `owner/repo@ref` → commit SHA — made by the visitor's own browser.
- Auth is offer-never-lock; no core surface is gated.
- The UI never blocks: all compute runs in a Web Worker.

## Non-goals (v1)

No LLM, no full workflow schema validation, no non-GitHub CI, no bulk repo
scanning, no secret-value scanning, no backend, no gating of core value.
`if:` raw-expression scanning **is** in scope.

## Current build (v1.8.0 — the shell)

The shipped surface is the end-to-end placeholder: paste → worker → live
diagnostic mirror → instant copy. The diagnostic mirror renders the placeholder
measurement (the analyzed text plus character / word / byte / line counts) until
the domain pass lands the derived surfaces.

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
  explicit `unknown-ref` / `rate-limited` / `network-error` status; never a
  silent drop.
- **Determinism** — identical input ⇒ byte-identical rewritten YAML + identical
  findings array (content, length and canonical order).
- **Quota discipline** — the 60/hr limit is server-enforced and belongs to the
  visitor's browser IP; the client holds an advisory reserve floor
  (`RATE_LIMIT_RESERVE`) to preserve the visitor's own budget and stops at it,
  saying so.
- **No freeze** — a 5,000-line workflow stays interactive.
- **Zero-egress proof** — a default-path request guard, not a marketing line.
