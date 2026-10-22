# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Engineers who own a repository's CI: platform/DevEx engineers hardening a team's supply chain this sprint, security-minded maintainers who inherited a `pull_request_target` workflow, and OSS maintainers or solo devs who just want `actions/checkout@v4` pinned without breaking Dependabot. They arrive from search ("pin github actions to sha", "github actions sha pinning tool", "github actions permissions audit", "template injection github actions"), from a security advisory about a compromised action (the tj-actions/changed-files incident made pinning a checklist item), or from a scanner (OpenSSF Scorecard, a code-scanning alert) telling them their actions are unpinned. They have one workflow file open in their editor and want a reviewable change to paste into a PR.

## Product Purpose

Paste a `.github/workflows/*.yml`. Anchorflow returns the same file with every action pinned to the commit SHA its tag points at today (original tag kept as a trailing comment, the format Dependabot reads), plus an audit of what else is wrong: over-broad `GITHUB_TOKEN` grants per job, `${{ }}` template-injection sinks fed by attacker-controlled event data, dangerous triggers and persisted credentials. Every pin carries a receipt (the API hops and a `git ls-remote` line) so a reviewer can verify it by hand. Success: in a minute the engineer copies a pinned file or a red/green diff into a PR and knows which findings to fix next.

## Positioning

- The workflow never leaves the browser. Parsing, classification, the audits, the rewrite and the diff run in a Web Worker in the visitor's tab. The only network request is an opt-in, read-only, unauthenticated GET to api.github.com per ref, made by the visitor's own browser after they press Resolve & pin. The CSP enforces it.
- Byte-surgical rewrite: only the `uses:` scalars change. Comments, blank lines and spacing survive, so the diff is exactly the pins.
- Receipts, not trust: each pin shows how it was resolved and how to re-check it.
- Free, no account, no install, no GitHub App and no repository access.
- Compare against categories, never named brands: CLI pinners (install, run locally, no audit), hosted hardening services (paste or grant repo access to a server; often public-repos-only on free tiers), linters (audit but cannot resolve a tag to a SHA) and update bots (need repo access, act after merge).

## Operating Context

One workflow at a time, 20–300 lines typically; the engine caps input at 256 KiB and 2,000 `uses:` nodes. Used on a laptop next to the editor and a PR, often in a dark editor theme, sometimes on a phone while reviewing a PR or an advisory. GitHub's unauthenticated API allows 60 requests per hour per IP; the tool keeps a reserve and says so.

## Capabilities and Constraints

- Engine (do not change behaviour): `_lib` pure core: YAML parse with scan cap, six `uses:` classes (remoteRef, sha40, sha256, local, docker, invalid), findings (unpinned-uses, moving-ref, excessive-permissions, template-injection, dangerous-trigger, persist-credentials, resolution), grant table, offset-surgical rewrite, unified diff, ref resolver with path-safety guards, rate-limit budget, receipts. Byte-count/truncation carry-through (AC-13) and its e2e journey stay.
- Phase B (resolve) is opt-in; auto-resolve defaults off. Zero egress on the default path is asserted by e2e.
- Optional sign-in (shared Nor AI Supabase project) is a convenience only. Never prompted unprompted (no return-visit modal); offered only on a user action.
- Canonical origin: https://anchorflow.norai.tech (owner decision, 2026-10-22; it replaces the earlier anchor.norai.tech, which never answered). DNS/nginx are the owner's job. Never deploy from this repo during the redesign.

## Brand Commitments

- Name: Anchorflow, part of the Nor AI tier-0 family. Distinct visual world per tool; the shared thread is a small Nor AI mark linking to https://norai.tech, the family footer ("Built by Nor AI", "More free tools") and cross-links.
- Family one-liner: "Anchorflow · Pin and audit GitHub Actions workflows".
- Light and dark themes.

## Evidence on Hand

- Built-in example workflow (`_lib/presets.ts`) that exercises every class and finding.
- Measured performance in `BENCHMARKS.md`; quote only with its context.
- Unit tests over the pure core, Playwright journeys including the zero-egress request guard and the oversize-input journey.
- No testimonials, user counts, logos or press. Do not fabricate them.

## Product Principles

1. The pinned file is the answer. Show what will change in the PR first; counts and metrics are never the hero.
2. Prove every pin: the receipt is one click from the line it pins.
3. One next step at a time: paste → see what's unpinned and risky → resolve & pin → copy the file or diff.
4. Honest states: loading says loading; a rate limit says when it resets; a slow device never sees a fake "too complex" failure.
5. Ask before touching the network, and say exactly what will be requested.

## Accessibility & Inclusion

WCAG 2.2 AA: body text ≥ 4.5:1 in both themes, visible focus, full keyboard path (⌘K palette, ⌘↵ focus input), `prefers-reduced-motion` honoured, live-region announcements for results, no information carried by colour alone (every status also has a word).
