// ─────────────────────────────────────────────────────────────────────────────
// Anchorflow — dangerous triggers + persist-credentials (ARCH §3.8 · SPEC
// §4 F7 · §4 F8). Pure, no IO.
//
// A `pull_request_target` or `workflow_run` job runs with a token that can
// write. That is safe only while the code it executes is the BASE repo's own.
// The moment such a job checks out the pull request's HEAD — the fork's branch
// or the triggering run's head commit — the fork author's code executes with
// the write token. That combination is the "pwn request" pattern, and it is the
// only thing the dangerous-trigger audit calls an error.
//
// The persist-credentials audit covers the other half: actions/checkout writes
// `.git/credentials` by default (`persist-credentials` defaults to true), so
// any later step in the job inherits the token even when the job never asked
// for it.
// ─────────────────────────────────────────────────────────────────────────────

import {
  isCheckout,
  isFullyPinned,
  untrustedRefExpression,
} from "./actionCatalog";
import { effectiveJobGrants, expandBlock } from "./grantTable";
import { TOKEN_COUPLING_SCOPES } from "./permissionAudit";
import type { Finding, JobNode, StepNode, WorkflowModel } from "./types";

/** The two elevated triggers, named the way the workflow spells them. */
const ELEVATED_TRIGGER_NAMES: Record<"pullRequestTarget" | "workflowRun", string> = {
  pullRequestTarget: "pull_request_target",
  workflowRun: "workflow_run",
};

/**
 * The name of the elevated trigger this workflow carries, or null. Triggers are
 * workflow-level, so every job in the file is judged against the same set.
 */
function elevatedTriggerName(model: WorkflowModel): string | null {
  if (model.triggers.pullRequestTarget && model.triggers.workflowRun) {
    return "pull_request_target / workflow_run";
  }
  if (model.triggers.pullRequestTarget) return ELEVATED_TRIGGER_NAMES.pullRequestTarget;
  if (model.triggers.workflowRun) return ELEVATED_TRIGGER_NAMES.workflowRun;
  return null;
}

/** A bounded, back-ticked list of write scopes for a finding's detail. */
function scopeList(scopes: readonly string[]): string {
  const head = scopes
    .slice(0, 5)
    .map((scope) => `\`${scope}: write\``)
    .join(", ");
  const rest = scopes.length - 5;
  return rest > 0 ? `${head} and ${rest} more` : head;
}

/** Every checkout step in a job, in order. */
function checkoutSteps(job: JobNode): StepNode[] {
  return job.steps.filter((step) => step.usesRaw !== null && isCheckout(step.usesRaw));
}

/**
 * True when a checkout hands the job untrusted code. The ref may name the PR
 * head explicitly, or be absent on a `workflow_run` job — where checkout's
 * default ref is the triggering run's head commit, i.e. the fork's code.
 * (On `pull_request_target` the default ref is the PR's base merge ref, which
 * the base repo itself produced, so an absent ref is not flagged.)
 */
function untrustedCheckout(
  step: StepNode,
  model: WorkflowModel
): { expression: string; via: "ref" | "default" } | null {
  const expression = untrustedRefExpression(step.checkoutRef);
  if (expression) return { expression, via: "ref" };
  if (step.checkoutRef === null && model.triggers.workflowRun) {
    return {
      expression: "github.sha (the triggering run's head commit)",
      via: "default",
    };
  }
  return null;
}

/**
 * The job's effective write scopes, in canonical order — resolved exactly the
 * way the grant table resolves them (own block, then the top-level block).
 */
function writeScopes(job: JobNode, model: WorkflowModel): string[] {
  return effectiveJobGrants(job, model.topPermissions)
    .filter((row) => row.level === "write")
    .map((row) => row.scope);
}

/**
 * SPEC §4 F7: the elevated-trigger audit. Two findings per dangerous job:
 *
 *   · error  — the job checks out untrusted code (PR head / run head). The
 *     fork author's code then runs with the job's write token, so the
 *     token-permission coupling is quoted in the same finding.
 *   · warn   — the job also holds a write scope while an elevated trigger runs
 *     it: any untrusted input reaching that job can spend the scope.
 */
