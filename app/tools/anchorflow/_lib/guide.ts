// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the KnowledgeHub content source (one array, one render path).
// ─────────────────────────────────────────────────────────────────────────────

export interface GuideTab {
  id: string;
  label: string;
  title: string;
  blurb: string;
  code: string;
}

export const GUIDE_TABS: GuideTab[] = [
  {
    id: "pinning",
    label: "Pinning",
    title: "Pin every action to an immutable commit",
    blurb:
      "A tag is a pointer that can move; a commit SHA cannot. Anchorflow resolves owner/repo@ref to the commit the ref points at today and rewrites the uses value, appending the original ref as a trailing comment — the exact format GitHub and Dependabot read themselves.",
    code: `# before — a tag that can move under you
- uses: actions/checkout@v4

# after — the commit v4 points at today, with the honest label kept
- uses: actions/checkout@11daba688012890e563df9f370a5fbd0c62c5f8  # v4
#                                ^ 40-hex commit    ^ GitHub/Dependabot pin format`,
  },
  {
    id: "permissions",
    label: "Permissions",
    title: "Stop over-permissioning GITHUB_TOKEN",
    blurb:
      "An unset permissions block inherits the repository default, which is often write. Anchorflow builds the effective scope per job (job block overrides top per scope) and flags the over-grants: write-all, a write scope on a read-only job, and id-token: write with no OIDC consumer.",
    code: `# least privilege: nothing at top, narrow per job
permissions: {}

jobs:
  test:
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4

  release:
    permissions:
      contents: write   # only the job that actually publishes`,
  },
  {
    id: "injection",
    label: "Injection",
    title: "Move untrusted values into env",
    blurb:
      "Any github.event.* value interpolated into run, with or if is script injection: the contributor controls the text. The fix is one indirection — capture it in env and reference ${VAR}, which the shell never re-parses as an expression.",
    code: `# flagged — the PR title is attacker-controlled text
- run: echo "\${{ github.event.pull_request.title }}"
- if: github.event.issue.title == 'renovate'

# safe — the value is captured as data, never as code
- run: echo "\$TITLE"
  env:
    TITLE: \${{ github.event.pull_request.title }}`,
  },
  {
    id: "receipts",
    label: "Receipts",
    title: "Every conclusion is reproducible by hand",
    blurb:
      "Each pin ships with the request that produced it and a git ls-remote cross-check you can run yourself, plus the standing caveat: a SHA is a point-in-time snapshot, and the tag can move later.",
    code: `# the receipt for one pin
GET /repos/actions/checkout/git/ref/tags/v4
  → 11daba688012890e563df9f370a5fbd0c62c5f8 (commit)

# reproduce it locally, no Anchorflow involved
git ls-remote https://github.com/actions/checkout "refs/tags/v4^{}"
# → 11daba688012890e563df9f370a5fbd0c62c5f8	refs/tags/v4^{}`,
  },
];
