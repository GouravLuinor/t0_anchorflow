// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — the action/command knowledge base the audits share.
// Pure, no IO.
//
// Both the permission audit ("does this job really need the scope it holds?")
// and the trigger audit ("does this job run untrusted code with a write
// token?") need the same job-level purpose facts. They are derived HERE, once
// per job, from the structural model — never by guessing at formatting.
//
// The rules are deliberately CONSERVATIVE (SPEC §9 AC-6 demands no false
// positive): a job whose steps can write through an unbounded channel
// (`actions/github-script`, the `gh` CLI, a raw API call) is an
// `opaqueWriter`, and no scope-need claim is made about it at all.
// ─────────────────────────────────────────────────────────────────────────────

import { isLocalPath, SHA256_RE, SHA40_RE, splitRemoteRef } from "./classify";
import type { JobNode, StepNode } from "./types";

/** A `uses:` value reduced to its owner/repo (subpath dropped). */
export function ownerRepo(raw: string): string | null {
  const withoutRef = raw.split("@")[0] ?? "";
  const [owner, repo] = withoutRef.split("/");
  if (!owner || !repo) return null;
  return `${owner}/${repo}`;
}

/** True when the raw value points at actions/checkout (any subpath). */
export function isCheckout(raw: string): boolean {
  return ownerRepo(raw) === "actions/checkout";
}

interface ActionKnowledge {
  /** Scopes the action provably needs at WRITE level. */
  writes?: readonly string[];
  /** Scopes the action provably needs at READ level. */
  reads?: readonly string[];
  /** The action consumes GITHUB_TOKEN for API calls or authenticated git. */
  usesToken?: boolean;
  /** The action is an OIDC consumer (`id-token: write`). */
  oidc?: boolean;
  /** The action can write through an unbounded, uninspectable channel. */
  opaque?: boolean;
}

/**
 * The catalog. Keys are `owner/repo` (an owner prefix matches any repo in it,
 * e.g. `aws-actions/` covers every AWS action).
 */
const ACTION_KNOWLEDGE: Readonly<Record<string, ActionKnowledge>> = {
  "actions/checkout": { reads: ["contents"], usesToken: true },
  "actions/github-script": { usesToken: true, opaque: true },
  "actions/labeler": { writes: ["issues"], usesToken: true },
  "actions/stale": { writes: ["issues"], usesToken: true },
  "actions/upload-release-asset": { writes: ["contents"], usesToken: true },
  "actions/dependency-review-action": { reads: ["contents"] },
  "actions/create-release": { writes: ["contents"], usesToken: true },
  "softprops/action-gh-release": { writes: ["contents"], usesToken: true },
  "ncipollo/release-action": { writes: ["contents"], usesToken: true },
  "peter-evans/create-pull-request": { writes: ["pull-requests"], usesToken: true },
  "repo-sync/pull-request": { writes: ["pull-requests"], usesToken: true },
  "docker/build-push-action": { writes: ["packages"], usesToken: true },
  "docker/login-action": { reads: ["packages"] },
  "peaceiris/actions-gh-pages": { writes: ["pages"], usesToken: true },
  "JamesIves/github-pages-deploy-action": { writes: ["pages"], usesToken: true },
  "github/codeql-action": { writes: ["security-events"], usesToken: true },
  "pypa/gh-action-pypi-publish": { writes: ["id-token"], oidc: true },
  "aws-actions/": { oidc: true },
  "azure/login": { oidc: true },
  "google-github-actions/": { oidc: true },
  "hashicorp/vault-action": { oidc: true },
  "sigstore/": { oidc: true },
  "chrnorm/deployment-action": { writes: ["deployments"], usesToken: true },
  "EndBug/add-and-commit": { writes: ["contents"], usesToken: true },
  "stefanzweifel/git-auto-commit-action": { writes: ["contents"], usesToken: true },
  "ad-m/github-push-action": { writes: ["contents"], usesToken: true },
  "CasperWA/push-protected": { writes: ["contents"], usesToken: true },
};

/** The catalog entry for one `uses:` value, or null when it is unknown. */
export function knowledgeFor(raw: string): ActionKnowledge | null {
  const target = ownerRepo(raw);
  if (!target) return null;
  const exact = ACTION_KNOWLEDGE[target];
  if (exact) return exact;
  const prefix = `${target.split("/")[0]}/`;
  return ACTION_KNOWLEDGE[prefix] ?? null;
}

/** One run-command fact: a pattern, the scopes it needs, and what it implies. */
interface RunRule {
  pattern: RegExp;
  writes?: readonly string[];
  usesToken?: boolean;
  oidc?: boolean;
  opaque?: boolean;
}

/**
 * Run-command heuristics. Every pattern is matched against the step's `run:`
 * text; a hit is a PROVEN need (or a proven opaque-write channel), never a
 * guess about intent.
 */
const RUN_RULES: readonly RunRule[] = [
  { pattern: /\bgit\s+push\b/, writes: ["contents"], usesToken: true },
  { pattern: /\bgh\s+release\b/, writes: ["contents"], usesToken: true },
  {
    pattern: /\bgh\s+pr\s+(?:create|merge|close|comment|edit|review|ready)\b/,
    writes: ["pull-requests"],
    usesToken: true,
  },
  { pattern: /\bgh\s+issue\b/, writes: ["issues"], usesToken: true },
  {
    pattern: /\bgh\s+api\b[^\n|;]*\/deployments\b/,
    writes: ["deployments"],
    usesToken: true,
  },
  { pattern: /\bgh\s+api\b/, usesToken: true, opaque: true },
  {
    pattern: /\b(?:npm|yarn|pnpm)\s+(?:publish|run\s+publish)\b/,
    writes: ["packages"],
  },
  { pattern: /\b(?:docker|podman)\s+push\b/, writes: ["packages"] },
  { pattern: /\bgh-pages\b/, writes: ["pages"] },
  {
    pattern: /\bcurl\b[^\n|;]*-X\s*(?:POST|PUT|PATCH|DELETE)\b/,
    usesToken: true,
    opaque: true,
  },
  {
    pattern: /\$?\{?ACTIONS_ID_TOKEN_REQUEST_(?:URL|TOKEN)\}?/,
    oidc: true,
    usesToken: true,
  },
];