export function dangerousTriggerAudit(model: WorkflowModel): Finding[] {
  const findings: Finding[] = [];

  for (const job of model.jobs) {
    const trigger = elevatedTriggerName(model);
    if (trigger === null) continue;

    const checkouts = checkoutSteps(job);
    const writes = writeScopes(job, model).filter((scope) =>
      TOKEN_COUPLING_SCOPES.includes(scope)
    );
    const credentialsNote = checkouts.some(
      (step) => step.persistCredentials !== false
    )
      ? " The job's checkout leaves credentials in the workspace (`persist-credentials` is not set to `false`), so every later step inherits the token."
      : "";

    // A per-site counter: every (job, site) gets its own finding id.
    const counters = new Map<string, number>();
    const nextId = (site: string): string => {
      const n = (counters.get(site) ?? 0) + 1;
      counters.set(site, n);
      return `dangerous-trigger:${job.id}:${site}:${n}`;
    };

    for (const step of checkouts) {
      const untrusted = untrustedCheckout(step, model);
      if (!untrusted) continue;
      findings.push({
        id: nextId(`${step.index}`),
        category: "dangerous-trigger",
        severity: "error",
        title: "Untrusted code runs with the elevated token",
        detail: `\`${trigger}\` runs \`jobs.${job.id}\` with a token that can write, and its checkout step ${
          untrusted.via === "default"
            ? "checks out its DEFAULT ref, which for a workflow_run is"
            : "fetches"
        } \`${untrusted.expression}\` — code the pull request author controls.${
          writes.length > 0
            ? ` The job also holds ${writes
                .map((scope) => `\`${scope}: write\``)
                .join(", ")}, so that code can spend the token.`
                : " The job holds no write scope, which limits the damage — but the code still runs in the job's context."
        }${credentialsNote}`,
        remediation:
          "Do not build or run pull request code in this job: split it into a `pull_request` job that checks out `github.ref`, and let this job consume the artifact. If the checkout is unavoidable, pin it to the base repo and set `persist-credentials: false`.",
        where: `jobs.${job.id}.steps[${step.index}].uses`,
        evidence: `with.ref: ${step.checkoutRef ?? "(absent)"}`,
        start: step.usesStart,
      });
    }

    if (writes.length > 0) {
      findings.push({
        id: nextId("job"),
        category: "dangerous-trigger",
        severity: "warn",
        title: "Write token coupled to an elevated trigger",
        detail: `\`${trigger}\` runs \`jobs.${job.id}\` and the job holds ${scopeList(
          writes
        )}. Anything untrusted that reaches this job — a checkout of the PR head, an injected expression, a reusable workflow's inputs — can spend those scopes. Drop the write scopes this job does not need.`,
        remediation:
          "Narrow the job's permissions to read scopes, and move the write into a separate `push`/`workflow_dispatch` job that consumes an artifact instead of the fork's code.",
        where: `jobs.${job.id}.permissions`,
        evidence: writes.map((scope) => `${scope}: write`).join(", "),
        start: job.permissionsStart ?? null,
      });
    }
  }

  return findings;
}

/**
 * SPEC §4 F8: the persist-credentials audit. actions/checkout defaults
 * `persist-credentials` to TRUE, which writes the token into `.git/credentials`
 * for every later step. The finding drops to info in a fully pinned,
 * least-privilege, non-PR-target job, where the credential is the least of the
 * job's concerns.
 */
export function persistCredentialsAudit(model: WorkflowModel): Finding[] {
  const findings: Finding[] = [];

  for (const job of model.jobs) {
    const checkouts = checkoutSteps(job);
    if (checkouts.length === 0) continue;
    let persisted = 0;

    const trigger = elevatedTriggerName(model);
    const writes = writeScopes(job, model);
    const leastPrivilege =
      writes.length === 0 &&
      Object.values(expandBlock(job.permissions)).every(
        (level) => level === "read" || level === "none"
      ) &&
      Object.values(expandBlock(model.topPermissions)).every(
        (level) => level === "read" || level === "none"
      );
    // SPEC §4 F8: the finding drops to info in a fully pinned, least-privilege,
    // non-PR-target job.
    const clean = trigger === null && isFullyPinned(job.steps) && leastPrivilege;

    for (const step of checkouts) {
      const explicitTrue = step.persistCredentials === true;
      const untrusted = untrustedCheckout(step, model);
      const absentWithRisk = step.persistCredentials === null && (trigger !== null || untrusted !== null);
      if (!explicitTrue && !absentWithRisk) continue;

      const viaUntrustedCode = Boolean(untrusted);
      const severity = clean ? "info" : "warn";

      persisted += 1;
      findings.push({
        id: `persist-credentials:${job.id}:${step.index}:${persisted}`,
        category: "persist-credentials",
        severity,
        title: explicitTrue
          ? "`persist-credentials: true` leaves the token in the workspace"
          : "`persist-credentials` is absent — GitHub defaults it to true",
        detail: `${
          explicitTrue
            ? `\`actions/checkout\` at \`jobs.${job.id}.steps[${step.index}]\` keeps \`GITHUB_TOKEN\` in \`.git/credentials\` after the step, so every later step — and any code injected into it — can push with the job's permissions.`
            : `\`actions/checkout\` at \`jobs.${job.id}.steps[${step.index}]\` leaves \`persist-credentials\` unset, which GitHub defaults to \`true\`: the token stays in \`.git/credentials\` for every later step that follows.`
        }${
          viaUntrustedCode
            ? " This job checks out untrusted code, so the credential is handed to code the pull request author controls."
            : trigger !== null
              ? ` This job runs under \`${trigger}\`, an elevated trigger.`
              : ""
        }${
          writes.length > 0
            ? ` The job's effective write scopes: ${scopeList(writes)}.`
            : ""
        }`,
        remediation:
          "Set `persist-credentials: false` on the checkout step and re-add credentials only for the one step that needs them.",
        where: `jobs.${job.id}.steps[${step.index}].with.persist-credentials`,
        evidence: explicitTrue
          ? "persist-credentials: true"
          : "persist-credentials: (absent)",
        start: step.usesStart,
      });
    }
  }

  return findings;
}
