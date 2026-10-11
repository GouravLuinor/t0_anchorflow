// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the seeded first run (BAR §2.3: a blank instrument is a defect).
//
// The seed is a small, realistic workflow: a moving major tag (`@v4`), a
// floating floating point ref (`@v4.2.0`, fixed), an over-broad token grant,
// and one untrusted-context interpolation — so the instrument is non-blank the
// moment it paints and every future audit has something to find.
//
// No network is needed to produce the first report: a moving ref is a
// network-free finding (SPEC §9 AC-14).
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_WORKFLOW = `# Anchorflow seed — paste your own .github/workflows/*.yml over this.
name: ci

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          persist-credentials: true
      - uses: actions/setup-node@v4.2.0
        with:
          node-version: 20
      - run: npm ci && npm test

  label:
    runs-on: ubuntu-latest
    permissions:
      pull-requests: write
    steps:
      - uses: actions/github-script@v7
        with:
          script: |
            console.log("\${{ github.event.pull_request.title }}");
`;

/** Trust pills shown above the workstation card. */
export const TRUST_PILLS = [
  { id: "egress", label: "Zero-Upload Analysis" },
  { id: "worker", label: "In-Browser Worker" },
  { id: "account", label: "No Account Required" },
] as const;
