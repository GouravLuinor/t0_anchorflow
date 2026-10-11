// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the seeded first run (BAR §2.3: a blank instrument is a defect).
//
// The seed is a small, realistic CI workflow where EVERY `uses:` line is a live
// classification case, so the instrument is non-blank the moment it paints and
// the offline core has something real to chew on with ZERO network:
//
//   · `actions/checkout@v4`          → remoteRef, MOVING (floating major)
//   · `actions/setup-node@v4.2.0`    → remoteRef, fixed dotted tag (not moving)
//   · `…@11bd7190…` / `…@49933ea5…`  → sha40, a pinned SHA (never rewritten)
//   · `…/release.yml@main`            → remoteRef at JOB scope (reusable call)
//   · `./.github/actions/setup`      → local  (never resolved)
//   · `docker://alpine:3.20`         → docker (out of v1 scope)
//
// The comments are deliberate: `# needed for CI` proves a user comment is
// preserved verbatim across a pin, `[main]     # only main` proves flow spacing
// and pre-comment whitespace survive the offset-surgical rewrite, and the
// over-broad grant + untrusted interpolation give the later permission and
// injection audits something to find.
//
// No network is needed to produce the first report: a moving ref is a
// network-free finding (SPEC §9 AC-14).
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_WORKFLOW = `# Anchorflow seed — paste your own .github/workflows/*.yml over this.
name: ci

on:
  push:
    branches: [main]     # only main
  pull_request:

permissions:
  contents: write      # deliberately over-broad — the audit flags this

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # a trailing user comment survives a pin byte-for-byte
      - uses: actions/checkout@v4   # needed for CI
        with:
          persist-credentials: false
      - uses: actions/setup-node@v4.2.0
        with:
          node-version: 20
      - run: npm ci && npm test

  # Pinned: a 40-hex SHA is never rewritten, so re-running Anchorflow
  # on its own output is a zero-diff.
  verify:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
        with:
          persist-credentials: false
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020  # v4
        with:
          node-version: 20

  # A reusable workflow call: a job-level uses, pinned exactly like a step.
  release:
    uses: octo-org/reusable/.github/workflows/release.yml@main
    with:
      environment: production

  label:
    needs: build
    runs-on: ubuntu-latest
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            console.log("\${{ github.event.pull_request.title }}");

  # Local actions and docker steps are classified but never resolved.
  container:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup
      - uses: docker://alpine:3.20
        with:
          args: echo hello
`;

/** Trust pills shown above the workstation card. */
export const TRUST_PILLS = [
  { id: "egress", label: "Zero-Upload Analysis" },
  { id: "worker", label: "In-Browser Worker" },
  { id: "account", label: "No Account Required" },
] as const;
