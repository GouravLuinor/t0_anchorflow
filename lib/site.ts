/**
 * Anchorflow — the single canonical site description + FAQ source array.
 *
 * `SITE.faqs` is the ONE source the FAQ accordion renders AND the FAQPage
 * JSON-LD is derived from (BAR §2.4 · SPEC §9 AC-18), so the two can never
 * drift. Keep them in lockstep.
 */
export const SITE = {
  name: "Anchorflow",
  shortName: "Anchorflow",
  title:
    "Anchorflow — Pin, Audit & Diff GitHub Actions Workflows in Your Browser",
  description:
    "Paste a .github/workflows YAML and get back a SHA-pinned, permission-audited, diffable workflow — 100% in your browser. The only network is a read-only, unauthenticated GET to api.github.com used to resolve owner/repo@ref to a commit SHA, and it is made by your own browser.",
  url: "https://anchor.norai.tech",
  locale: "en_US",
  creator: "Nor AI",
  keywords: [
    "anchorflow",
    "github actions",
    "pin actions to sha",
    "sha pinning",
    "actions permissions audit",
    "GITHUB_TOKEN least privilege",
    "workflow security audit",
    "supply chain security ci",
    "github actions linter",
    "template injection github actions",
    "offline workflow audit",
    "zero cloud egress developer tool",
    "Nor AI",
  ],
  faqs: [
    {
      q: "Does my workflow leave my browser?",
      a: "The workflow text itself never does. Parsing, classification, the permission and injection audits and the diff all run locally inside an in-browser Web Worker. The only outward bytes are the public owner/repo@ref tokens needed to resolve a pin, and those are read-only unauthenticated GET requests to api.github.com made by your own browser — there is no Anchorflow backend that ever sees your workflow. Ref resolution is off until you ask for it.",
    },
    {
      q: "Why pin actions to a commit SHA instead of a tag?",
      a: "A tag is a mutable pointer: whoever can push to the repository can move @v4 to different code tomorrow, and your next CI run silently executes it. A 40-hex commit SHA is immutable, so the code your workflow runs today is the code it runs on every future run. Anchorflow resolves the ref for you and appends the original ref as a trailing comment, which is exactly the format GitHub and Dependabot read themselves — so your Dependabot updates keep working.",
    },
    {
      q: "What is a moving ref, and why does Anchorflow flag one?",
      a: "A ref is moving when it names a branch or a floating major: main, master, HEAD, trunk, develop, latest, or a bare major like @v4 / @4. A dotted version such as @v4.2.0 or @1.2.3-rc.1 is a fixed point and is not flagged. A moving ref is the single most common supply-chain gap in a real workflow, and it needs no network to detect — that is why the offline report catches it on first paint.",
    },
    {
      q: "What does the permissions audit actually check?",
      a: "It builds the effective GITHUB_TOKEN scope per job (a job block overrides the top-level block scope by scope) and flags the five canonical misconfigurations: a top-level write-all, a job-level write-all, permissions left unset while the workflow consumes GITHUB_TOKEN, an over-broad write on a read-only job, and id-token: write on a job with no OIDC consumer. A least-privilege reference workflow — permissions: {} plus per-job read scopes — produces zero findings.",
    },
    {
      q: "How does Anchorflow detect script injection?",
      a: "Any github.event.* value interpolated into a run, with or if context is attacker-controlled text, because the contributor controls the pull-request title, body, branch name and commit message. The scanner tokenizes the whole expression — not just its leading context path — so a nested function argument, a splat or a concatenation is still caught. The remediation is always the same one indirection: capture the value in env and reference ${VAR}, which the shell never re-parses as code.",
    },
    {
      q: "What happens when GitHub's API rate-limits me?",
      a: "The 60-requests-per-hour limit is enforced by GitHub and belongs to your own browser's IP, not to Anchorflow. When you hit it, the remaining refs are marked rate-limited, their original values are kept, and the full offline report — permissions, injection, dangerous triggers, the diff of what could be pinned — still renders below. Anchorflow also holds an advisory reserve floor so one run cannot spend your whole hourly budget at once.",
    },
  ],
} as const;