/** What a job's steps prove about it — computed once, read by both audits. */
export interface JobProfile {
  /** True when the job can write through an unbounded channel. */
  opaqueWriter: boolean;
  /** True when any step could use GITHUB_TOKEN (checkout / gh / push / API). */
  consumesToken: boolean;
  /** True when an OIDC consumer is present. */
  needsOidc: boolean;
  /** Scopes provably needed at write level, in canonical order. */
  writeNeeds: Set<string>;
  /** Scopes provably needed at read level. */
  readNeeds: Set<string>;
  /** Purpose flags used by the scope-specific findings. */
  publishesPackages: boolean;
  publishesPages: boolean;
  createsDeployments: boolean;
  writesRepository: boolean;
  /** True when the job is a reusable-workflow call (its steps are invisible). */
  isReusableCall: boolean;
}

function emptyProfile(): JobProfile {
  return {
    opaqueWriter: false,
    consumesToken: false,
    needsOidc: false,
    writeNeeds: new Set(),
    readNeeds: new Set(),
    publishesPackages: false,
    publishesPages: false,
    createsDeployments: false,
    writesRepository: false,
    isReusableCall: false,
  };
}

function applyKnowledge(profile: JobProfile, knowledge: ActionKnowledge): void {
  for (const scope of knowledge.writes ?? []) profile.writeNeeds.add(scope);
  for (const scope of knowledge.reads ?? []) profile.readNeeds.add(scope);
  if (knowledge.usesToken) profile.consumesToken = true;
  if (knowledge.oidc) profile.needsOidc = true;
  if (knowledge.opaque) profile.opaqueWriter = true;
  if (knowledge.writes?.includes("packages")) profile.publishesPackages = true;
  if (knowledge.writes?.includes("pages")) profile.publishesPages = true;
  if (knowledge.writes?.includes("deployments")) profile.createsDeployments = true;
  if (knowledge.writes?.includes("contents")) profile.writesRepository = true;
}

/** Derives the job's purpose profile from its steps. Pure and total. */
export function jobProfile(job: JobNode): JobProfile {
  const profile = emptyProfile();
  profile.isReusableCall = job.uses !== null && job.steps.length === 0;

  for (const step of job.steps) {
    if (step.usesRaw) {
      const knowledge = knowledgeFor(step.usesRaw);
      if (knowledge) applyKnowledge(profile, knowledge);
    }
    // A run rule is the same shaped knowledge, so it goes through the same
    // funnel — the profile is derived one way only.
    if (step.run !== null) {
      for (const rule of RUN_RULES) {
        if (!rule.pattern.test(step.run)) continue;
        applyKnowledge(profile, {
          writes: rule.writes,
          usesToken: rule.usesToken,
          oidc: rule.oidc,
          opaque: rule.opaque,
        });
      }
    }
  }

  return profile;
}

/**
 * True when the job provably needs `scope` at write level. An opaque writer
 * proves nothing, so nothing is claimed for it (no false positives).
 */
export function needsWriteScope(profile: JobProfile, scope: string): boolean {
  return profile.writeNeeds.has(scope);
}

/**
 * Checkout refs that hand the job UNTRUSTED code: the PR head of a fork, or
 * the head of a triggering `workflow_run`. Ordered longest-first so the most
 * specific match is reported deterministically.
 */
export const UNTRUSTED_REF_EXPRESSIONS: readonly string[] = [
  "github.event.workflow_run.head_commit.id",
  "github.event.pull_request.head.repo.full_name",
  "github.event.pull_request.head.repo.git_url",
  "github.event.pull_request.head.repo.clone_url",
  "github.event.workflow_run.head_branch",
  "github.event.workflow_run.head_sha",
  "github.event.pull_request.head.sha",
  "github.event.pull_request.head.ref",
  "github.head_ref",
];

/**
 * The untrusted expression a checkout ref contains, or null. A bare
 * `${{ … }}` wrapper or a `refs/…` prefix does not hide the context path.
 */
export function untrustedRefExpression(ref: string | null): string | null {
  if (!ref) return null;
  const flat = ref.replace(/\$\{\{|\}\}/g, "").replace(/\s+/g, "");
  if (!flat) return null;
  for (const expression of UNTRUSTED_REF_EXPRESSIONS) {
    if (flat.includes(expression)) return expression;
  }
  return null;
}

/**
 * True when every `uses:` the job carries is immutable: a 40-hex commit SHA, a
 * 64-hex digest, or an in-repo local action. A moving tag is NOT pinned.
 */
export function isFullyPinned(steps: readonly StepNode[]): boolean {
  for (const step of steps) {
    if (!step.usesRaw) continue;
    const raw = step.usesRaw.trim();
    if (isLocalPath(raw)) continue;
    const parts = splitRemoteRef(raw);
    if (!parts) return false; // not an owner/repo@ref shape — nothing proven
    const ref = parts.ref;
    if (!SHA40_RE.test(ref) && !SHA256_RE.test(ref)) return false;
  }
  return true;
}
