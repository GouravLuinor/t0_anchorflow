/**
 * Anchorflow — the single canonical site content source.
 *
 * `SITE.faqs` is the ONE source the FAQ accordion renders AND the FAQPage
 * JSON-LD is derived from, so the two can never drift. `COMPARISON` compares
 * against tool CATEGORIES, never named products, and only says what is true
 * of the category as a whole.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://anchor.norai.tech";

export const SITE = {
  name: "Anchorflow",
  title: "Pin GitHub Actions to commit SHAs, in your browser",
  description:
    "Paste a GitHub Actions workflow and get it back with every action pinned to a commit SHA, token permissions audited and template-injection sinks flagged. Free, no account, and the workflow never leaves your browser.",
  locale: "en_US",
  creator: "Nor AI",
  keywords: [
    "pin github actions to sha",
    "github actions sha pinning",
    "pin actions to commit sha",
    "github actions security audit",
    "GITHUB_TOKEN permissions least privilege",
    "github actions template injection",
    "pull_request_target security",
    "dependabot pinned actions",
    "Anchorflow",
    "Nor AI",
  ],
  faqs: [
    {
      q: "Does my workflow leave my browser?",
      a: "No. Parsing, the audits, the rewrite and the diff run in a Web Worker inside your tab, and there is no Anchorflow server that could receive the file. When you press Resolve & pin, your browser sends read-only, unauthenticated requests to api.github.com that name only the public owner/repo and ref of each action, never the workflow itself. Until you press it, nothing leaves the page.",
    },
    {
      q: "Why pin actions to a commit SHA instead of a tag?",
      a: "A tag is a pointer that anyone with push access to the action's repository can move. If @v4 is re-pointed at malicious code, your next run executes it without any change on your side. A full 40-character commit SHA cannot be moved, so the code that runs is the code you reviewed. Anchorflow keeps the original tag as a trailing comment (uses: owner/repo@<sha> # v4), the format Dependabot and Renovate read to keep proposing updates.",
    },
    {
      q: "Will Dependabot still update pinned actions?",
      a: "Yes. Dependabot's github-actions ecosystem updates SHA-pinned actions and reads the version comment after the SHA. Anchorflow writes exactly that shape, so a pinned workflow keeps receiving update pull requests.",
    },
    {
      q: "What is a moving ref?",
      a: "A ref that is expected to change: a branch (main, master, develop), HEAD, latest, or a bare major such as @v4 that maintainers move with every release. A dotted version such as @v4.2.0 is a fixed point by convention, but it is still a tag and can be re-pointed, so Anchorflow lists it as not pinned rather than as safe.",
    },
    {
      q: "What does the permissions audit check?",
      a: "It lists the GITHUB_TOKEN grant for every job, from the top-level permissions block and the job's own block, and flags write-all, permissions left unset (the token then gets the repository default), write scopes on jobs whose steps only read, and id-token: write with nothing that uses OIDC.",
    },
    {
      q: "How does it find template injection?",
      a: "GitHub expands ${{ }} expressions before a step runs, so a pull request title, branch name or issue body interpolated into run, with or if becomes code the attacker wrote. Anchorflow tokenises each expression and flags untrusted github.event fields wherever they appear. The fix is always the same: pass the value through env and read it as $VAR.",
    },
    {
      q: "What happens when GitHub rate-limits me?",
      a: "GitHub allows 60 unauthenticated API requests per hour per IP address; the limit belongs to your network, not to Anchorflow. Anchorflow keeps a small reserve, stops before spending it, marks the remaining refs as not looked up, and shows when the window resets. Everything already found stays on screen.",
    },
    {
      q: "Is a pinned SHA proof that the action is safe?",
      a: "No. Pinning guarantees the code will not change under you; it says nothing about whether that code was safe in the first place. Each pin carries a receipt with the API call that produced it and a git ls-remote command you can run to check it yourself, and you should still review the actions you depend on.",
    },
  ],
} as const;

/** The family thread: identical names and one-liners across every Nor AI tool. */
export const FAMILY_TOOLS = [
  { id: "tokencraft", name: "TokenCraft", line: "Token counter and LLM cost calculator", url: "https://tokens.norai.tech" },
  { id: "schemacraft", name: "SchemaCraft", line: "JSON to Zod, Pydantic and TypeScript types", url: "https://schema.norai.tech" },
  { id: "regexcraft", name: "RegexCraft", line: "Regex tester with plain-English explanations", url: "https://regex.norai.tech" },
  { id: "judgewright", name: "Judgewright", line: "Calibrate your LLM judge against human labels", url: "https://judge.norai.tech" },
  { id: "rozgar", name: "Smart Rozgar", line: "Sarkari job alerts in Hindi and English", url: "https://rozgar.norai.tech" },
] as const;

export const COMPARISON = {
  columns: [
    { id: "anchorflow", name: "Anchorflow" },
    { id: "cli", name: "CLI pinners" },
    { id: "hosted", name: "Hosted hardening services" },
    { id: "linters", name: "Workflow linters" },
    { id: "bots", name: "Update bots" },
  ],
  rows: [
    {
      criterion: "Where your workflow is processed",
      cells: ["In your browser tab", "On your machine", "On the service's servers", "On your machine or in CI", "In your repository"],
      win: true,
    },
    {
      criterion: "Before the first result",
      cells: ["Paste. No install, no account", "Install a binary", "Sign in or paste into their app", "Install and configure", "Install an app or add config"],
      win: true,
    },
    {
      criterion: "Pins tags to commit SHAs",
      cells: ["Yes, on request", "Yes", "Yes", "Flag unpinned actions; most don't rewrite", "Keep existing pins up to date"],
      win: false,
    },
    {
      criterion: "Audits token permissions and injection",
      cells: ["Yes, offline", "No", "Usually permissions", "Yes", "No"],
      win: false,
    },
    {
      criterion: "Shows how each pin was resolved",
      cells: ["API hops and a git ls-remote line", "Not usually", "Not usually", "Not applicable", "In the pull request"],
      win: true,
    },
    {
      criterion: "Many repositories at once",
      cells: ["No, one file at a time", "Yes", "Yes", "Yes", "Yes"],
      win: false,
    },
  ],
  note: "For every repository at once, or on a schedule, a CLI pinner in CI or an update bot is the better fit. Anchorflow is for the one workflow in front of you, when you want a reviewable change and the reasons behind it, without installing or granting anything.",
} as const;
